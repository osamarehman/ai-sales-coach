# ai-sales-coach

Stack: **Bun · SolidJS + Tailwind · TypeScript + Express · PostgreSQL · Docker Compose**
(auth via **BetterAuth** — add it with the `better-auth` skill). Bun is the runtime +
package manager everywhere — the backend runs TypeScript directly (no build step).

## Run
```bash
cp .env.example .env    # fill POSTGRES_PASSWORD + BETTER_AUTH_SECRET
docker compose up -d --build
# frontend → http://localhost:5173   backend → http://localhost:8080/api/health
# local (no Docker): cd backend && bun install && bun run dev  (same for frontend/)
```

## Layout
- `backend/`  — Express + TypeScript API. Add routes in `src/`. Validate input with
  zod; parameterized SQL via `pg`. Load the `express-backend` skill first.
- `frontend/` — SolidJS + Tailwind. Components run once — read `props.x` (never
  destructure). Load the `solid-frontend` skill first.
- `docker-compose.yml` — db + backend + frontend on one network. Nothing on the host.

## Working rules
- Secrets only in `.env` (gitignored). Verify auth server-side; never trust the client.
- Smallest slice first; reuse before adding; leave one runnable check for real logic.
- Load the matching `~/.claude/skills/*` skill before working in its domain.
- **Architecture: Actions orchestrate, services centralize mechanics.** Routes (+ middleware +
  background orchestrators) own auth, validation, state transitions, and error classification;
  `services/`+`lib/` own reusable, DB-free, explicit-input mechanics. Extract a shared block only
  when 2+ callers repeat it (e.g. `enqueueCall`, `fathomFetch`). Load the **`code-structure`** skill
  before adding or refactoring cross-cutting logic. Full map: **`ARCHITECTURE.md`**.
