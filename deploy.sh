#!/usr/bin/env bash
# ============================================================
# Sonrisas — despliegue, actualización, vuelta atrás y respaldos (Docker Compose)
# ============================================================
# Uso:  ./deploy.sh <comando> [opciones]
#
#   install                 Primera instalación (build + up + seed). Idempotente.
#   update [vX.Y.Z|latest]  Actualiza a una versión publicada (tag de git), con respaldo
#                           previo automático y VUELTA ATRÁS automática si algo falla.
#   rollback [--restore-db] Vuelve a la versión anterior que funcionaba.
#                           --restore-db: además restaura la BD del respaldo previo a la
#                           actualización (se pierde lo registrado desde entonces).
#   backup                  Respaldo manual (BD + fotos) al volumen de respaldos.
#   restore <archivo>       Restaura un respaldo (con respaldo de seguridad previo).
#   backups                 Lista los respaldos.
#   verify <archivo>        Comprueba la integridad de un respaldo.
#   export <archivo> [dest] Copia un respaldo del volumen al servidor (para sacarlo fuera).
#   status                  Estado de contenedores, versión y últimos respaldos.
#   logs [servicio]         Logs en vivo (por defecto: api).
#   version                 Versión instalada.
#   versions                Versiones publicadas (tags del repositorio).
#   history                 Historial de actualizaciones.
#   migrations              Estado de las migraciones de la BD.
#   up | restart | stop     Levantar / reiniciar / detener (stop NO borra datos).
#   admin                   Crea la cuenta de dirección o le cambia la contraseña
#                           (la pide oculta; no se guarda en disco).
#   psql                    Consola de PostgreSQL.
#   shell                   Shell dentro del contenedor api.
#   redeploy                Reconstruye el código actual (sin cambiar de versión), con
#                           respaldo previo y vuelta atrás automática.
#   help                    Esta ayuda.
#
# Opciones generales: --yes (no preguntar), --force.
# Modo de acceso (PUBLIC_MODE en .env.production): http = puerto directo APP_PORT (8986);
# https = Caddy en 80/443. Todas las órdenes activan el perfil de Caddy según el modo.
# ============================================================

set -Eeuo pipefail

# --- Se ejecuta desde una COPIA: `git checkout` cambia este archivo durante la actualización
if [ -z "${SONRISAS_DEPLOY_COPY:-}" ]; then
  _self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _copy="$(mktemp "${TMPDIR:-/tmp}/sonrisas-deploy.XXXXXX")"
  cp "${BASH_SOURCE[0]}" "$_copy"
  SONRISAS_DEPLOY_COPY="$_copy" SONRISAS_DIR="${SONRISAS_DIR:-$_self_dir}" exec bash "$_copy" "$@"
fi

PROJECT_DIR="$(cd "$SONRISAS_DIR" && pwd)"
# Contraseña de dirección que pasa install.sh: se guarda en una variable NO exportada y se
# quita del entorno para que no la hereden docker ni otros procesos.
ADMIN_PW_IN="${SONRISAS_ADMIN_PASSWORD:-}"
unset SONRISAS_ADMIN_PASSWORD
cd "$PROJECT_DIR"

ENV_FILE="$PROJECT_DIR/.env.production"
STATE_DIR="$PROJECT_DIR/ops/state"
STATE_FILE="$STATE_DIR/current.env"
HISTORY_FILE="$STATE_DIR/history.jsonl"
IMAGE="sonrisas-api"
API_CT="sonrisas_api"
DB_CT="sonrisas_db"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-150}"
VERSION_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'
BACKUP_RE='^sonrisas-backup-[0-9]{8}-[0-9]{6}-(nightly|manual|pre-update|pre-restore|pre-rollback|uploaded)\.tar(\.enc)?$'

ASSUME_YES=0
FORCE=0
RESTORE_DB=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --yes|-y) ASSUME_YES=1 ;;
    --force) FORCE=1 ;;
    --restore-db) RESTORE_DB=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
[ "${SONRISAS_NONINTERACTIVE:-0}" = "1" ] && ASSUME_YES=1

if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; CYAN=''; BOLD=''; NC=''
fi
log()  { echo -e "${GREEN}==>${NC} $*"; }
info() { echo -e "${CYAN}-->${NC} $*"; }
warn() { echo -e "${YELLOW}!! ${NC}$*"; }
err()  { echo -e "${RED}xx ${NC}$*" >&2; }
die()  { err "$*"; exit 1; }

cleanup() { rm -f "${SONRISAS_DEPLOY_COPY:-}"; }
trap cleanup EXIT

# Modo de acceso (PUBLIC_MODE): http = puerto directo (APP_PORT, sin Caddy);
# https = Caddy en 80/443 (perfil "https" del compose). Sin PUBLIC_MODE (instalaciones
# anteriores a esta opción, que siempre usaban Caddy) = https.
public_mode() {
  local m; m="$(env_get PUBLIC_MODE | tr '[:upper:]' '[:lower:]')"
  case "$m" in http) echo http ;; *) echo https ;; esac
}
# Todas las órdenes de compose pasan por aquí: activan el perfil de Caddy sólo en https.
DC() {
  local prof=()
  [ "$(public_mode)" = "https" ] && prof=(--profile https)
  docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
    ${prof[@]+"${prof[@]}"} "$@"
}
# Caddy acorde al modo: en https lo levanta (recreándolo si se pide); en http lo retira
# si quedó de un modo https anterior (libera 80/443).
caddy_sync() { # [--force-recreate]
  if [ "$(public_mode)" = "https" ]; then
    DC up -d --no-deps "$@" caddy >/dev/null
  elif docker inspect sonrisas_caddy >/dev/null 2>&1; then
    info "Modo puerto directo: retiro Caddy (contenedor sonrisas_caddy)"
    docker rm -f sonrisas_caddy >/dev/null 2>&1 || true
  fi
}
# URL pública para mensajes.
public_url() {
  local u; u="$(env_get FRONTEND_URL)"; u="${u%%,*}"
  if [ -z "$u" ]; then
    if [ "$(public_mode)" = "https" ]; then u="https://$(env_get SITE_ADDRESS)"
    else u="http://$(env_get SITE_ADDRESS):$(env_get APP_PORT)"; fi
  fi
  printf '%s' "$u"
}

