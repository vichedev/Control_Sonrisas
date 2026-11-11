#!/usr/bin/env bash
# Respaldo manual desde el servidor (BD + fotos, mismo formato que los nocturnos y los
# que se crean desde la app). Atajo de: ./deploy.sh backup
#
# El respaldo NOCTURNO ya no usa este script: lo hace el contenedor `sonrisas_backup`
# con `node dist/ops/cli.js scheduler` (horario en BACKUP_CRON).
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy.sh" backup "$@"
