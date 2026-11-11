#!/usr/bin/env bash
# ============================================================
# Sonrisas — instalador para Ubuntu / Debian
#
#   curl -fsSL https://raw.githubusercontent.com/vichedev/Control_Sonrisas/main/install.sh | sudo bash
#
# Qué hace: instala Docker si falta, clona el proyecto en /opt/sonrisas, pregunta los
# datos básicos (dominio o IP, cuenta de dirección, zona horaria…), genera secretos
# fuertes, escribe .env.production (permisos 600), abre 80/443 en ufw si está activo,
# construye y arranca todo, crea la cuenta de dirección y muestra un resumen.
#
# Volver a ejecutarlo es seguro: NUNCA sobrescribe .env.production ni toca los
# volúmenes de datos. Para cambiar de versión usa ./deploy.sh update.
#
# Sin preguntas (variables de entorno):
#   SONRISAS_NONINTERACTIVE=1 SITE_ADDRESS=asistencia.midominio.com \
#   ADMIN_EMAIL=direccion@midominio.com ADMIN_NAME="Dirección" TZ=America/Guayaquil \
#   WHATSAPP_COUNTRY_CODE=593 COMPANY_NAME="Sonrisas" BACKUP_ENCRYPT=1 bash install.sh
# Otras: SONRISAS_DIR (/opt/sonrisas), SONRISAS_REPO, SONRISAS_REF (tag o rama).
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
    printf -v "$__var" '%s' "$def"; return
  fi
  while true; do
    read -r -p "$q${def:+ [$def]}: " val </dev/tty || true
    val="${val:-$def}"
    if [[ "$val" =~ $re ]]; then printf -v "$__var" '%s' "$val"; return; fi
    echo "  $msg"
  done
}