# ------------------------------------------------------------ utilidades
require_docker() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 \
    || die "Docker o Docker Compose v2 no disponibles. Instálalos con install.sh."
}
require_env() {
  [ -f "$ENV_FILE" ] || die "No existe .env.production. Ejecuta install.sh o copia .env.production.example."
}
require_git() {
  command -v git >/dev/null 2>&1 || die "git no está instalado."
  [ -d "$PROJECT_DIR/.git" ] || die "$PROJECT_DIR no es un repositorio git. Ver DEPLOY.md → 'Instalación existente sin git'."
  git config --global --get-all safe.directory 2>/dev/null | grep -qx "$PROJECT_DIR" \
    || git config --global --add safe.directory "$PROJECT_DIR" 2>/dev/null || true
}

# Lee una variable del .env sin ejecutarlo (los valores pueden tener espacios o '$').
env_get() {
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  v="${v%$'\r'}"
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  printf '%s' "$v"
}
# Fija una variable en .env.production (añade o reemplaza la línea).
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"; printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
  chmod 600 "$ENV_FILE"
}

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  local ans
  read -r -p "$1 [s/N] " ans </dev/tty || return 1
  [[ "$ans" =~ ^[sSyY]$ ]]
}

state_get() { [ -f "$STATE_FILE" ] && grep -E "^$1=" "$STATE_FILE" | tail -n1 | cut -d= -f2- || true; }
state_set() {
  mkdir -p "$STATE_DIR"; touch "$STATE_FILE"
  local tmp; tmp="$(mktemp)"
  grep -vE "^$1=" "$STATE_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$STATE_FILE"; rm -f "$tmp"
}

json_escape() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/ }"; printf '%s' "$s"; }
history_add() { # action status from to backup message
  mkdir -p "$STATE_DIR"
  printf '{"at":"%s","action":"%s","status":"%s","from":"%s","to":"%s","backup":"%s","message":"%s","by":"%s"}\n' \
    "$(date -Iseconds)" "$1" "$2" "$(json_escape "$3")" "$(json_escape "$4")" "$(json_escape "$5")" \
    "$(json_escape "$6")" "$(json_escape "${SONRISAS_JOB_BY:-$(whoami)@$(hostname)}")" >> "$HISTORY_FILE"
}

LOCK_FD=9
acquire_lock() {
  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/deploy.lock"
  if command -v flock >/dev/null 2>&1; then
    flock -n 9 || die "Hay otra operación de despliegue en curso."
  fi
}

current_version() {
  local v; v="$(state_get CURRENT_VERSION)"
  if [ -z "$v" ] && [ -d .git ]; then v="$(git describe --tags --exact-match HEAD 2>/dev/null || true)"; fi
  if [ -z "$v" ] && [ -d .git ]; then v="dev-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"; fi
  printf '%s' "${v:-desconocida}"
}

image_exists() { docker image inspect "$1" >/dev/null 2>&1; }

# ------------------------------------------------------------ validaciones
validate_env() {
  local dbp jwt site
  dbp="$(env_get DB_PASSWORD)"; jwt="$(env_get JWT_SECRET)"; site="$(env_get SITE_ADDRESS)"
  case "$dbp" in
    ""|postgres|cambia-esta-clave-fuerte|password|changeme) die "DB_PASSWORD vacía o por defecto. Pon una clave fuerte (openssl rand -hex 24).";;
  esac
  [ "${#dbp}" -ge 16 ] || die "DB_PASSWORD demasiado corta (mínimo 16 caracteres)."
  [ "${#jwt}" -ge 32 ] || die "JWT_SECRET debe tener al menos 32 caracteres (openssl rand -base64 48)."
  [[ "$jwt" =~ genera-una-cadena|changeme|placeholder ]] && die "JWT_SECRET es el valor de ejemplo. Genera uno nuevo."
  local mode port; mode="$(public_mode)"; port="$(env_get APP_PORT)"
  if [ "$mode" = "https" ]; then
    [ -n "$site" ] && [ "$site" != "tu-dominio.com" ] || die "Modo https: configura SITE_ADDRESS (dominio o IP) en .env.production."
  else
    [ -n "$(env_get FRONTEND_URL)" ] || die "Modo http: configura FRONTEND_URL (p. ej. http://203.0.113.10:8986) en .env.production."
  fi
  if [ -n "$port" ] && ! [[ "$port" =~ ^[0-9]{1,5}$ && "$port" -ge 1 && "$port" -le 65535 ]]; then
    die "APP_PORT inválido: $port"
  fi
  [ -n "$(env_get ADMIN_PASSWORD)" ] && warn "ADMIN_PASSWORD tiene valor en .env.production: no hace falta guardarla; se borrará tras crear la cuenta (./deploy.sh admin)."
  local key; key="$(env_get BACKUP_ENCRYPTION_KEY)"
  if [ -n "$key" ] && [ "${#key}" -lt 16 ]; then die "BACKUP_ENCRYPTION_KEY demasiado corta (mínimo 16; recomendado 32+)."; fi
  [ -z "$key" ] && warn "Los respaldos NO se cifran (BACKUP_ENCRYPTION_KEY vacía). Recomendado activarlo."
  local perms; perms="$(stat -c %a "$ENV_FILE" 2>/dev/null || echo 600)"
  [ "$perms" = "600" ] || { chmod 600 "$ENV_FILE"; info ".env.production → permisos 600"; }
}

