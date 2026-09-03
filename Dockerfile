# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Install openssl for Prisma
RUN apt-get update && apt-get install -y openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --include=dev

COPY . .

RUN npx prisma generate
RUN npm run build

# Stage 2: Production
FROM node:22-slim

WORKDIR /app

# Install openssl for Prisma and PM2 globally
RUN apt-get update && apt-get install -y openssl && npm install -g pm2

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/scripts ./src/scripts

# NOTE: Do NOT copy backup-*.json into the image.
# Backups are large files that cause OOM during startup JSON parsing.
# Persistent backups are handled via the /app/backups mounted volume.

# Create uploads and backups directories for file storage
RUN mkdir -p /app/uploads/backups

# Declare volumes so Dokploy can mount persistent storage
VOLUME ["/app/uploads"]

EXPOSE 5000

# Healthcheck — give more time for startup recovery scripts
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://localhost:5000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Set heap limit to 1024 MB per worker to fit perfectly in 7GB RAM (with Frontend & OS)
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Start production through a guarded wrapper that only runs migrate deploy when
# real migration history exists, preventing P3005 on baseline production DBs.
CMD ["node", "src/scripts/start-production.js"]
