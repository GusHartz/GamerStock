# Player Claim System — Architecture

## Concept

GamerStock has two kinds of entities that initially have no connection:

1. **Platform users** — anyone who registers an account to trade player shares.
2. **Player assets** — professional LoL players whose shares are tradable on the platform.

The Player Claim System creates a verified link between them. A real pro player can claim their own profile on GamerStock, allowing them to control their public identity on the platform — without touching any market mechanics.

**Key principle:** There is one account. One login. No separate "player login" exists. A player user is simply a regular user who has been granted an additional capability via an approved claim.

---

## Entities

### `player_claims` table

Represents a claim request, tracking its full lifecycle.

| Column | Type | Description |
|---|---|---|
| id | serial | Primary key |
| userId | varchar | FK → users.id (the claimant) |
| assetId | integer | FK → assets.id (the target player asset) |
| assetUid | text | Denormalised `assets.assetUid` for quick reference |
| puuid | text | Riot PUUID provided by the claimant (optional at request time) |
| claimStatus | varchar | `pending` \| `approved` \| `rejected` \| `revoked` |
| verificationMethod | varchar | `manual_admin_review` \| `riot_account_match` \| `org_verification` |
| evidenceNote | text | Free-text from the claimant (social links, team contact, etc.) |
| requestedAt | timestamp | When the claim was submitted |
| reviewedAt | timestamp | When an admin reviewed it |
| reviewedBy | varchar | Admin's userId |
| approvedAt | timestamp | Set on approval |
| rejectedAt | timestamp | Set on rejection |
| rejectionReason | text | Admin's reason for rejection |
| revokedAt | timestamp | Set on revocation |

### `player_public_profiles` table

Created automatically when a claim is approved. Contains only the fields a player user is allowed to edit.

| Column | Type | Description |
|---|---|---|
| id | serial | Primary key |
| assetId | integer | FK → assets.id |
| claimedByUserId | varchar | FK → users.id |
| claimId | integer | FK → player_claims.id (for audit trail) |
| bio | text | Player bio |
| profileImageUrl | text | Profile photo URL |
| bannerUrl | text | Banner image URL |
| headline | text | Short public headline |
| socialLinksJson | text | JSON array of `{platform, url}` objects |
| teamAffiliation | varchar | Current team name |
| isVisible | boolean | Whether profile is publicly visible |
| createdAt | timestamp | Profile creation timestamp |
| lastUpdatedAt | timestamp | Last edit timestamp |

---

## Claim Status Lifecycle

```
               ┌──────────┐
  [User submits]│  pending │
               └────┬─────┘
                    │ Admin reviews
          ┌─────────┴──────────┐
          ▼                    ▼
    ┌──────────┐         ┌──────────┐
    │ approved │         │ rejected │
    └────┬─────┘         └──────────┘
         │ Admin revokes
         ▼
    ┌──────────┐
    │  revoked │
    └──────────┘
```

- A user may have at most **one pending claim per asset** at a time.
- An asset may have at most **one approved claim** at a time.
- Rejected and revoked claims are kept for audit purposes.
- When a claim is approved, a `player_public_profiles` row is created automatically.
- When a claim is revoked, the profile row is **not deleted** (audit trail preserved); capabilities are lost immediately since they are computed dynamically on each `/api/auth/me` call.

---

## Verification Methods

| Method | Status | Description |
|---|---|---|
| `manual_admin_review` | Active | Admin manually verifies the claim using evidence provided |
| `riot_account_match` | Future | User proves ownership via Riot OAuth / RSO |
| `org_verification` | Future | Team/org vouches for the player |

No automatic Riot verification is implemented yet. The `puuid` field on the claim is stored for when `riot_account_match` is enabled.

---

## Capabilities vs Roles

**Decision: Use capabilities, not a new `player` role.**

### Rationale

Adding a `player` role would require role-check updates in every domain's `isAdminOnly` / `isAuthenticated` middleware. Every new role adds combinatorial complexity to authorization rules.

Instead, an approved claim grants a **derived capability**: `"player_profile_control"`. Capabilities are:

- Computed fresh on each `/api/auth/me` call (no session staleness).
- Backward-compatible — existing code that doesn't read `capabilities` is unaffected.
- Extensible — new capabilities can be added without schema changes.

