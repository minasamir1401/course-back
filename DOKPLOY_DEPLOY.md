# Dokploy Deploy (Frontend + Backend)

## 1) Create Project
- In Dokploy, create a new project.
- Connect your Git repository.

## 2) Deploy Method
- Choose **Docker Compose** deployment.
- Use the root `docker-compose.yml`.

## 3) Environment Variables
Set these variables in Dokploy (from `.env.dokploy.example`):

- `DATABASE_URL`
- `JWT_SECRET`
- `BACKEND_PORT` (optional, default `5000`)
- `NEXT_PUBLIC_API_URL` (must end with `/api`)
- `BACKEND_ORIGIN` (same backend domain, without `/api`)
- `FRONTEND_PORT` (optional, default `3000`)

## 4) Domains
- Map frontend service to your app domain (example: `app.your-domain.com`).
- Map backend service to API domain (example: `api.your-domain.com`).

## 5) First Deploy
- Click Deploy.
- Wait until both health checks are green.

## 6) Verify
- Backend health: `https://api.your-domain.com/api/health`
- Frontend: `https://app.your-domain.com`

## Notes
- Backend uses the safe production startup script. It runs `prisma migrate deploy`
  only when migration files exist; it never runs `prisma db push --accept-data-loss`.
- Do not override the backend start command in Dokploy. Leave it empty so the
  Dockerfile runs `node src/scripts/start-production.js` (or set it to
  `npm start` when Dokploy requires a value).
- If `NEXT_PUBLIC_API_URL`/`BACKEND_ORIGIN` changed, redeploy frontend so build args are refreshed.
