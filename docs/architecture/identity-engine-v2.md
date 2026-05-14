# Identity Engine v2 — Architecture

## Overview

Identity Engine v2 is the formal service layer around GamerStock's authentication system. It introduces clean modules (services, repositories, types) on top of the existing working auth endpoints — without breaking any existing behavior.

The existing `server/domains/identity/routes.ts` continues to own all HTTP endpoints. The v2 engine provides the business logic and data access layers that routes delegate to.

---

## Module Structure

```
server/domains/identity/
  routes.ts                         — Express endpoints (unchanged behavior)
  types/
    identity.types.ts               — IdentityUser, SessionResponse, Capability, etc.
  repositories/
    user-repository.ts              — DB queries for users table
    credential-repository.ts        — Password hash read/write
    session-repository.ts           — Password reset token lifecycle
  services/
    auth-service.ts                 — signup + login orchestration
    credential-service.ts           — bcrypt hash/verify, password strength rules
    session-service.ts              — session population, clearing, token issuance
    authorization-service.ts        — capability computation (derived from claims)
```

---

## Signup Flow

```
POST /api/auth/signup
  │
  ├── Validate required fields
  ├── credentialService.validatePasswordStrength(password)
  ├── userRepository.emailExists(email) → 409 if taken
  ├── credentialService.hash(password)
  ├── userRepository.create(...)
  ├── storage.createPortfolio(userId)   — ensures portfolio exists
  ├── sessionService.populateFromUser(session, newUser)
  └── 200 { success, user }
```

Password requirements: minimum 8 characters, at least one letter, at least one number.

---

## Login Flow

```
POST /api/auth/login
  │
  ├── userRepository.findByEmailOrDisplayName(login)
  │     └── case-insensitive lookup on email OR displayName
  ├── credentialService.verify(password, hash)
  ├── Check user.status (blocked / deleted / pending_access)
  ├── storage.createPortfolio(userId)   — ensure portfolio
  ├── userRepository.updateLastLogin(userId)
  ├── sessionService.populateFromUser(session, user)
  ├── session.save()                    — explicit save (saveUninitialized=false)
  └── 200 { success, user, mustChangePassword }
```

---

## Session Structure

Sessions are stored server-side in PostgreSQL via the `sessions` table (managed by `connect-pg-simple`). The session cookie is HTTP-only and secure.

Session fields written at login:

| Field | Value |
|---|---|
| `userId` | users.id |
| `userDisplayName` | displayName or email prefix |
| `userEmail` | users.email |
| `userRole` | users.role |
| `mustChangePassword` | users.mustChangePassword |
| `isAdmin` | true if role === "admin" |

**Sessions are NOT stale for role changes.** The `/api/auth/me` endpoint always reads `role` from the database and syncs back to the session if it changed.

---

## /api/auth/me — Session Check

```
GET /api/auth/me
  │
  ├── (admin super-user path) if session.isAdmin && !session.userId
  │     └── return static admin identity
  │
  ├── db lookup: storage.getUser(session.userId)
  ├── Check user.status (deleted → 401)
  ├── Sync role: if session.userRole !== db.role → session.save()
  ├── authorizationService.getCapabilities(userId)  ← v2 addition
  └── 200 {
        user: { id, displayName, email, role, mustChangePassword, status },
        capabilities: []   ← derived from approved player claims
      }
```

The `capabilities` field is always present (empty array if no claims). Existing client code that ignores it is unaffected.

---

## Reset Password Flow

```
POST /api/auth/forgot-password
  │
  ├── Find user by email (case-insensitive)
  ├── sessionService.issueResetToken(userId)
  │     ├── Invalidate existing unused tokens
  │     ├── Generate 32-byte random token
  │     ├── Store SHA-256(token) in DB with 1-hour expiry
  │     └── Return raw token
  └── (dev) Log reset link to console; (prod) send via email

POST /api/auth/reset-password
  │
  ├── Hash token: SHA-256(rawToken)
  ├── sessionRepository.findResetToken(hash)
  ├── Validate: exists, not used, not expired
  ├── credentialService.hash(newPassword)
  ├── userRepository.updatePassword(userId, hash)
  ├── sessionRepository.consumeResetToken(tokenId)
  └── 200 { success }
```

Reset tokens are single-use and expire after 1 hour. The raw token is never stored — only its SHA-256 hash.

---

## Capabilities

Capabilities are permissions derived at runtime from external domain state (player claims). They are NOT roles.

```typescript
type Capability =
  | "player_profile_control"   // active: approved player claim
  | "player_treasury_access"   // future
  | "riot_verified";           // future
```

`authorizationService.getCapabilities(userId)` queries the `player_claims` table and returns the relevant capabilities. If the table doesn't exist or query fails, it returns `[]` (safe fallback via `.catch(() => [])`).

### Why not a `player` role?

- Roles affect authorization middleware across every domain.
- A player user is still fundamentally a `user` — they just have an extra permission on their public profile.
- Capabilities are additive: the client reads them to show/hide player-specific UI.
- Revocation is immediate: capabilities are computed on each `/api/auth/me` call, so revoking a claim instantly removes the capability without requiring the user to log out.

---

## Password Change Flows

| Endpoint | Auth | Use Case |
|---|---|---|
| `POST /api/auth/change-password` | Session required | User voluntarily changes password |
| `POST /api/auth/force-change-password` | Session required | First-login forced change (mustChangePassword=true) |
| `POST /api/auth/reset-password` | Token-based | Forgot-password flow |

All three clear `mustChangePassword` and update the password hash atomically.

---

## Schema Used

| Table | Managed by |
|---|---|
| `users` | `shared/models/auth.ts` |
| `sessions` | `shared/models/auth.ts` (connect-pg-simple) |
| `password_reset_tokens` | `shared/models/auth.ts` |
| `player_claims` | `shared/schema/claims.ts` (for capabilities) |

---

## Future Extensions

| Feature | Where to add |
|---|---|
| Email verification | `credential-service.ts` + new `email_verifications` table |
| Riot OAuth (RSO) | New `linked-identities` domain; set `riot_verified` capability |
| Wallet linking | New `wallets` domain; set `wallet_linked` capability |
| MFA | `session-service.ts` + new `mfa_configs` table |
| Rate limiting | Add to route middleware layer (not service layer) |

The service/repository split means any of these can be added without changing route signatures.

---

## Breaking Change Assessment

**None.** All existing endpoints retain identical behavior. The only additions are:

1. `capabilities: []` field in `/api/auth/me` response (additive, backward-compatible).
2. New `player_claims` and `player_public_profiles` tables (additive, no existing table modified).
3. New `/api/player-claims/*` and `/api/admin/player-claims/*` endpoints (new routes, no conflicts).