### Capability Map

| Capability | Granted by | Controls |
|---|---|---|
| `player_profile_control` | Approved player claim | Edit bio, images, headline, social links |
| `player_treasury_access` | Future claim/unlock | Player economy features (not implemented) |
| `riot_verified` | Future Riot OAuth | Riot account verified status |

### The /api/auth/me Response

```json
{
  "user": {
    "id": "uuid",
    "email": "player@example.com",
    "displayName": "ProPlayerAlias",
    "role": "user",
    "mustChangePassword": false,
    "status": "active"
  },
  "capabilities": ["player_profile_control"]
}
```

A player user's role remains `"user"`. The `capabilities` array signals the frontend to display player-specific UI.

---

## What a Player User CAN Control

After claim approval, through `PATCH /api/player-claims/:id/profile`:

- `bio`
- `profileImageUrl`
- `bannerUrl`
- `headline`
- `socialLinks` (array of `{platform, url}`)
- `teamAffiliation`
- `isVisible`

## What a Player User CANNOT Control

These are never writable through any claim endpoint:

- Market price
- Fair value / fundamental price
- Supply / AMM state
- Valuation engine output
- Performance score / momentum
- Discovery ranking
- Trading history / volume
- Any market or portfolio data

---

## API Endpoints

### User-facing

| Method | Path | Description |
|---|---|---|
| POST | `/api/player-claims` | Submit a claim request |
| GET | `/api/player-claims/me` | View your own claims |
| GET | `/api/player-claims/me/profile` | View your approved profile |
| PATCH | `/api/player-claims/:id/profile` | Edit your approved profile |
| GET | `/api/player-claims/profile/:assetId` | Public: view a player's profile |

### Admin-facing

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/player-claims` | List all claims (filter by `?status=pending`) |
| PATCH | `/api/admin/player-claims/:id/approve` | Approve a claim |
| PATCH | `/api/admin/player-claims/:id/reject` | Reject a claim |
| PATCH | `/api/admin/player-claims/:id/revoke` | Revoke an approved claim |

---

## Claim Flow

```
User                    Platform                Admin
 │                         │                     │
 │── POST /player-claims ──▶│                     │
 │   {assetId, assetUid,    │                     │
 │    puuid?, evidenceNote} │                     │
 │                         │── claim created ─────▶
 │                         │   status=pending      │
 │◀── 201 {claimId} ───────│                     │
 │                         │                     │
 │                         │◀── GET /admin/... ──│
 │                         │── claim data ───────▶│
 │                         │                     │
 │                         │◀── PATCH .../approve│
 │                         │── status=approved   │
 │                         │── profile created   │
 │                         │                     │
 │── GET /auth/me ─────────▶│                     │
 │◀── {capabilities:        │                     │
 │     ["player_profile_   │                     │
 │       control"]} ───────│                     │
 │                         │                     │
 │── PATCH .../profile ────▶│                     │
 │   {bio, headline, ...}  │                     │
 │◀── 200 {success: true} ─│                     │
```

---

## How This Fits the Identity Engine

The claim system is a **separate domain** (`server/domains/player-claims/`) that interacts with the identity layer only through:

1. `playerClaims.userId` → FK to `users.id`
2. `authorizationService.getCapabilities(userId)` → called by `/api/auth/me` to compute capabilities

The claim system does **not** modify `users` rows. It does not change roles. It does not touch session logic. It is fully removable without affecting authentication.

---

## Evolving Toward Riot Verification

When Riot OAuth (RSO) is ready:

1. User initiates Riot account link flow → receives PUUID
2. Frontend sends PUUID alongside claim submission
3. `verificationMethod` is set to `"riot_account_match"`
4. Service verifies the PUUID matches the target `riot_assets.puuid`
5. If matched, claim can be auto-approved (or fast-tracked to admin)

The `puuid` column on `player_claims` is already present for this purpose. No schema changes will be needed.

---

## Folder Structure

```
server/domains/player-claims/
  types.ts          — TypeScript interfaces
  repository.ts     — DB queries (player_claims, player_public_profiles)
  service.ts        — Business logic and lifecycle rules
  routes.ts         — Express route handlers

shared/schema/
  claims.ts         — Drizzle table definitions
```
