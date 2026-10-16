# Auth state of this API (2026-10-16)

- `middleware/auth.js` issues a JWT (30 days) at customer register/login, staff login, Google and Apple sign-in (`token` field next to `data`). `verifyToken` also re-reads the user from MongoDB (role and `isActive` come from the DB, frozen/deleted accounts get 401 with `accountRevoked: true`).
- Signing key: `JWT_SECRET` env var if set, otherwise derived from `MONGO_URI` (stable across restarts; changing either logs everyone out). A warning is logged at boot when `JWT_SECRET` is missing.
- **Only `routes/complaints.js` enforces auth.** Customers: own complaints only, on their own orders. `support`/`admin`/`owner`: view all, update status, see driver performance. Everyone else: 403.
- Every other route is still open (no token required), e.g. `/api/auth/employees`, `/api/admin/*`, `POST /api/auth/register`. A broad lock (commit `c847f8c`) was added and reverted twice on 2026-09-22/24; reasons not recorded. Plan: lock the rest in stages, most dangerous first, shipping new app builds before each stage. See the monorepo `HANDOFF.md` section 6 (repo `khalidalchalabi/deqeq-app`).
- The staff web build is committed under `public/web/` and served at `/staff` and `/admin` (also deployed to Firebase Hosting). The customer web build under `public/customer/` and the APKs under `public/` are stale (they predate the complaints lock).
