# syntax=docker/dockerfile:1
# ---------- Etapa 1: build (frontend + backend) ----------
# Vite 8 necesita Node >= 20.19
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY client ./client

# build:web → public/ (SPA)   ·   build:api → dist/ (NestJS + CLI de migraciones y respaldos)
RUN npm run build && npm prune --omit=dev

# ---------- Etapa 2: runtime ----------
FROM node:22-bookworm-slim AS runner

# Cliente de PostgreSQL de la MISMA versión mayor que el servidor (postgres:16):
# pg_dump/pg_restore para los respaldos. Debian trae una versión más vieja, por eso
# se usa el repositorio oficial PGDG.
ARG PG_MAJOR=16
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl tini tzdata; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}"; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version

# Zona horaria del contenedor. El valor real lo pisa la variable TZ de docker-compose.
ENV TZ=America/Guayaquil
RUN ln -fs /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo "$TZ" > /etc/timezone

# Metadatos de versión (los pasa deploy.sh: tag de git, commit y fecha de build).
ARG APP_VERSION=""
ARG APP_COMMIT=""
ARG APP_BUILT_AT=""
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    APP_BUILT_AT=${APP_BUILT_AT}
LABEL org.opencontainers.image.title="sonrisas-api" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_COMMIT}" \
      org.opencontainers.image.created="${APP_BUILT_AT}" \
      org.opencontainers.image.source="https://github.com/vichedev/Control_Sonrisas"

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY package.json ./

# Carpetas persistentes (volúmenes): fotos, sesión del WhatsApp, respaldos y tareas del
# actualizador. Se crean con dueño `node` para que un volumen NUEVO herede esos permisos.
RUN mkdir -p /app/uploads /app/.wa-auth /backups /ops/jobs /ops/status \
    && chown -R node:node /app/uploads /app/.wa-auth /backups /ops \
    && chmod 750 /backups /ops/jobs

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
