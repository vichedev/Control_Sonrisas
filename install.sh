#!/usr/bin/env bash
# ============================================================
# Sonrisas — instalador para Ubuntu / Debian
#
#   curl -fsSL https://raw.githubusercontent.com/vichedev/Control_Sonrisas/main/install.sh | sudo bash
#
# INSTALACIÓN RÁPIDA (por defecto) — pensada para Nginx Proxy Manager:
#   sólo pregunta el correo y la contraseña de dirección y el dominio que tienes en NPM
#   (p. ej. sonrisitas.maat.ec). Publica la app en el puerto 8986 (docker 8986:3000) para que
#   NPM la reenvíe con HTTPS: Destination = http://IP-DEL-SERVIDOR:8986.
#   Todo lo demás va por defecto (Sonrisitas, America/Guayaquil, respaldos cifrados…).
#   Cuestionario completo (Caddy, otros puertos…): SONRISAS_ADVANCED=1
#
# Qué hace: instala Docker si falta, descarga el proyecto en /opt/sonrisas (última versión
# publicada), genera secretos fuertes, escribe .env.production (permisos 600), abre el puerto
# en ufw si está activo, construye y arranca todo, crea la cuenta de dirección y muestra un resumen.
#
# La contraseña de dirección NUNCA se guarda en disco: se entrega al contenedor por la
# entrada estándar al crear la cuenta.
#
# Modos de acceso:
#   1) Puerto directo (por defecto): http://IP-o-dominio:8986  (docker 8986:3000, sin Caddy)
#   2) HTTPS con dominio: Caddy + Let's Encrypt en 80/443
#
# Volver a ejecutarlo es seguro: no toca los volúmenes de datos y .env.production sólo se
# reescribe si eliges "reconfigurar" (conservando las claves de la BD, JWT y respaldos).
# Para cambiar de versión usa ./deploy.sh update.
#
# Sin preguntas (variables de entorno):
#   SONRISAS_NONINTERACTIVE=1 PUBLIC_MODE=http PUBLIC_HOST=203.0.113.10 APP_PORT=8986 \
#   ADMIN_EMAIL=direccion@midominio.com ADMIN_PASSWORD='UnaClaveLarga2026' \
#   ADMIN_NAME="Dirección" COMPANY_NAME="Sonrisitas" COMPANY_TAGLINE="Centro de Desarrollo Infantil" \
#   TZ=America/Guayaquil WHATSAPP_COUNTRY_CODE=593 BACKUP_ENCRYPT=1 bash install.sh
# Modo HTTPS: PUBLIC_MODE=https PUBLIC_HOST=asistencia.midominio.com [EXPOSE_APP_PORT=1]
# Proxy propio con TLS delante (modo http): BEHIND_PROXY=1 PUBLIC_URL=https://asistencia.midominio.com
# Otras: SONRISAS_DIR (/opt/sonrisas), SONRISAS_REPO, SONRISAS_REF (tag o rama),
#        KEEP_ENV=1|0 (si ya existe .env.production; por defecto se conserva).
# ============================================================
set -Eeuo pipefail

REPO_URL="${SONRISAS_REPO:-https://github.com/vichedev/Control_Sonrisas.git}"
DIR="${SONRISAS_DIR:-/opt/sonrisas}"
REF="${SONRISAS_REF:-}"

if [ -t 1 ]; then G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'; else G=''; Y=''; R=''; B=''; N=''; fi
log()  { echo -e "${G}==>${N} $*"; }
warn() { echo -e "${Y}!! ${N}$*"; }
die()  { echo -e "${R}xx ${N}$*" >&2; exit 1; }

# Con `curl | bash` la entrada estándar es el propio script: las preguntas se leen de la terminal.
INTERACTIVE=1
if [ "${SONRISAS_NONINTERACTIVE:-0}" = "1" ] || ! { : </dev/tty; } 2>/dev/null; then INTERACTIVE=0; fi

