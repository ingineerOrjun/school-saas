# Scholaris — School Management SaaS

Multi-tenant school management platform. Monorepo-style layout with independent
frontend and backend workspaces.

```
school management system/
├── frontend/    Next.js 14 + TypeScript + Tailwind CSS
│                Dashboard UI, login, design system
└── backend/     NestJS 11 + Prisma 6 + PostgreSQL
                  Multi-tenant API, auth, onboarding
```

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ running on `localhost:5432`

### Backend

```bash
cd backend
cp .env.example .env             # then edit DATABASE_URL + JWT_SECRET
npm install
npx prisma migrate deploy        # apply existing migrations
npm run start:dev                # listens on PORT from .env (default 3001)
```

### Frontend

```bash
cd frontend
cp .env.example .env.local       # default points NEXT_PUBLIC_API_URL → :3001
npm install
npm run dev                      # http://localhost:3100
```

Each workspace has its own `package.json`, `node_modules`, and config. Run them
in two terminals or use the `.claude/launch.json` profiles (`frontend`,
`backend`) from Claude Code.

### Environment variables

| Var | Where | Purpose |
| --- | --- | --- |
| `PORT` | `backend/.env` | Nest listen port (default `3001`) |
| `DATABASE_URL` | `backend/.env` | Prisma Postgres connection string |
| `JWT_SECRET` | `backend/.env` | HS256 signing secret — **change in production** |
| `JWT_EXPIRES_IN` | `backend/.env` | Token lifetime (e.g. `7d`) |
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | Backend base URL for the browser |

`.env` and `.env.local` are gitignored. Use the matching `.env.example`
files as templates.

## Architecture

- **Tenant model**: every domain row has a `schoolId` FK to `schools`. Deleting a
  school cascades to all its users, students, and teachers.
- **Auth**: `AuthService.registerAdmin()` provisions a School + ADMIN User in a
  single Prisma transaction.
- **Password hashing**: stubbed in `common/hashing/HashingService`. Swap to
  bcrypt before shipping.
