# syntax=docker/dockerfile:1

# ---------- 1) Build: instala todo, genera Prisma y compila el front ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Primero solo los package.json: Docker reutiliza esta capa si las dependencias no cambian.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY . .
# prisma generate no se conecta a la BD, pero la config exige una URL: usamos una de mentira.
RUN DATABASE_URL="sqlserver://build:1433;database=build" npm run db:generate -w @kanban/api \
 && npm run build \
 && npm prune --omit=dev

# ---------- 2) Runtime: solo lo necesario para ejecutar ----------
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/apps/web/package.json ./apps/web/

USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth/me').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