ask() { # variable "pregunta" "por defecto" regex "mensaje de error"
  local __var="$1" q="$2" def="$3" re="$4" msg="$5" val="${!1:-}"
  if [ -n "$val" ]; then
    [[ "$val" =~ $re ]] || die "$__var inválido: $msg"
    printf -v "$__var" '%s' "$val"; return
  fi
  if [ "$INTERACTIVE" = "0" ]; then
    [ -n "$def" ] || die "Falta $__var (modo sin preguntas)."
    [[ "$def" =~ $re ]] || die "$__var inválido: $msg"
    printf -v "$__var" '%s' "$def"; return
  fi
  while true; do
    read -r -p "$q${def:+ [$def]}: " val </dev/tty || true
    val="${val:-$def}"
    if [[ "$val" =~ $re ]]; then printf -v "$__var" '%s' "$val"; return; fi
    echo "  $msg"
  done
}

yesno() { # variable "pregunta" defecto(s|n) → deja 1/0 en la variable
  local __var="$1" q="$2" def="$3" val="${!1:-}" a hint
  case "$val" in 1|s|S|y|Y|si|sí|yes) printf -v "$__var" 1; return ;; 0|n|N|no) printf -v "$__var" 0; return ;; esac
  if [ "$INTERACTIVE" = "0" ]; then
    [ "$def" = "s" ] && printf -v "$__var" 1 || printf -v "$__var" 0; return
  fi
  [ "$def" = "s" ] && hint="[S/n]" || hint="[s/N]"
  read -r -p "$q $hint " a </dev/tty || a=""
  a="${a:-$def}"
  [[ "$a" =~ ^[sSyY] ]] && printf -v "$__var" 1 || printf -v "$__var" 0
}

# Misma política que la app (src/common/password.validator.ts). Devuelve el motivo o "".
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

ask_password() { # → ADMIN_PW
  local p1 p2 why
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    why="$(password_problem "$ADMIN_PASSWORD")"
    [ -z "$why" ] || die "ADMIN_PASSWORD inválida: $why."
    ADMIN_PW="$ADMIN_PASSWORD"; return
  fi
  [ "$INTERACTIVE" = "1" ] || die "Falta ADMIN_PASSWORD (modo sin preguntas)."
  echo "  La contraseña debe tener mínimo 10 caracteres, con al menos una letra y un número"
  echo "  (no se muestra al escribirla y no se guarda en ningún archivo)."
  while true; do
    read -r -s -p "Contraseña de la cuenta de dirección: " p1 </dev/tty || true; echo >/dev/tty
    why="$(password_problem "$p1")"
    if [ -n "$why" ]; then echo "  La contraseña $why. Prueba otra."; continue; fi
    read -r -s -p "Repite la contraseña: " p2 </dev/tty || true; echo >/dev/tty
    if [ "$p1" != "$p2" ]; then echo "  No coinciden. Vuelve a intentarlo."; continue; fi
    ADMIN_PW="$p1"; return
  done
}

rand_hex() { openssl rand -hex "$1"; }
env_val() { # clave archivo → valor (sin ejecutar el archivo)
  local v; v="$(grep -E "^$1=" "$2" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  v="${v%$'\r'}"; printf '%s' "$v"
}

# ------------------------------------------------------------ comprobaciones
[ "$(id -u)" = "0" ] || die "Ejecuta como root (sudo)."
[ -r /etc/os-release ] || die "Sistema no soportado."
. /etc/os-release
case "${ID:-} ${ID_LIKE:-}" in
  *ubuntu*|*debian*) ;;
  *) die "Este instalador es para Ubuntu o Debian (detectado: ${PRETTY_NAME:-?})." ;;
esac
log "Sistema: ${PRETTY_NAME:-$ID}"