# Ajustes de versiones anteriores del .env (con copia de seguridad del archivo).
migrate_env_file() {
  local changed=0
  if [ "$(env_get DB_SYNC)" = "true" ]; then
    cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
    env_set DB_SYNC false; changed=1
    warn "DB_SYNC=true → false: en producción el esquema se gestiona con migraciones (synchronize puede borrar columnas)."
  fi
  if [ -z "$(env_get SONRISAS_DIR)" ]; then env_set SONRISAS_DIR "$PROJECT_DIR"; changed=1; fi
  # Instalaciones anteriores al modo "puerto directo": siempre tenían Caddy delante.
  # Se fija explícitamente para que nada cambie (8986 sólo en local, proxy de confianza).
  if ! grep -qE '^PUBLIC_MODE=' "$ENV_FILE"; then
    env_set PUBLIC_MODE https; changed=1
    grep -qE '^APP_PORT=' "$ENV_FILE" || env_set APP_PORT 8986
    grep -qE '^APP_BIND=' "$ENV_FILE" || env_set APP_BIND 127.0.0.1
    grep -qE '^TRUST_PROXY=' "$ENV_FILE" || env_set TRUST_PROXY true
    info "PUBLIC_MODE=https (instalación con Caddy); la app también escucha en 127.0.0.1:8986"
  fi
  [ "$changed" = "1" ] && info ".env.production actualizado" || true
}

# ------------------------------------------------------------ docker helpers
api_image_id() { docker image inspect -f '{{.Id}}' "$IMAGE:current" 2>/dev/null || true; }

