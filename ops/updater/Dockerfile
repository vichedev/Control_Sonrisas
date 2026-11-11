# Actualizador de Sonrisas: ejecuta deploy.sh cuando la app lo pide (ver updater.sh).
# Imagen mínima: cliente Docker (con compose y buildx) + git + bash + jq.
FROM docker:27-cli

RUN apk add --no-cache bash git jq coreutils util-linux-misc tzdata openssh-client ca-certificates \
    && (docker compose version >/dev/null 2>&1 || apk add --no-cache docker-cli-compose)

COPY updater.sh /usr/local/bin/sonrisas-updater
RUN chmod 755 /usr/local/bin/sonrisas-updater

ENTRYPOINT ["/usr/local/bin/sonrisas-updater"]
