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

### Backend

```bash
cd backend
npm install
npx prisma migrate dev        # requires Postgres on localhost:5432
npm run start:dev             # http://localhost:3000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:3100
```

Each workspace has its own `package.json`, `node_modules`, and config. Run them
in two terminals or use the `.claude/launch.json` profiles (`frontend`,
`backend`) from Claude Code.

## Architecture

- **Tenant model**: every domain row has a `schoolId` FK to `schools`. Deleting a
  school cascades to all its users, students, and teachers.
- **Auth**: `AuthService.registerAdmin()` provisions a School + ADMIN User in a
  single Prisma transaction.
- **Password hashing**: stubbed in `common/hashing/HashingService`. Swap to
  bcrypt before shipping.