build_image() { # tag
  local tag="$1" commit built ver
  commit="$(git rev-parse --short HEAD 2>/dev/null || echo '')"
  built="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ver="${tag#v}"
  log "Construyendo imagen $IMAGE:$tag (commit $commit)…"
  DOCKER_BUILDKIT=1 docker build \
    --build-arg "APP_VERSION=$ver" --build-arg "APP_COMMIT=$commit" --build-arg "APP_BUILT_AT=$built" \
    -t "$IMAGE:$tag" "$PROJECT_DIR"
}

# Volúmenes creados por versiones antiguas (p. ej. respaldos como root): dueño = node.
fix_permissions() {
  local tag="${1:-current}" vol
  for vol in sonrisas_sonrisas_backups sonrisas_sonrisas_ops_jobs; do
    if docker volume inspect "$vol" >/dev/null 2>&1; then
      docker run --rm -u 0 --network none --entrypoint sh -v "$vol:/v" "$IMAGE:$tag" \
        -c 'chown -R node:node /v && chmod 750 /v' >/dev/null 2>&1 || warn "No pude ajustar permisos de $vol"
    fi
  done
}

wait_api_healthy() { # timeout → 0 sano, 1 no
  local timeout="${1:-$HEALTH_TIMEOUT}" waited=0 st running want got
  want="$(api_image_id)"
  info "Esperando a que la api responda (hasta ${timeout}s)…"
  while [ "$waited" -lt "$timeout" ]; do
    running="$(docker inspect -f '{{.State.Running}}' "$API_CT" 2>/dev/null || echo false)"
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$API_CT" 2>/dev/null || echo missing)"
    got="$(docker inspect -f '{{.Image}}' "$API_CT" 2>/dev/null || true)"
    if [ "$running" = "true" ] && [ "$st" = "healthy" ] && [ "$got" = "$want" ]; then
      log "api sana"; return 0
    fi
    [ "$st" = "unhealthy" ] && { err "La api está 'unhealthy'"; return 1; }
    sleep 5; waited=$((waited + 5))
  done
  err "Tiempo de espera agotado: la api no quedó sana"
  return 1
}

db_exec_sql() { # sql → stdout
  DC exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"' sh "$1"
}
migrations_count() {
  local has
  has="$(db_exec_sql "SELECT to_regclass('public.migrations') IS NOT NULL" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "$has" = "t" ]; then db_exec_sql 'SELECT COUNT(*) FROM migrations' 2>/dev/null | tr -d '[:space:]'
  elif [ "$has" = "f" ]; then echo 0
  else echo "?"; fi
}

db_healthy() {
  [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$DB_CT" 2>/dev/null || true)" = "healthy" ]
}
ensure_db() {
  DC up -d db >/dev/null
  local i=0
  until db_healthy; do i=$((i+1)); [ "$i" -gt 40 ] && die "La base de datos no arranca."; sleep 3; done
}

# Ejecuta el CLI de respaldos en un contenedor efímero con la imagen indicada.
ops_cli() { # args…
  DC run --rm --no-deps -T api node dist/ops/cli.js "$@"
}

run_backup() { # kind → imprime nombre del archivo
  local kind="$1" out file
  out="$(ops_cli backup --kind "$kind" --by "${SONRISAS_JOB_BY:-deploy.sh}" 2>&1)" || { echo "$out" >&2; return 1; }
  echo "$out" | grep -v '^BACKUP_FILE=' >&2 || true
  file="$(echo "$out" | sed -n 's/^BACKUP_FILE=//p' | tail -n1 | tr -d '\r')"
  [[ "$file" =~ $BACKUP_RE ]] || { err "No obtuve el nombre del respaldo"; return 1; }
  printf '%s' "$file"
}

preflight() {
  local free_kb
  free_kb="$(df -Pk "$PROJECT_DIR" | awk 'NR==2{print $4}')"
  [ "${free_kb:-0}" -ge 2097152 ] || die "Menos de 2 GB libres en disco. Libera espacio antes de actualizar."
  local docker_root; docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  free_kb="$(df -Pk "$docker_root" 2>/dev/null | awk 'NR==2{print $4}')"
  [ "${free_kb:-0}" -ge 3145728 ] || die "Menos de 3 GB libres en $docker_root (imágenes y respaldos)."
  ensure_db
  info "Disco OK · base de datos OK"
}

prune_images() { # conserva current, previous y las 3 últimas versiones
  local keep tags t
  keep="$(state_get CURRENT_VERSION) $(state_get PREVIOUS_VERSION)"
  tags="$(docker image ls "$IMAGE" --format '{{.Tag}}' | grep -E "$VERSION_RE|^dev-|^local-" | sort -rV | tail -n +4 || true)"
  for t in $tags; do
    [[ " $keep " == *" $t "* ]] && continue
    docker image rm "$IMAGE:$t" >/dev/null 2>&1 && info "Imagen antigua eliminada: $t" || true
  done
}

# ------------------------------------------------------------ comandos
cmd_install() {
  require_docker; require_env; acquire_lock
  validate_env; migrate_env_file
  mkdir -p "$STATE_DIR"
  local ver ref
  if [ -d .git ]; then
    require_git
    ver="$(git describe --tags --exact-match HEAD 2>/dev/null || echo "dev-$(git rev-parse --short HEAD)")"
    ref="$(git rev-parse HEAD)"
  else
    ver="local-$(date +%Y%m%d%H%M)"; ref=""
  fi
  if image_exists "$IMAGE:current" && [ -n "$(state_get CURRENT_VERSION)" ]; then
    info "Ya hay una instalación ($(current_version)). Levanto los servicios sin reconstruir."
    info "Para cambiar de versión usa: ./deploy.sh update"
    DC up -d
    caddy_sync
    wait_api_healthy || die "La api no está sana. Revisa: ./deploy.sh logs"
    run_seed_after_install
    log "Listo: $(public_url)"
    return 0
  fi
  # Instalación anterior (sin este sistema de versiones) con datos: volcado SQL de seguridad.
  if docker volume inspect sonrisas_sonrisas_db_data >/dev/null 2>&1; then
    pre_install_dump
  fi
  build_image "$ver"
  image_exists "$IMAGE:latest" && docker tag "$IMAGE:latest" "$IMAGE:previous"
  docker tag "$IMAGE:$ver" "$IMAGE:current"
  log "Construyendo el actualizador…"
  DC build updater
  ensure_vapid
  fix_permissions current
  log "Levantando contenedores ($( [ "$(public_mode)" = https ] && echo "HTTPS con Caddy" || echo "puerto directo $(env_get APP_BIND):$(env_get APP_PORT)"))…"
  DC up -d
  caddy_sync
  wait_api_healthy 240 || { DC logs --tail 120 api; die "La api no arrancó. Revisa los logs de arriba."; }
  run_seed_after_install
  state_set CURRENT_VERSION "$ver"; state_set CURRENT_REF "$ref"
  state_set CURRENT_MIGRATIONS "$(migrations_count)"
  history_add install success "" "$ver" "" "Instalación inicial"
  log "Instalación lista: $(public_url)"
}

# ------------------------------------------------------------ cuenta de dirección
# Política de contraseñas de la app (src/common/password.validator.ts). Motivo o "".
password_problem() {
  local pw="$1" lower
  [ "${#pw}" -ge 10 ] || { echo "debe tener al menos 10 caracteres"; return; }
  [ "${#pw}" -le 128 ] || { echo "no puede superar los 128 caracteres"; return; }
  [[ "$pw" =~ [A-Za-zÁÉÍÓÚáéíóúÑñ] ]] || { echo "debe incluir al menos una letra"; return; }
  [[ "$pw" =~ [0-9] ]] || { echo "debe incluir al menos un número"; return; }
  [[ "$pw" =~ ^(.)\1+$ ]] && { echo "no puede ser el mismo carácter repetido"; return; }
  lower="$(printf '%s' "$pw" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    password1|password123|contrasena1|contrasena123|contraseña1|admin12345|administrador1|qwerty12345|asdf12345|1234567890|abcd123456|facetowork1|facetowork123|usuario123|trabajador1)
      echo "es demasiado común"; return ;;
  esac
  [[ "$lower" =~ ^(0123456789|abcdefghij|qwertyuiop) ]] && { echo "es demasiado predecible"; return; }
  echo ""
}

# Ejecuta el seed. La contraseña (si la hay) va por la ENTRADA ESTÁNDAR del contenedor:
# no queda en disco, ni en el entorno del contenedor, ni en la lista de procesos.
seed_admin() { # email password(""=no) reset(0|1) [nombre]
  local email="$1" pw="$2" reset="$3" name="${4:-}"
  local envs=(-e "ADMIN_EMAIL=$email" -e "SEED_RESET_PASSWORD=$reset")
  [ -n "$name" ] && envs+=(-e "ADMIN_NAME=$name")
  if [ -n "$pw" ]; then
    printf '%s\n' "$pw" | DC exec -T "${envs[@]}" -e ADMIN_PASSWORD_STDIN=1 api node dist/seed.js
  else
    DC exec -T "${envs[@]}" api node dist/seed.js </dev/null
  fi
}

# Si .env.production aún guarda ADMIN_PASSWORD (instalación manual), se vacía y se
# recrea la api para que tampoco quede en su entorno.
scrub_admin_password() {
  [ -n "$(env_get ADMIN_PASSWORD)" ] || return 0
  env_set ADMIN_PASSWORD ""
  info "ADMIN_PASSWORD borrada de .env.production (la cuenta ya existe; para cambiarla: ./deploy.sh admin)"
  DC up -d --no-deps api >/dev/null && wait_api_healthy || warn "Revisa la api: ./deploy.sh status"
}

# Paso de seed de `install`: con la contraseña que pasa install.sh (SONRISAS_ADMIN_PASSWORD,
# sólo en el entorno del proceso) o, en instalaciones manuales, con la de .env.production.
run_seed_after_install() {
  local email pw
  email="${SONRISAS_ADMIN_EMAIL:-$(env_get ADMIN_EMAIL)}"
  pw="${ADMIN_PW_IN:-$(env_get ADMIN_PASSWORD)}"
  ADMIN_PW_IN=""
  if [ -z "$email" ]; then warn "Falta ADMIN_EMAIL: crea la cuenta de dirección con ./deploy.sh admin"; return 0; fi
  log "Cuenta de dirección (seed)…"
  if seed_admin "$email" "$pw" "$( [ -n "$pw" ] && echo 1 || echo 0 )"; then
    scrub_admin_password
    [ "$email" = "$(env_get ADMIN_EMAIL)" ] || env_set ADMIN_EMAIL "$email"
  else
    warn "El seed falló. Reintenta con: ./deploy.sh admin"
  fi
}

# `./deploy.sh admin`: crea la cuenta de dirección o le cambia la contraseña (la pide
# oculta, dos veces). Sin terminal usa ADMIN_PASSWORD de .env.production (y la borra).
cmd_admin() {
  require_docker; require_env
  local email pw p2 why name
  if ! { : </dev/tty; } 2>/dev/null || [ "${SONRISAS_NONINTERACTIVE:-0}" = "1" ]; then
    email="$(env_get ADMIN_EMAIL)"; pw="${ADMIN_PW_IN:-$(env_get ADMIN_PASSWORD)}"
    [ -n "$email" ] || die "Falta ADMIN_EMAIL en .env.production."
    [ -n "$pw" ] || die "Sin terminal: ejecuta ./deploy.sh admin en una sesión interactiva (pide la contraseña) o pon ADMIN_PASSWORD en .env.production (se borra al terminar)."
    seed_admin "$email" "$pw" 1 && scrub_admin_password
    return
  fi
  echo -e "${BOLD}Cuenta de dirección${NC}: se crea si no existe, o se le pone la contraseña nueva."
  read -r -p "Usuario (correo) [$(env_get ADMIN_EMAIL)]: " email </dev/tty || true
  email="${email:-$(env_get ADMIN_EMAIL)}"
  [[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Correo inválido."
  echo "La contraseña debe tener mínimo 10 caracteres, con al menos una letra y un número."
  while true; do
    read -r -s -p "Contraseña nueva: " pw </dev/tty || true; echo >/dev/tty
    why="$(password_problem "$pw")"
    [ -z "$why" ] || { echo "  La contraseña $why."; continue; }
    read -r -s -p "Repítela: " p2 </dev/tty || true; echo >/dev/tty
    [ "$pw" = "$p2" ] && break
    echo "  No coinciden."
  done
  name="$(env_get ADMIN_NAME)"
  seed_admin "$email" "$pw" 1 "$name" || die "No se pudo crear/actualizar la cuenta."
  pw=""; p2=""
  [ "$email" != "$(env_get ADMIN_EMAIL)" ] && env_set ADMIN_EMAIL "$email"
  scrub_admin_password
  log "Listo. Entra en $(public_url) con $email"
}

# Volcado SQL simple con las herramientas del propio contenedor de Postgres (no depende
# de la imagen de la api). Para instalaciones previas a este sistema de respaldos.
pre_install_dump() {
  local out="$PROJECT_DIR/exports/pre-install-$(date +%Y%m%d-%H%M%S).sql.gz"
  mkdir -p "$PROJECT_DIR/exports"; chmod 700 "$PROJECT_DIR/exports"
  log "Hay datos de una instalación anterior: volcado de seguridad → $out"
  ensure_db
  DC exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
    | gzip -9 > "$out" || die "No pude volcar la BD existente: no continúo."
  [ -s "$out" ] || die "El volcado de seguridad quedó vacío: no continúo."
  chmod 600 "$out"
}

# Claves VAPID (notificaciones push) si faltan.
ensure_vapid() {
  [ -n "$(env_get VAPID_PUBLIC_KEY)" ] && return 0
  local out pub priv
  out="$(docker run --rm --network none "$IMAGE:current" node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)" 2>/dev/null || true)"
  pub="${out%% *}"; priv="${out##* }"
  if [ -n "$pub" ] && [ -n "$priv" ] && [ "$pub" != "$priv" ]; then
    env_set VAPID_PUBLIC_KEY "$pub"; env_set VAPID_PRIVATE_KEY "$priv"
    info "Claves VAPID generadas para las notificaciones push"
  fi
}

# Núcleo común de update/redeploy: cambia la imagen current por `new_tag` con respaldo
# previo y vuelta atrás automática. Supone que el código (git) ya está en la versión nueva.
switch_to_image() { # new_tag prev_ver prev_ref new_ver new_ref action
  local new_tag="$1" prev_ver="$2" prev_ref="$3" new_ver="$4" new_ref="$5" action="$6"
  local backup mig_before mig_after

  fix_permissions "$new_tag"
  log "Deteniendo la api para un respaldo consistente…"
  DC stop api backup >/dev/null 2>&1 || true
  # Aplica cambios del servicio db del compose nuevo (p. ej. redes) antes de usarlo.
  ensure_db
  log "Respaldo previo a la actualización (BD + fotos)…"
  if ! backup="$(run_backup pre-update)"; then
    err "El respaldo previo falló: NO se actualiza."
    [ -n "$prev_ref" ] && [ "$prev_ref" != "$new_ref" ] && git -c advice.detachedHead=false checkout -q "$prev_ref" || true
    DC up -d --no-deps api backup >/dev/null; wait_api_healthy || true
    history_add "$action" aborted "$prev_ver" "$new_ver" "" "Falló el respaldo previo"
    exit 1
  fi
  log "Respaldo previo: $backup"
  mig_before="$(migrations_count)"

  image_exists "$IMAGE:current" && docker tag "$IMAGE:current" "$IMAGE:previous"
  docker tag "$IMAGE:$new_tag" "$IMAGE:current"
  log "Arrancando la versión $new_ver (las migraciones corren al iniciar)…"
  DC up -d --no-deps --force-recreate api

  if wait_api_healthy; then
    DC up -d --no-deps --force-recreate backup >/dev/null
    if [ "$(public_mode)" = "https" ] && [ -n "$prev_ref" ] && ! git diff --quiet "$prev_ref" HEAD -- Caddyfile 2>/dev/null; then
      log "Caddyfile cambió: reiniciando Caddy"; caddy_sync --force-recreate
    else
      caddy_sync
    fi
    mig_after="$(migrations_count)"
    state_set PREVIOUS_VERSION "$prev_ver"; state_set PREVIOUS_REF "$prev_ref"
    state_set PREVIOUS_MIGRATIONS "$mig_before"
    state_set CURRENT_VERSION "$new_ver"; state_set CURRENT_REF "$new_ref"
    state_set CURRENT_MIGRATIONS "$mig_after"
    state_set LAST_PRE_UPDATE_BACKUP "$backup"
    history_add "$action" success "$prev_ver" "$new_ver" "$backup" "Migraciones: $mig_before → $mig_after"
    prune_images
    log "Actualización completada: $prev_ver → $new_ver"
    if [ "${SONRISAS_IN_UPDATER:-0}" != "1" ] && ! git diff --quiet "${prev_ref:-HEAD}" HEAD -- ops/updater 2>/dev/null; then
      log "El actualizador cambió: reconstruyéndolo"; DC up -d --build --no-deps updater >/dev/null || true
    fi
    return 0
  fi

  # ---------------- vuelta atrás automática
  err "La versión $new_ver no arrancó bien. Últimas líneas del log:"
  DC logs --no-color --tail 80 api || true
  warn "VUELTA ATRÁS AUTOMÁTICA a $prev_ver…"
  mig_after="$(migrations_count)"
  DC stop api >/dev/null 2>&1 || true
  if image_exists "$IMAGE:previous"; then docker tag "$IMAGE:previous" "$IMAGE:current"; fi
  if [ -n "$prev_ref" ] && [ "$prev_ref" != "$new_ref" ]; then git -c advice.detachedHead=false checkout -q "$prev_ref"; fi
  ensure_db
  # Las migraciones corren en UNA transacción: si el contador no cambió, el esquema está
  # intacto y no hace falta restaurar (así no se pierde nada). Si cambió (o no se sabe),
  # se restaura el respaldo previo, tomado con la api detenida.
  local restored="no"
  if [ "$mig_after" != "$mig_before" ] || [ "$mig_after" = "?" ]; then
    warn "El esquema cambió ($mig_before → $mig_after): restaurando la BD del respaldo previo…"
    if ops_cli restore "$backup" --no-safety --no-uploads; then restored="sí"; else err "La restauración automática falló"; fi
  fi
  DC up -d --no-deps --force-recreate api backup >/dev/null
  if wait_api_healthy; then
    history_add "$action" rolled-back "$prev_ver" "$new_ver" "$backup" "Falló el arranque; vuelta atrás automática (BD restaurada: $restored)"
    err "La actualización falló y el sistema volvió a $prev_ver. Los datos están intactos."
  else
    history_add "$action" rollback-failed "$prev_ver" "$new_ver" "$backup" "Falló también la vuelta atrás"
    err "CRÍTICO: tampoco arrancó $prev_ver. Respaldo previo: $backup"
    err "Revisa: ./deploy.sh logs  ·  restaurar a mano: ./deploy.sh restore $backup"
    exit 2
  fi
  exit 1
}

cmd_update() {
  require_docker; require_env; require_git; acquire_lock
  validate_env
  local target="${1:-latest}" prev_ver prev_ref new_ref
  log "Buscando versiones publicadas…"
  git fetch --quiet --tags --force origin || die "No pude contactar el repositorio (git fetch)."
  if [ "$target" = "latest" ]; then
    target="$(git tag -l 'v*' --sort=-v:refname | grep -E "$VERSION_RE" | head -n1 || true)"
    [ -n "$target" ] || die "No hay versiones publicadas (tags vX.Y.Z)."
  fi
  [[ "$target" =~ $VERSION_RE ]] || die "Versión inválida: $target (formato vX.Y.Z)"
  git rev-parse -q --verify "refs/tags/$target" >/dev/null || die "No existe la versión $target"

  prev_ver="$(current_version)"; prev_ref="$(git rev-parse HEAD)"
  if [ "$prev_ver" = "$target" ] && [ "$FORCE" != "1" ]; then log "Ya estás en $target."; return 0; fi
  if [[ "$prev_ver" =~ $VERSION_RE ]] && [ "$FORCE" != "1" ]; then
    local newest; newest="$(printf '%s\n%s\n' "$prev_ver" "$target" | sort -V | tail -n1)"
    [ "$newest" = "$target" ] || die "$target es anterior a $prev_ver. Para volver atrás usa: ./deploy.sh rollback"
  fi
  [ -z "$(git status --porcelain --untracked-files=no)" ] || {
    git status --short --untracked-files=no
    die "Hay archivos del proyecto modificados a mano en el servidor (arriba). Guárdalos o descártalos (git stash) antes de actualizar."
  }
  confirm "¿Actualizar de $prev_ver a $target? (se hará un respaldo antes)" || die "Cancelado."

  preflight
  log "Cambiando el código a $target…"
  git -c advice.detachedHead=false checkout -q "refs/tags/$target"
  new_ref="$(git rev-parse HEAD)"
  migrate_env_file
  if ! build_image "$target"; then
    err "La compilación falló: el sistema sigue en $prev_ver sin cambios."
    git -c advice.detachedHead=false checkout -q "$prev_ref"
    history_add update build-failed "$prev_ver" "$target" "" "Falló la compilación"
    exit 1
  fi
  switch_to_image "$target" "$prev_ver" "$prev_ref" "$target" "$new_ref" update
}

cmd_redeploy() {
  require_docker; require_env; acquire_lock
  validate_env; migrate_env_file
  local prev_ver tag ref
  prev_ver="$(current_version)"
  ref="$( [ -d .git ] && git rev-parse HEAD || echo '')"
  tag="local-$(date +%Y%m%d%H%M%S)"
  confirm "¿Reconstruir y desplegar el código actual del servidor?" || die "Cancelado."
  preflight
  build_image "$tag" || die "La compilación falló; no se cambió nada."
  switch_to_image "$tag" "$prev_ver" "$ref" "$tag" "$ref" redeploy
}

cmd_rollback() {
  require_docker; require_env; acquire_lock
  local prev_ver prev_ref cur_ver cur_ref prev_mig mig_now pre_backup safety
  prev_ver="$(state_get PREVIOUS_VERSION)"; prev_ref="$(state_get PREVIOUS_REF)"
  cur_ver="$(current_version)"; cur_ref="$( [ -d .git ] && git rev-parse HEAD || echo '')"
  prev_mig="$(state_get PREVIOUS_MIGRATIONS)"; pre_backup="$(state_get LAST_PRE_UPDATE_BACKUP)"
  [ -n "$prev_ver" ] || die "No hay una versión anterior registrada."
  if [ "$RESTORE_DB" = "1" ] && [ -z "$pre_backup" ]; then die "No hay respaldo previo a la actualización registrado."; fi
  echo "Versión actual:   $cur_ver"
  echo "Volver a:         $prev_ver"
  [ "$RESTORE_DB" = "1" ] && warn "Se restaurará la BD de $pre_backup: se PIERDE lo registrado desde la actualización."
  confirm "¿Continuar?" || die "Cancelado."

  ensure_db
  if ! image_exists "$IMAGE:$prev_ver"; then
    [ -n "$prev_ref" ] || die "No está la imagen $prev_ver ni su commit para reconstruirla."
    require_git
    git -c advice.detachedHead=false checkout -q "$prev_ref"
    build_image "$prev_ver" || { git -c advice.detachedHead=false checkout -q "$cur_ref"; die "No pude reconstruir $prev_ver."; }
    git -c advice.detachedHead=false checkout -q "$cur_ref"
  fi

  DC stop api backup >/dev/null 2>&1 || true
  log "Respaldo de seguridad del estado actual…"
  safety="$(run_backup pre-rollback)" || { DC up -d --no-deps api backup >/dev/null; die "Falló el respaldo de seguridad: no se hace la vuelta atrás."; }
  mig_now="$(migrations_count)"

  if [ "$RESTORE_DB" != "1" ] && [[ "$prev_mig" =~ ^[0-9]+$ ]] && [[ "$mig_now" =~ ^[0-9]+$ ]] && [ "$mig_now" -gt "$prev_mig" ]; then
    local n=$((mig_now - prev_mig))
    log "Deshaciendo $n migración(es) de $cur_ver (conserva los datos)…"
    DC run --rm --no-deps -T api node dist/database/migrate-cli.js revert "$n" \
      || { DC up -d --no-deps api backup >/dev/null; die "No se pudieron deshacer las migraciones. Usa: ./deploy.sh rollback --restore-db"; }
  fi

  if [ -n "$prev_ref" ] && [ -d .git ]; then git -c advice.detachedHead=false checkout -q "$prev_ref"; fi
  ensure_db
  docker tag "$IMAGE:current" "$IMAGE:previous" 2>/dev/null || true
  docker tag "$IMAGE:$prev_ver" "$IMAGE:current"

  if [ "$RESTORE_DB" = "1" ]; then
    log "Restaurando la BD previa a la actualización ($pre_backup)…"
    ops_cli restore "$pre_backup" --no-safety --no-uploads || die "Falló la restauración. Respaldo de seguridad: $safety"
  fi
  DC up -d --no-deps --force-recreate api backup >/dev/null
  if wait_api_healthy; then
    state_set CURRENT_VERSION "$prev_ver"; state_set CURRENT_REF "$prev_ref"
    state_set PREVIOUS_VERSION "$cur_ver"; state_set PREVIOUS_REF "$cur_ref"
    state_set CURRENT_MIGRATIONS "$(migrations_count)"; state_set PREVIOUS_MIGRATIONS "$mig_now"
    state_set LAST_PRE_UPDATE_BACKUP "$safety"
    history_add rollback success "$cur_ver" "$prev_ver" "$safety" "$( [ "$RESTORE_DB" = 1 ] && echo "BD restaurada de $pre_backup" || echo "Datos conservados")"
    log "Listo: el sistema está en $prev_ver. Respaldo del estado anterior: $safety"
  else
    history_add rollback failed "$cur_ver" "$prev_ver" "$safety" "La versión anterior no arrancó"
    die "La versión $prev_ver no arrancó. Respaldo de seguridad: $safety (./deploy.sh restore $safety)"
  fi
}

cmd_backup() {
  require_docker; require_env; acquire_lock
  ensure_db
  local f; f="$(run_backup manual)" || die "El respaldo falló."
  log "Respaldo creado: $f"
  info "Lista: ./deploy.sh backups  ·  copiarlo fuera: ./deploy.sh export $f"
}

cmd_backups() { require_docker; require_env; ops_cli list; }

cmd_verify() {
  require_docker; require_env
  local f="${1:-}"; [[ "$f" =~ $BACKUP_RE ]] || die "Uso: ./deploy.sh verify <sonrisas-backup-…>"
  ops_cli verify "$f"
}

cmd_restore() {
  require_docker; require_env; acquire_lock
  local f="${1:-}"
  f="$(basename -- "$f")"
  [[ "$f" =~ $BACKUP_RE ]] || die "Uso: ./deploy.sh restore <sonrisas-backup-AAAAMMDD-HHMMSS-tipo.tar[.enc]> (ver ./deploy.sh backups)"
  warn "Vas a RESTAURAR $f. La BD y las fotos volverán a ese momento (las fotos se fusionan)."
  confirm "¿Continuar? Se hará antes un respaldo de seguridad del estado actual." || die "Cancelado."
  ensure_db
  log "Verificando el respaldo…"
  ops_cli verify "$f" || die "El respaldo no pasó la verificación: no se restaura."
  DC stop api backup >/dev/null 2>&1 || true
  if ! ops_cli restore "$f"; then
    err "La restauración falló; no se cambió la base de datos."
    DC up -d --no-deps api backup >/dev/null; wait_api_healthy || true
    history_add restore failed "$(current_version)" "" "$f" "Falló la restauración"
    exit 1
  fi
  DC up -d --no-deps --force-recreate api backup >/dev/null
  if wait_api_healthy; then
    state_set CURRENT_MIGRATIONS "$(migrations_count)"
    history_add restore success "$(current_version)" "" "$f" "Restaurado"
    log "Restauración completada."
  else
    err "La api no arrancó con la BD restaurada: volviendo a la BD anterior…"
    DC stop api >/dev/null 2>&1 || true
    ops_cli swap-prev || true
    DC up -d --no-deps --force-recreate api >/dev/null; wait_api_healthy || true
    history_add restore rolled-back "$(current_version)" "" "$f" "La api no arrancó; se volvió a la BD anterior"
    exit 1
  fi
}

cmd_export() {
  require_docker; require_env
  local f="${1:-}" dest="${2:-$PROJECT_DIR/exports}"
  [[ "$f" =~ $BACKUP_RE ]] || die "Uso: ./deploy.sh export <archivo> [carpeta]"
  mkdir -p "$dest"; chmod 700 "$dest"
  local side="${f%.enc}"; side="${side%.tar}.json"
  docker run --rm --network none -u 0 -v sonrisas_sonrisas_backups:/b:ro -v "$dest:/out" --entrypoint sh "$IMAGE:current" \
    -c 'cp "/b/$1" /out/ && { cp "/b/$2" /out/ 2>/dev/null || true; } && chmod 600 /out/*' sh "$f" "$side" \
    || die "No se pudo copiar."
  log "Copiado a $dest/$f"
}

cmd_status() {
  require_docker; require_env
  echo -e "${BOLD}Versión:${NC} $(current_version)   (anterior: $(state_get PREVIOUS_VERSION || true))"
  DC ps
  echo
  docker inspect -f 'api: {{.State.Status}} / salud: {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$API_CT" 2>/dev/null || true
  echo -e "\n${BOLD}Últimos respaldos:${NC}"
  ops_cli list 2>/dev/null | head -n 8 || true
}

cmd_version() {
  echo "Instalada: $(current_version)"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$API_CT" 2>/dev/null | grep -E '^APP_(VERSION|COMMIT|BUILT_AT)=' || true
}

cmd_versions() {
  require_git
  git fetch --quiet --tags --force origin || warn "No pude actualizar la lista (sin conexión)"
  local cur; cur="$(current_version)"
  git tag -l 'v*' --sort=-v:refname | grep -E "$VERSION_RE" | head -n 20 | while read -r t; do
    if [ "$t" = "$cur" ]; then echo "* $t  (instalada)"; else echo "  $t  $(git log -1 --format=%cs "$t" 2>/dev/null)"; fi
  done || true
}

cmd_history() { [ -f "$HISTORY_FILE" ] && tail -n 30 "$HISTORY_FILE" || echo "(sin historial)"; }
cmd_migrations() { require_docker; require_env; DC exec -T api node dist/database/migrate-cli.js show; }

cmd_help() { sed -n '2,36p' "$SONRISAS_DEPLOY_COPY" | sed 's/^# \{0,1\}//'; }

case "${1:-help}" in
  install|full) cmd_install ;;
  update)     shift; cmd_update "${1:-latest}" ;;
  redeploy)   cmd_redeploy ;;
  rollback)   cmd_rollback ;;
  backup)     cmd_backup ;;
  backups)    cmd_backups ;;
  verify)     shift; cmd_verify "${1:-}" ;;
  restore)    shift; cmd_restore "${1:-}" ;;
  export)     shift; cmd_export "${1:-}" "${2:-}" ;;
  status)     cmd_status ;;
  logs)       shift; require_env; DC logs -f --tail 200 "${1:-api}" ;;
  version)    cmd_version ;;
  versions)   cmd_versions ;;
  history)    cmd_history ;;
  migrations) cmd_migrations ;;
  up)         require_docker; require_env; validate_env; migrate_env_file; DC up -d; caddy_sync; info "$(public_url)" ;;
  restart)    require_docker; require_env; DC restart ;;
  stop)       require_docker; require_env; DC stop ;;
  admin)      cmd_admin ;;
  psql)       require_docker; require_env; DC exec db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' ;;
  shell)      require_docker; require_env; DC exec api sh ;;
  help|-h|--help) cmd_help ;;
  *) err "Comando desconocido: $1"; cmd_help; exit 1 ;;
esac