# ------------------------------------------------------------ paquetes base
export DEBIAN_FRONTEND=noninteractive
need=()
for c in git curl openssl jq; do command -v "$c" >/dev/null 2>&1 || need+=("$c"); done
command -v flock >/dev/null 2>&1 || need+=(util-linux)
if [ "${#need[@]}" -gt 0 ]; then
  log "Instalando: ${need[*]}"
  apt-get update -qq && apt-get install -y -qq ca-certificates "${need[@]}" >/dev/null
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker (script oficial get.docker.com)…"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Falta el plugin 'docker compose' (v2). Instálalo: apt-get install docker-compose-plugin"
log "Docker $(docker version -f '{{.Server.Version}}' 2>/dev/null || echo '?')"

# ------------------------------------------------------------ código
latest_tag() { git -C "$DIR" tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true; }
if [ -d "$DIR/.git" ]; then
  git config --global --add safe.directory "$DIR" 2>/dev/null || true
  git -C "$DIR" fetch --quiet --tags --force origin || warn "No pude actualizar la lista de versiones"
  if [ -s "$DIR/ops/state/current.env" ]; then
    log "El proyecto ya está instalado en $DIR (no cambio de versión; usa ./deploy.sh update)"
  else
    ref="${REF:-$(latest_tag)}"
    if [ -n "$ref" ]; then
      git -C "$DIR" -c advice.detachedHead=false checkout -q "$ref" && log "Versión: $ref"
    fi
  fi
