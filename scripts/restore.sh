#!/usr/bin/env bash
# Restaura un respaldo desde el servidor. Atajo de: ./deploy.sh restore <archivo>
#   scripts/restore.sh sonrisas-backup-20261110-031500-nightly.tar.enc
# Lista de respaldos: ./deploy.sh backups
# Antes de restaurar se hace un respaldo de seguridad del estado actual, y la BD actual
# se conserva como <bd>_prev hasta la siguiente restauración.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy.sh" restore "$@"
