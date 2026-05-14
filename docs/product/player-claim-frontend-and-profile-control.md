# Player Claim Frontend & Profile Control

## Overview

The Player Claim frontend enables verified professional players to request ownership of their GamerStock profile and control their public identity. It integrates with the existing auth system via the `capabilities` field from `/api/auth/me`.

---

## Location in the Product

**Route:** `/settings/player-identity`

Accessible via:
- The gear icon in the top-right user area of the global navigation bar
- Direct link to `/settings/player-identity`

The settings section has a two-tab navigation (Security | Player Identity), consistent with the existing `/settings/security` page.

---

## Components Created

### `client/src/components/player-claim/`

| Component | Purpose |
|---|---|
| `PlayerClaimStatusBadge.tsx` | Status indicator: pending / approved / rejected / revoked |
| `ClaimPlayerDialog.tsx` | Dialog for searching a player asset and submitting a claim |
| `PlayerClaimCard.tsx` | State-aware card showing the right UI per claim status |

### `client/src/components/player-profile-control/`

| Component | Purpose |
|---|---|
| `VerifiedPlayerBadge.tsx` | "Verified Player" green glow badge |
| `EditPlayerProfileDialog.tsx` | Full form to edit bio, headline, socials, images, team |
| `PlayerProfileControlCard.tsx` | Split view: editable public data vs read-only market data |

### `client/src/pages/settings/player-identity.tsx`
Main settings page composing all components above with a unified layout.

---

## Hooks

### `client/src/hooks/use-auth.ts` (updated)
Now exposes:
- `capabilities: Capability[]` — from `/api/auth/me` response
- `hasCapability(cap: Capability): boolean` — typed capability check

### `client/src/hooks/use-player-claim.ts` (new)
| Hook / utility | Purpose |
|---|---|
| `usePlayerClaims()` | Fetches `GET /api/player-claims/me` |
| `usePlayerProfile()` | Fetches `GET /api/player-claims/me/profile` |
| `usePlayerAssetSearch(query)` | Searches `GET /api/player-claims/search-players?q=...` |
| `useSubmitClaim()` | Mutation: `POST /api/player-claims` |
| `useUpdateProfile()` | Mutation: `PATCH /api/player-claims/:id/profile` |
| `useActiveClaim(claims)` | Selects the most relevant claim (approved > pending > rejected) |

---

## UX States

### 1. No Claim
- Dark card with a shield/gamepad icon and green glow CTA
- Explains what claiming a profile means
- Three feature callouts: identity verified, profile control, market protected
- CTA: "Claim Player Profile" → opens search dialog

### 2. Claim Pending
- Amber border and pulsing clock icon
- Shows the asset UID requested and submission date
- No action available — user waits for review

### 3. Claim Rejected
- Rose border and X icon
- Shows rejection reason if provided by admin
- "Try Again" button → opens claim dialog again

### 4. Claim Revoked
- Zinc/grey border
- "Submit New Claim" button available

### 5. Claim Approved (no capability yet in session)
- Emerald border with glow
- Shows linked player asset UID
- "Edit Player Profile" CTA

### 6. Claim Approved + `player_profile_control` capability
- Full profile control panel appears below the claim card
- Two-column split: editable fields (left) vs platform-managed data (right)
- Edit button opens `EditPlayerProfileDialog`

---

## Claim Search & Submission Flow

1. User clicks "Claim Player Profile"
2. Dialog opens with a search input
3. User types their in-game name → calls `GET /api/player-claims/search-players?q=...`
4. Results appear as a selectable list with player name, symbol, and price
5. User selects a player
6. Optional: adds evidence note (social links, org info, etc.)
7. Disclaimer: only public profile is editable, not market data
8. Submit → `POST /api/player-claims` → claim created with status `pending`

---

## Profile Control: Editable Fields

| Field | Notes |
|---|---|
| Headline | Max 120 chars — e.g. "Mid laner · Team Alpha" |
| Bio | Max 500 chars — free text |
| Profile Image URL | External URL, validated |
| Banner Image URL | External URL, validated |
| Team Affiliation | Max 128 chars |
| Social Links | Up to 6 entries: `{ platform, url }` each validated as URL |

## Profile Control: Protected Fields (Never Editable)

| Field | Reason |
|---|---|
| Market Price | AMM + trading activity |
| Fair Value / PVI | Valuation engine output |
| Performance Score | Derived from Riot match data |
| Discovery Ranking | Algorithmic signal |
| Volume, Market Cap | Trading system data |

The two-column layout in `PlayerProfileControlCard` makes this separation visually explicit: left column has an "Editable" label, right column has a "Platform-managed" lock icon.

---

## Capability Integration

`/api/auth/me` returns:
```json
{
  "user": { ... },
  "capabilities": ["player_profile_control"]
}
```

The frontend checks `hasCapability("player_profile_control")` (from `useAuth()`) to:
- Show the profile control section
- Show the "Verified Player" badge in the page header and navbar
- Enable the Edit Profile button

When a claim is revoked, the DB is updated immediately and the next `/api/auth/me` call (triggered on window focus or route change) will return an empty `capabilities` array, instantly hiding the controls.

---

## Backend Additions

One new endpoint was added to support the claim search dialog:

```
GET /api/player-claims/search-players?q=<query>
```
- Auth required
- Searches `assets` table by `displayName` (ILIKE) and `symbol` (ILIKE)
- Returns up to 10 results: `{ id, assetUid, displayName, symbol, entityType, lastTradePrice }`

All other endpoints already existed from Phase 11b.

---

## Current Limitations

1. **No image upload** — profile and banner images accept URLs only; direct upload is not implemented
2. **No real-time verification** — only `manual_admin_review` verification method is active; Riot OAuth is stubbed
3. **One claim per asset** — the system enforces one approved claim per asset globally
4. **Admin review required** — all claims go through manual admin review; no auto-approval path yet
5. **No claim expiry** — pending claims have no automatic expiry
6. **No email notifications** — users are not notified when a claim is approved/rejected

---

## Navigation

- Settings gear icon (⚙) added to top navbar, next to the user display name
- Links to `/settings/player-identity` by default
- Two-tab settings nav: Security | Player Identity

---

## Next Steps

1. Add admin UI tab at `/admin/player-claims` for managing claim queue
2. Implement Riot OAuth (RSO) for automatic `riot_account_match` verification
3. Add image upload via file picker (S3 or similar)
4. Email notifications for claim status changes
5. Add profile visibility toggle (currently always defaults to true)
6. Show verified player badge on public leaderboards and asset pages
