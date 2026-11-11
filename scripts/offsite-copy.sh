#!/usr/bin/env bash
# ============================================================
# Copia los respaldos FUERA del servidor (regla 3-2-1: si el disco o el servidor se
# pierden, los respaldos locales se pierden con ellos).
#
# Programarlo en el servidor (crontab -e), p. ej. a las 04:00, después del nocturno:
#   0 4 * * * /opt/sonrisas/scripts/offsite-copy.sh >> /var/log/sonrisas-offsite.log 2>&1
#
# Destino (en .env.production o en el entorno), UNO de los dos:
#   OFFSITE_RSYNC=usuario@otro-servidor:/srv/respaldos/sonrisas   (clave SSH sin contraseña)
#   OFFSITE_RCLONE=remoto:carpeta    (rclone config: Google Drive, S3, Backblaze B2, …)
#
# Copia sólo archivos nuevos y NO borra nada en el destino. Los respaldos van cifrados si
# BACKUP_ENCRYPTION_KEY está definida: guarda esa clave en un lugar seguro FUERA del
# servidor (sin ella no se pueden abrir).
# ============================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DIR/.env.production"
get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
RSYNC_DEST="${OFFSITE_RSYNC:-$(get OFFSITE_RSYNC)}"
RCLONE_DEST="${OFFSITE_RCLONE:-$(get OFFSITE_RCLONE)}"
VOL=sonrisas_sonrisas_backups
SRC="$(docker volume inspect -f '{{.Mountpoint}}' "$VOL")"
[ -d "$SRC" ] || { echo "No encuentro el volumen $VOL"; exit 1; }

echo "[$(date -Iseconds)] Copia externa desde $SRC"
if [ -n "$RSYNC_DEST" ]; then
  rsync -a --ignore-existing --include='sonrisas-backup-*' --exclude='.*' --exclude='*' "$SRC/" "$RSYNC_DEST/"
elif [ -n "$RCLONE_DEST" ]; then
  rclone copy --ignore-existing --include 'sonrisas-backup-*' "$SRC" "$RCLONE_DEST"
else
  echo "Define OFFSITE_RSYNC o OFFSITE_RCLONE (ver cabecera de este script)."; exit 1
fi
echo "[$(date -Iseconds)] OK"