elif [ -d "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  # Instalación anterior copiada a mano (rsync), sin git: se convierte en repositorio
  # conservando .env.production y los datos (que viven en volúmenes de Docker).
  warn "$DIR existe pero no es un repositorio git (instalación anterior)."
  if [ "$INTERACTIVE" = "1" ]; then
    read -r -p "¿Convertirla en repositorio git del proyecto? Se reemplazan los archivos del código, NO los datos ni .env.production [s/N] " a </dev/tty || a=n
    [[ "$a" =~ ^[sSyY]$ ]] || die "Cancelado."
  fi
  cp -a "$DIR" "${DIR}.bak-$(date +%Y%m%d-%H%M%S)"
  git config --global --add safe.directory "$DIR" 2>/dev/null || true
  git -C "$DIR" init -q
  git -C "$DIR" remote add origin "$REPO_URL" 2>/dev/null || git -C "$DIR" remote set-url origin "$REPO_URL"
  git -C "$DIR" fetch --quiet --tags origin
  ref="${REF:-$(latest_tag)}"
  ref="${ref:-origin/main}"
  git -C "$DIR" -c advice.detachedHead=false checkout -q -f "$ref"
  log "Convertida a git en $ref (copia del estado anterior: ${DIR}.bak-*)"
else
  log "Descargando el proyecto en $DIR…"
  git clone --quiet "$REPO_URL" "$DIR"
  git config --global --add safe.directory "$DIR" 2>/dev/null || true
  ref="${REF:-$(latest_tag)}"
  if [ -n "$ref" ]; then
    git -C "$DIR" -c advice.detachedHead=false checkout -q "$ref"
    log "Versión: $ref"
  else
    warn "No hay versiones publicadas (tags vX.Y.Z): se instala la rama principal."
  fi
fi
cd "$DIR"
chmod +x deploy.sh install.sh scripts/*.sh 2>/dev/null || true

# ------------------------------------------------------------ configuración
ENV_FILE="$DIR/.env.production"
GENERATED_BACKUP_KEY=""
ADMIN_PW=""
EMAIL_RE='^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
TEXT_RE='^[^=#$"`\\]{2,60}$'
LONG_TEXT_RE='^[^=#$"`\\]{2,120}$'
HOST_RE='^(([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}|([0-9]{1,3}\.){3}[0-9]{1,3}|localhost)$'
PORT_RE='^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$'

write_env=1
if [ -f "$ENV_FILE" ]; then
  echo
  log ".env.production ya existe."
  KEEP_ENV="${KEEP_ENV:-}"
  yesno KEEP_ENV "¿Conservarlo tal cual? (No = reconfigurar; se conservan las claves de la BD, JWT, respaldos y VAPID)" s
  if [ "$KEEP_ENV" = "1" ]; then
    write_env=0
    log "Se conserva .env.production."
    SET_ADMIN="${SET_ADMIN:-}"
    [ -n "${ADMIN_PASSWORD:-}" ] && SET_ADMIN=1
    [ "$INTERACTIVE" = "0" ] && [ -z "$SET_ADMIN" ] && SET_ADMIN=0
    yesno SET_ADMIN "¿Fijar ahora el usuario y la contraseña de la cuenta de dirección?" s
    if [ "$SET_ADMIN" = "1" ]; then
      ADMIN_EMAIL="${ADMIN_EMAIL:-}"
      [ -n "$ADMIN_EMAIL" ] || ADMIN_EMAIL_DEF="$(env_val ADMIN_EMAIL "$ENV_FILE")"
      ask ADMIN_EMAIL "Usuario (correo) de la cuenta de dirección" "${ADMIN_EMAIL_DEF:-}" "$EMAIL_RE" "Correo inválido (ej. direccion@sonrisitas.com)."
      ask_password
    fi
  else
    cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
    log "Copia del anterior: $ENV_FILE.bak-*"
  fi
fi

if [ "$write_env" = "1" ]; then
  OLD_ENV=""
  [ -f "$ENV_FILE" ] && OLD_ENV="$ENV_FILE"
  default_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
  PUBLIC_HOST="${PUBLIC_HOST:-${SITE_ADDRESS:-}}"

  if [ "${SONRISAS_ADVANCED:-0}" != "1" ]; then
  # ---------------------------------------------------------- instalación EXPRESS
  # Pensada para Nginx Proxy Manager (u otro proxy con HTTPS) que reenvía a http://IP:8986.
  # Sólo se pregunta lo imprescindible; el resto va por defecto.
  echo
  echo -e "${B}Instalación rápida${N} (Enter = valor por defecto)"
  echo
  ask ADMIN_EMAIL "Usuario de dirección (correo)" "" "$EMAIL_RE" "Correo inválido (ej. direccion@sonrisitas.com)."
  ask_password
  DOMAIN_RE='^(([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63})$'
  ask PUBLIC_DOMAIN "Dominio configurado en tu Nginx Proxy Manager" "${PUBLIC_DOMAIN:-sonrisitas.maat.ec}" "$DOMAIN_RE" "Escribe sólo el dominio (ej. sonrisitas.maat.ec), sin https:// ni /."
  ADMIN_NAME="${ADMIN_NAME:-Dirección}"
  COMPANY_NAME="${COMPANY_NAME:-Sonrisitas}"
  COMPANY_TAGLINE="${COMPANY_TAGLINE:-Centro de Desarrollo Infantil}"
  TZ_VALUE="${TZ_VALUE:-America/Guayaquil}"
  WHATSAPP_COUNTRY_CODE="${WHATSAPP_COUNTRY_CODE:-593}"
  PUBLIC_MODE=http
  APP_PORT="${APP_PORT:-8986}"
  # El proxy llega por la IP del servidor: el puerto queda abierto a la red.
  APP_BIND=0.0.0.0
  PUBLIC_HOST="$PUBLIC_DOMAIN"
  SITE_ADDRESS="$PUBLIC_DOMAIN"
  FRONTEND="https://$PUBLIC_DOMAIN"
  TRUST_PROXY=true
  BACKUP_ENCRYPT="${BACKUP_ENCRYPT:-1}"
  else
  # ---------------------------------------------------------- instalación AVANZADA
  echo
  echo -e "${B}Configuración inicial${N} (Enter = valor por defecto)"
  echo
  echo -e "${B}1. Cuenta de dirección${N} (administrador del sistema)"
  ask ADMIN_EMAIL "Usuario (correo)" "" "$EMAIL_RE" "Correo inválido (ej. direccion@sonrisitas.com)."
  ask_password
  ask ADMIN_NAME "Nombre que se mostrará" "Dirección" "$TEXT_RE" "Entre 2 y 60 caracteres (sin = # \$ \" \`)."

  echo
  echo -e "${B}2. Centro${N}"
  ask COMPANY_NAME "Nombre del centro" "Sonrisitas" "$TEXT_RE" "Entre 2 y 60 caracteres (sin = # \$ \" \`)."
  ask COMPANY_TAGLINE "Lema / descripción" "Centro de Desarrollo Infantil" "$LONG_TEXT_RE" "Entre 2 y 120 caracteres (sin = # \$ \" \`)."
  ask TZ_VALUE "Zona horaria" "${TZ:-America/Guayaquil}" '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' "Formato Región/Ciudad."
  [ -f "/usr/share/zoneinfo/$TZ_VALUE" ] || warn "No encuentro la zona horaria $TZ_VALUE en este servidor (se usará igual en los contenedores)."
  ask WHATSAPP_COUNTRY_CODE "Código de país para WhatsApp" "593" '^[0-9]{1,4}$' "Sólo dígitos (Ecuador: 593)."

  echo
  echo -e "${B}3. Acceso${N}"
  echo "   1) Puerto directo (recomendado para empezar): http://IP-o-dominio:8986"
  echo "      Docker publica 8986 → 3000. Sin certificado (HTTP)."
  echo "   2) HTTPS con dominio: Caddy + certificado Let's Encrypt automático en 80/443."
  case "${PUBLIC_MODE:-}" in http) MODE_CHOICE=1 ;; https) MODE_CHOICE=2 ;; esac
  ask MODE_CHOICE "Modo de acceso (1 o 2)" "1" '^[12]$' "Responde 1 o 2."

  if [ "$MODE_CHOICE" = "1" ]; then
    PUBLIC_MODE=http
    ask PUBLIC_HOST "IP pública o dominio del servidor" "${default_ip:-}" "$HOST_RE" "Escribe una IPv4 (203.0.113.10) o un dominio (asistencia.midominio.com)."
    ask APP_PORT "Puerto" "8986" "$PORT_RE" "Puerto entre 1 y 65535."
    echo
    warn "En HTTP (sin certificado) el navegador NO permite usar la cámara (registro con foto)"
    warn "ni instalar la app (PWA), salvo en http://localhost. Para usarlas, pon delante un proxy"
    warn "con HTTPS (tu Nginx/Caddy/Cloudflare, ver DEPLOY.md) o reinstala eligiendo el modo 2."
    BEHIND_PROXY="${BEHIND_PROXY:-}"
    [ -n "${PUBLIC_URL:-}" ] && BEHIND_PROXY=1
    yesno BEHIND_PROXY "¿Ya tienes (o vas a poner) un proxy propio con HTTPS delante?" n
    if [ "$BEHIND_PROXY" = "1" ]; then
      ask PUBLIC_URL "Dirección pública HTTPS (la que escribirán en el navegador)" "https://$PUBLIC_HOST" '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' "Formato https://dominio (sin / final)."
      PROXY_LOCAL="${PROXY_LOCAL:-}"
      yesno PROXY_LOCAL "¿El proxy está en ESTE servidor? (el puerto $APP_PORT quedará sólo en 127.0.0.1)" s
      [ "$PROXY_LOCAL" = "1" ] && APP_BIND=127.0.0.1 || APP_BIND=0.0.0.0
      FRONTEND="$PUBLIC_URL"; TRUST_PROXY=true
    else
      APP_BIND=0.0.0.0
      FRONTEND="http://$PUBLIC_HOST:$APP_PORT"; TRUST_PROXY=false
    fi
    SITE_ADDRESS="$PUBLIC_HOST"
  else
    PUBLIC_MODE=https
    ask PUBLIC_HOST "Dominio del sistema (o IP si aún no tienes dominio)" "${default_ip:-}" "$HOST_RE" "Escribe un dominio (asistencia.midominio.com) o una IPv4."
    if [[ "$PUBLIC_HOST" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
      warn "Con una IP el certificado HTTPS es auto-firmado (el navegador avisará). Con un dominio es automático (Let's Encrypt)."
    else
      warn "El dominio $PUBLIC_HOST debe apuntar (registro A) a la IP de este servidor y los puertos 80/443 deben estar libres."
    fi
    ask APP_PORT "Puerto interno de la app" "8986" "$PORT_RE" "Puerto entre 1 y 65535."
    EXPOSE_APP_PORT="${EXPOSE_APP_PORT:-}"
    yesno EXPOSE_APP_PORT "¿Exponer TAMBIÉN el puerto $APP_PORT (HTTP directo, sin cifrar) a la red?" n
    [ "$EXPOSE_APP_PORT" = "1" ] && APP_BIND=0.0.0.0 || APP_BIND=127.0.0.1
    SITE_ADDRESS="$PUBLIC_HOST"
    FRONTEND="https://$PUBLIC_HOST"; TRUST_PROXY=true
  fi

  echo
  echo -e "${B}4. Respaldos${N}"
  ask BACKUP_ENCRYPT "¿Cifrar los respaldos? (recomendado; 1 = sí, 0 = no)" "1" '^[01]$' "Responde 1 o 0."
  fi # fin instalación avanzada

  # Secretos: se conservan los del archivo anterior (la BD ya se creó con esa clave).
  DB_USER_V="$( [ -n "$OLD_ENV" ] && env_val DB_USERNAME "$OLD_ENV" || true)"; DB_USER_V="${DB_USER_V:-sonrisas}"
  DB_NAME_V="$( [ -n "$OLD_ENV" ] && env_val DB_NAME "$OLD_ENV" || true)"; DB_NAME_V="${DB_NAME_V:-sonrisas}"
  DB_PASS_V="$( [ -n "$OLD_ENV" ] && env_val DB_PASSWORD "$OLD_ENV" || true)"; DB_PASS_V="${DB_PASS_V:-$(rand_hex 24)}"
  JWT_V="$( [ -n "$OLD_ENV" ] && env_val JWT_SECRET "$OLD_ENV" || true)"; JWT_V="${JWT_V:-$(rand_hex 48)}"
  VAPID_PUB_V="$( [ -n "$OLD_ENV" ] && env_val VAPID_PUBLIC_KEY "$OLD_ENV" || true)"
  VAPID_PRIV_V="$( [ -n "$OLD_ENV" ] && env_val VAPID_PRIVATE_KEY "$OLD_ENV" || true)"
  BKEY_V="$( [ -n "$OLD_ENV" ] && env_val BACKUP_ENCRYPTION_KEY "$OLD_ENV" || true)"
  if [ "$BACKUP_ENCRYPT" = "1" ] && [ -z "$BKEY_V" ]; then GENERATED_BACKUP_KEY="$(rand_hex 32)"; BKEY_V="$GENERATED_BACKUP_KEY"; fi
  [ "$BACKUP_ENCRYPT" = "0" ] && [ -n "$BKEY_V" ] && warn "Había una clave de cifrado de respaldos: se conserva (los respaldos antiguos la necesitan)."

  umask 077
  cat > "$ENV_FILE" <<ENV
# Generado por install.sh el $(date -Iseconds). NO subir a git. Permisos 600.
SONRISAS_DIR=$DIR
TZ=$TZ_VALUE

# --- Acceso ---
# http  = puerto directo (APP_BIND:APP_PORT → 3000), sin Caddy.
# https = Caddy + Let's Encrypt en 80/443 (perfil "https" de docker compose).
PUBLIC_MODE=$PUBLIC_MODE
APP_PORT=$APP_PORT
APP_BIND=$APP_BIND
SITE_ADDRESS=$SITE_ADDRESS
HTTP_PORT=80
HTTPS_PORT=443
FRONTEND_URL=$FRONTEND
BACKEND_URL=$FRONTEND
# true sólo con un proxy delante (Caddy o el tuyo): IP real del cliente en los límites de intentos.
TRUST_PROXY=$TRUST_PROXY

DB_USERNAME=$DB_USER_V
DB_PASSWORD=$DB_PASS_V
DB_NAME=$DB_NAME_V
DB_SYNC=false

JWT_SECRET=$JWT_V
JWT_EXPIRES_IN=7d
UPLOADS_REQUIRE_AUTH=true

# Cuenta de dirección. La contraseña NO se guarda aquí: para cambiarla, ./deploy.sh admin
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=
ADMIN_NAME=$ADMIN_NAME
COMPANY_NAME=$COMPANY_NAME
COMPANY_TAGLINE=$COMPANY_TAGLINE

WHATSAPP_PROVIDER=linked
WHATSAPP_LOG_LEVEL=silent
WHATSAPP_COUNTRY_CODE=$WHATSAPP_COUNTRY_CODE
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TOKEN=
WHATSAPP_API_VERSION=v21.0
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANG=es

VAPID_PUBLIC_KEY=$VAPID_PUB_V
VAPID_PRIVATE_KEY=$VAPID_PRIV_V
VAPID_SUBJECT=mailto:$ADMIN_EMAIL

# Respaldos: nocturno 03:15; 14 nocturnos, 10 de seguridad y hasta 30 manuales.
# SIN la clave no se pueden abrir los respaldos: guárdala también FUERA del servidor.
BACKUP_ENCRYPTION_KEY=$BKEY_V
BACKUP_CRON=15 3 * * *
BACKUP_KEEP_DAILY=14
BACKUP_KEEP_SAFETY=10
BACKUP_MAX_MANUAL=30
BACKUP_UPLOAD_MAX_MB=2048
ENV
  chmod 600 "$ENV_FILE"
  umask 022
  log ".env.production creado (permisos 600)"
fi

# Valores efectivos (del archivo nuevo o del conservado)
MODE="$(env_val PUBLIC_MODE "$ENV_FILE")"; MODE="${MODE:-https}"   # sin PUBLIC_MODE = instalación antigua con Caddy
PORT_V="$(env_val APP_PORT "$ENV_FILE")"; PORT_V="${PORT_V:-8986}"
BIND_V="$(env_val APP_BIND "$ENV_FILE")"; [ -n "$BIND_V" ] || { [ "$MODE" = "https" ] && BIND_V=127.0.0.1 || BIND_V=0.0.0.0; }
URL_V="$(env_val FRONTEND_URL "$ENV_FILE")"

# ------------------------------------------------------------ firewall
if command -v ufw >/dev/null 2>&1 && grep -q "Status: active" <<<"$(ufw status 2>/dev/null || true)"; then
  if [ "$MODE" = "https" ]; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && log "ufw: abiertos 80/tcp y 443/tcp"
  fi
  if [ "$BIND_V" != "127.0.0.1" ]; then
    ufw allow "$PORT_V/tcp" >/dev/null && log "ufw: abierto $PORT_V/tcp"
  fi
  grep -qE '^(22|OpenSSH)' <<<"$(ufw status)" || warn "ufw no tiene SSH (22) permitido: revisa que no te quedes sin acceso."
fi
if [ "$BIND_V" != "127.0.0.1" ]; then
  info_port="$(ss -ltnH "sport = :$PORT_V" 2>/dev/null | head -n1 || true)"
  if [ -n "$info_port" ] && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx sonrisas_api; then
    die "El puerto $PORT_V ya está en uso por otro programa. Libéralo o elige otro (APP_PORT en .env.production)."
  fi
fi

# ------------------------------------------------------------ construir y arrancar
log "Construyendo y arrancando (la primera vez tarda varios minutos)…"
# La contraseña viaja sólo en el entorno del proceso (no en disco ni en la línea de órdenes);
# deploy.sh se la pasa al seed por la entrada estándar.
if [ -n "$ADMIN_PW" ]; then
  SONRISAS_NONINTERACTIVE=1 SONRISAS_ADMIN_EMAIL="$ADMIN_EMAIL" SONRISAS_ADMIN_PASSWORD="$ADMIN_PW" \
    "$DIR/deploy.sh" install
else
  SONRISAS_NONINTERACTIVE=1 "$DIR/deploy.sh" install
fi
ADMIN_PW=""; unset ADMIN_PASSWORD 2>/dev/null || true

admin_email="$(env_val ADMIN_EMAIL "$ENV_FILE")"
[ -n "${ADMIN_EMAIL:-}" ] && admin_email="$ADMIN_EMAIL"
lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo
echo -e "${B}============================================================${N}"
echo -e "${B} Sonrisitas instalado${N}"
echo -e "${B}============================================================${N}"
echo -e " Dirección web:   ${B}$URL_V${N}"
if [ "$MODE" = "http" ] && [ -n "$lan_ip" ] && [ "$BIND_V" != "127.0.0.1" ]; then
  echo "                  (en la red local también: http://$lan_ip:$PORT_V)"
fi
echo " Usuario:         $admin_email   (la contraseña es la que escribiste; no se guarda)"
echo "                  Al entrar, activa la verificación en dos pasos (Seguridad)."
TRUST_V="$(env_val TRUST_PROXY "$ENV_FILE")"
if [ "$MODE" = "http" ] && [ "$TRUST_V" = "true" ] && [[ "$URL_V" == https://* ]]; then
  srv_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "$lan_ip")"
  echo
  echo -e " ${B}Nginx Proxy Manager${N} (Proxy Host para ${URL_V#https://}):"
  echo "   Scheme: http   ·   Forward Hostname/IP: ${srv_ip:-IP-DEL-SERVIDOR}   ·   Forward Port: $PORT_V"
  echo "   Activa: Websockets Support y Block Common Exploits"
  echo "   SSL: Let's Encrypt + Force SSL + HTTP/2"
  echo "   Advanced (opcional, recomendado para el tiempo real y las fotos):"
  echo "     proxy_buffering off;  proxy_read_timeout 3600s;  client_max_body_size 50m;"
  echo -e " ${Y}Seguridad:${N} el puerto $PORT_V queda abierto. Si NPM está en OTRO servidor, limita"
  echo "   en tu proveedor/firewall el acceso a $PORT_V sólo a la IP de NPM (ver DEPLOY.md)."
fi
if [[ "$URL_V" == http://* ]]; then
  echo -e " ${Y}Sin HTTPS:${N}       la cámara y la instalación como app necesitan HTTPS."
  echo "                  Pon un proxy con certificado delante (DEPLOY.md → Proxy propio)."
fi
if [ -n "$GENERATED_BACKUP_KEY" ]; then
  echo
  echo -e " ${Y}Clave de cifrado de respaldos (guárdala FUERA del servidor, p. ej. en un gestor de contraseñas):${N}"
  echo -e "   ${B}$GENERATED_BACKUP_KEY${N}"
  echo "   Sin ella no se puede restaurar ningún respaldo si el servidor se pierde."
fi
echo
echo " Cambiar contraseña o crear la cuenta:  cd $DIR && ./deploy.sh admin"
echo " Respaldos:       nocturnos automáticos + desde Panel → Respaldos (volumen sonrisas_backups)"
echo "                  copia fuera del servidor: scripts/offsite-copy.sh (ver DEPLOY.md)"
echo " Actualizar:      Panel → Sistema, o  cd $DIR && ./deploy.sh update"
echo " Volver atrás:    Panel → Sistema, o  ./deploy.sh rollback"
echo " Estado:          ./deploy.sh status   ·   ayuda: ./deploy.sh help"
echo -e "${B}============================================================${N}"