rand_hex() { openssl rand -hex "$1"; }
rand_pw() { # contraseña legible: letras y números, con al menos uno de cada
  local p; p="$(openssl rand -base64 30 | tr -dc 'A-HJ-NP-Za-km-z2-9' | cut -c1-14 || true)"
  printf '%s' "${p}7k"
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
if [ -d "$DIR/.git" ]; then
  log "El proyecto ya está en $DIR (no cambio de versión; usa ./deploy.sh update)"
  git config --global --add safe.directory "$DIR" 2>/dev/null || true
  git -C "$DIR" fetch --quiet --tags origin || warn "No pude actualizar la lista de versiones"
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
  ref="${REF:-$(git -C "$DIR" tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)}"
  ref="${ref:-origin/main}"
  git -C "$DIR" -c advice.detachedHead=false checkout -q -f "$ref"
  log "Convertida a git en $ref (copia del estado anterior: ${DIR}.bak-*)"
else
  log "Descargando el proyecto en $DIR…"
  git clone --quiet "$REPO_URL" "$DIR"
  git config --global --add safe.directory "$DIR" 2>/dev/null || true
  ref="${REF:-$(git -C "$DIR" tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)}"
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
GENERATED_ADMIN_PW=""
GENERATED_BACKUP_KEY=""
if [ -f "$ENV_FILE" ]; then
  log ".env.production ya existe: se conserva tal cual."
else
  echo
  echo -e "${B}Configuración inicial${N} (Enter = valor por defecto)"
  default_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
  DOMAIN_RE='^(([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}|([0-9]{1,3}\.){3}[0-9]{1,3})$'
  ask SITE_ADDRESS "Dominio del sistema (o IP del servidor si aún no tienes dominio)" "${default_ip:-}" "$DOMAIN_RE" \
    "Escribe un dominio (asistencia.midominio.com) o una IPv4."
  ask ADMIN_EMAIL "Correo de la cuenta de dirección" "" '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' "Correo inválido."
  ask ADMIN_NAME "Nombre de la cuenta de dirección" "Dirección" '^[^=]{2,60}$' "Entre 2 y 60 caracteres."
  ask COMPANY_NAME "Nombre del centro" "Sonrisas" '^[^=]{2,60}$' "Entre 2 y 60 caracteres."
  ask TZ_VALUE "Zona horaria" "${TZ:-America/Guayaquil}" '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' "Formato Región/Ciudad."
  [ -f "/usr/share/zoneinfo/$TZ_VALUE" ] || warn "No encuentro la zona horaria $TZ_VALUE en este servidor (se usará igual en los contenedores)."
  ask WHATSAPP_COUNTRY_CODE "Código de país para WhatsApp" "593" '^[0-9]{1,4}$' "Sólo dígitos (Ecuador: 593)."
  ask BACKUP_ENCRYPT "¿Cifrar los respaldos? (recomendado; 1 = sí, 0 = no)" "1" '^[01]$' "Responde 1 o 0."

  if [[ "$SITE_ADDRESS" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    warn "Con una IP el certificado HTTPS es auto-firmado (el navegador avisará). Con un dominio es automático (Let's Encrypt)."
  else
    warn "El dominio $SITE_ADDRESS debe apuntar (registro A) a la IP de este servidor ANTES de continuar."
  fi

  GENERATED_ADMIN_PW="${ADMIN_PASSWORD:-$(rand_pw)}"
  [ "$BACKUP_ENCRYPT" = "1" ] && GENERATED_BACKUP_KEY="$(rand_hex 32)"
  umask 077
  cat > "$ENV_FILE" <<ENV
# Generado por install.sh el $(date -Iseconds). NO subir a git. Permisos 600.
SONRISAS_DIR=$DIR
SITE_ADDRESS=$SITE_ADDRESS
HTTP_PORT=80
HTTPS_PORT=443
TZ=$TZ_VALUE

DB_USERNAME=sonrisas
DB_PASSWORD=$(rand_hex 24)
DB_NAME=sonrisas
DB_SYNC=false

JWT_SECRET=$(rand_hex 48)
JWT_EXPIRES_IN=7d
UPLOADS_REQUIRE_AUTH=true

FRONTEND_URL=https://$SITE_ADDRESS
BACKEND_URL=https://$SITE_ADDRESS

ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$GENERATED_ADMIN_PW
ADMIN_NAME=$ADMIN_NAME
COMPANY_NAME=$COMPANY_NAME
COMPANY_TAGLINE=Control y seguimiento infantil

WHATSAPP_PROVIDER=linked
WHATSAPP_LOG_LEVEL=silent
WHATSAPP_COUNTRY_CODE=$WHATSAPP_COUNTRY_CODE
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TOKEN=
WHATSAPP_API_VERSION=v21.0
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANG=es

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:$ADMIN_EMAIL

# Respaldos: nocturno 03:15; 14 nocturnos, 10 de seguridad y hasta 30 manuales.
# SIN la clave no se pueden abrir los respaldos: guárdala también FUERA del servidor.
BACKUP_ENCRYPTION_KEY=$GENERATED_BACKUP_KEY
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

# ------------------------------------------------------------ firewall
if command -v ufw >/dev/null 2>&1 && grep -q "Status: active" <<<"$(ufw status 2>/dev/null || true)"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && log "ufw: abiertos 80/tcp y 443/tcp"
  grep -qE '^(22|OpenSSH)' <<<"$(ufw status)" || warn "ufw no tiene SSH (22) permitido: revisa que no te quedes sin acceso."
fi

# ------------------------------------------------------------ construir y arrancar
log "Construyendo y arrancando (la primera vez tarda varios minutos)…"
SONRISAS_NONINTERACTIVE=1 "$DIR/deploy.sh" install

site="$(grep -E '^SITE_ADDRESS=' "$ENV_FILE" | cut -d= -f2-)"
admin_email="$(grep -E '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)"
echo
echo -e "${B}============================================================${N}"
echo -e "${B} Sonrisas instalado${N}"
echo -e "${B}============================================================${N}"
echo " Dirección web:   https://$site"
echo " Cuenta:          $admin_email"
if [ -n "$GENERATED_ADMIN_PW" ]; then
  echo -e " Contraseña:      ${B}$GENERATED_ADMIN_PW${N}   ← anótala; cámbiala al entrar y activa 2FA"
fi
if [ -n "$GENERATED_BACKUP_KEY" ]; then
  echo
  echo -e " ${Y}Clave de cifrado de respaldos (guárdala FUERA del servidor, p. ej. en un gestor de contraseñas):${N}"
  echo -e "   ${B}$GENERATED_BACKUP_KEY${N}"
  echo "   Sin ella no se puede restaurar ningún respaldo si el servidor se pierde."
fi
echo
echo " Respaldos:       nocturnos automáticos + desde Panel → Respaldos (volumen sonrisas_backups)"
echo "                  copia fuera del servidor: scripts/offsite-copy.sh (ver DEPLOY.md)"
echo " Actualizar:      Panel → Sistema, o  cd $DIR && ./deploy.sh update"
echo " Volver atrás:    Panel → Sistema, o  ./deploy.sh rollback"
echo " Estado:          ./deploy.sh status   ·   ayuda: ./deploy.sh help"
echo -e "${B}============================================================${N}"
