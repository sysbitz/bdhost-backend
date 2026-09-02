# AppHost — BDApps-style dashboard on cPanel

A self-hosted mini-PaaS dashboard. Your users create "apps," upload static
site files, and get a live `appname.yourdomain.com` URL — all while the
actual hosting happens on your single cPanel account behind the scenes.
Users never see cPanel directly.

## How it works

```
Browser (React dashboard)
        │
        ▼
Node/Express backend  ── Postgres (users, apps, billing metadata)
        │
        ▼
cPanel UAPI (single account, via API token)
  - SubDomain::addsubdomain / delsubdomain
  - Fileman::list_files / upload_files / fileop
  - Quota::get_quota_info
```

Every cPanel call lives in **one file**: `backend/src/services/cpanel.ts`.
Nothing else in the codebase talks to cPanel directly — the rest of the
app only knows about "apps," "files," and "storage," matching the mockup's
vocabulary.

## Setup

### 1. cPanel API token
Generate one in cPanel → Security → Manage API Tokens (steps were given
earlier in chat). Give it Subdomain, Fileman, and Quota privileges.

### 2. Backend
```bash
cd backend
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET, CPANEL_* values
npm install
npm run db:push   # creates tables from src/db/schema.ts
npm run dev        # http://localhost:4000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api to the backend
```

### 4. First account
Visit `http://localhost:5173/register` to create your first workspace user.

## Screens implemented (matching the reference mockups)

| Screen | Route | Backend endpoints |
|---|---|---|
| Overview | `/` | `GET /api/overview` |
| Applications (list) | `/applications` | `GET/POST /api/apps` |
| Applications (detail) | `/applications/:id` | `GET /api/apps/:id`, `PATCH /:id/landing`, `POST /:id/restart`, `DELETE /:id` |
| File manager | `/files` | `GET /api/apps/:id/files`, `POST /files/upload`, `DELETE /files` |
| Billing & plan | `/billing` | `GET /api/billing` |
| Account settings | `/account` | `GET /api/account` |

## What's stubbed / next steps

- **Payments**: `payments` table exists but nothing writes to it yet —
  wire up a payment gateway (bKash/Nagad/Stripe) and insert a row on
  successful payment, then bump the user's `plan`/`appLimit`/`storageLimitMb`.
- **Per-app storage used**: currently shows total account usage; cPanel's
  UAPI doesn't give per-directory size cheaply — either shell out to `du`
  via SSH, or track uploaded file sizes yourself in Postgres as you upload.
- **Node.js app support**: today apps are static-only. Running actual
  Node processes on shared cPanel hosting needs cPanel's "Setup Node.js
  App" feature (`Application Manager` API) — different endpoints, doable
  as a phase 2 if you want more than static sites.
- **New folder button** in File manager UI isn't wired to an endpoint yet.
- **Change password / edit profile** buttons in Account settings are UI
  only — add `PATCH /api/account` and a password-change endpoint.
# bdhost-backend
