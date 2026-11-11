#!/usr/bin/env bash
# ============================================================
# Recuperación MANUAL de un respaldo, sin la aplicación (p. ej. en otro equipo).
#   BACKUP_ENCRYPTION_KEY='la-clave' scripts/decrypt-backup.sh sonrisas-backup-….tar.enc destino/
# Deja en destino/: manifest.json, db.dump (pg_dump -Fc) y uploads.tar.gz, y comprueba
# los sha256 del manifiesto. Luego, por ejemplo:
#   createdb sonrisas_recuperada
#   pg_restore --no-owner --no-privileges -d sonrisas_recuperada destino/db.dump
#   mkdir fotos && tar -xzf destino/uploads.tar.gz -C fotos
# Requiere: openssl, tar, sha256sum, jq (opcional).
# ============================================================
set -euo pipefail
f="${1:?Uso: decrypt-backup.sh <archivo.tar[.enc]> [destino]}"
out="${2:-./sonrisas-recuperado}"
mkdir -p "$out"; chmod 700 "$out"
if [[ "$f" == *.enc ]]; then
  : "${BACKUP_ENCRYPTION_KEY:?Define BACKUP_ENCRYPTION_KEY}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_ENCRYPTION_KEY -in "$f" \
    | tar -xf - -C "$out"
else
  tar -xf "$f" -C "$out"
fi
cd "$out"
if command -v jq >/dev/null 2>&1; then
  echo "$(jq -r .db.sha256 manifest.json)  db.dump" | sha256sum -c -
  echo "$(jq -r .uploads.sha256 manifest.json)  uploads.tar.gz" | sha256sum -c -
fi
echo "Listo en $out"
