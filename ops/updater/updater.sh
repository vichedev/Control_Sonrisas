#!/usr/bin/env bash
# ============================================================
# Sonrisas — actualizador (contenedor `updater`)
# ============================================================
# La api NO puede ejecutar comandos en el servidor. Cuando la dirección pide una
# actualización, vuelta atrás o restauración, la api deja un JSON en /ops/jobs/<id>.json.
# Este proceso:
#   1. valida la petición (acción de una lista blanca, versión ^vX.Y.Z$, nombre de
#      respaldo con formato fijo) — nunca pasa texto del usuario a un shell;
#   2. ejecuta deploy.sh (una tarea a la vez);
#   3. escribe estado y log en /ops/status/jobs/<id>.json|.log (la api los lee).
# Además publica /ops/status/updater.json (latido), versions.json (tags de git) e
# history.json (historial de deploy.sh).
# ============================================================
set -uo pipefail

DIR="${SONRISAS_DIR:-/opt/sonrisas}"
JOBS=/ops/jobs
STATUS=/ops/status
JSTATUS="$STATUS/jobs"
POLL="${UPDATER_POLL_SECONDS:-5}"
FETCH_MIN="${UPDATER_FETCH_MINUTES:-30}"
CUR=/tmp/current-job

ID_RE='^[0-9]{14}-[a-f0-9]{8}$'
VERSION_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'
BACKUP_RE='^sonrisas-backup-[0-9]{8}-[0-9]{6}-(nightly|manual|pre-update|pre-restore|pre-rollback|uploaded)\.tar(\.enc)?$'
BY_RE='^[A-Za-z0-9._@+-]{1,120}$'

log() { echo "[$(date -Iseconds)] $*"; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

write_json() { # archivo contenido — escritura atómica, legible por la api
  local tmp="$1.tmp.$$"
  printf '%s\n' "$2" > "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$1"
}

set_status() { # id action state message [extra-json]
  local extra="${5:-}"
  [ -n "$extra" ] || extra='{}'
  local prev="{}"
  [ -f "$JSTATUS/$1.json" ] && prev="$(cat "$JSTATUS/$1.json" 2>/dev/null || echo '{}')"
  write_json "$JSTATUS/$1.json" "$(jq -n --argjson prev "$prev" --argjson extra "$extra" \
    --arg id "$1" --arg action "$2" --arg state "$3" --arg msg "$4" --arg t "$(now_iso)" \
    '$prev + $extra + {id:$id, action:$action, state:$state, message:$msg, updatedAt:$t}')"
}

heartbeat_loop() {
  while true; do
    local job="" busy=false
    [ -s "$CUR" ] && { job="$(cat "$CUR")"; busy=true; }
    write_json "$STATUS/updater.json" "$(jq -n --arg t "$(now_iso)" --argjson busy "$busy" --arg job "$job" \
      --arg ref "$(git -C "$DIR" describe --tags --always 2>/dev/null || echo '')" \
      '{lastSeen:$t, busy:$busy, currentJob:$job, gitRef:$ref}')"
    sleep 10
  done
}

refresh_versions() {
  local err="" tags cur
  if ! git -C "$DIR" fetch --quiet --tags --force origin 2>/tmp/fetch.err; then
    err="$(head -c 300 /tmp/fetch.err | tr '\n' ' ')"
    log "git fetch falló: $err"
  fi
  cur="$(grep -E '^CURRENT_VERSION=' "$DIR/ops/state/current.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  tags="$(git -C "$DIR" tag -l 'v*' --sort=-v:refname | grep -E "$VERSION_RE" | head -n 15 | while read -r t; do
      jq -n --arg tag "$t" \
        --arg date "$(git -C "$DIR" log -1 --format=%cI "$t" 2>/dev/null)" \
        --arg subject "$(git -C "$DIR" tag -l --format='%(contents:subject)' "$t" | head -c 300)" \
        --arg notes "$(git -C "$DIR" tag -l --format='%(contents:body)' "$t" | head -c 4000)" \
        '{tag:$tag, date:$date, subject:$subject, notes:$notes}'
    done | jq -s '.' 2>/dev/null)"
  write_json "$STATUS/versions.json" "$(jq -n --arg t "$(now_iso)" --arg cur "$cur" --arg err "$err" \
    --argjson tags "${tags:-[]}" '{fetchedAt:$t, current:$cur, error:$err, tags:$tags}')"
}

mirror_history() {
  local h="$DIR/ops/state/history.jsonl"
  if [ -f "$h" ]; then
    local out; out="$(tail -n 100 "$h" | jq -s '.' 2>/dev/null || echo '[]')"
    write_json "$STATUS/history.json" "$out"
  fi
}

reject() { # id action msg
  log "Tarea $1 rechazada: $3"
  set_status "$1" "$2" rejected "$3" '{"exitCode":-1}'
}

process_job() {
  local file="$1" name id size action version bfile restore_db by
  name="$(basename "$file")"; id="${name%.json}"
  if ! [[ "$id" =~ $ID_RE ]]; then rm -f -- "$file"; return; fi
  size="$(stat -c %s "$file" 2>/dev/null || echo 99999)"
  if [ "$size" -gt 4096 ] || ! jq -e 'type == "object"' "$file" >/dev/null 2>&1; then
    rm -f -- "$file"; reject "$id" "?" "Petición inválida"; return
  fi
  action="$(jq -r '.action // "" | tostring' "$file")"
  version="$(jq -r '.version // "" | tostring' "$file")"
  bfile="$(jq -r '.file // "" | tostring' "$file")"
  restore_db="$(jq -r '.restoreDb // false | tostring' "$file")"
  by="$(jq -r '.requestedBy // "" | tostring' "$file")"
  local requested_at; requested_at="$(jq -r '.requestedAt // "" | tostring' "$file")"
  rm -f -- "$file"
  [[ "$by" =~ $BY_RE ]] || by="app"

  local args=()
  case "$action" in
    update)
      [[ "$version" =~ $VERSION_RE ]] || { reject "$id" "$action" "Versión inválida"; return; }
      args=(update "$version") ;;
    rollback)
      args=(rollback); [ "$restore_db" = "true" ] && args+=(--restore-db) ;;
    restore)
      [[ "$bfile" =~ $BACKUP_RE ]] || { reject "$id" "$action" "Nombre de respaldo inválido"; return; }
      args=(restore "$bfile") ;;
    *)
      reject "$id" "$action" "Acción no permitida"; return ;;
  esac

  local logf="$JSTATUS/$id.log"
  : > "$logf"; chmod 644 "$logf"
  echo "$id" > "$CUR"
  set_status "$id" "$action" running "En curso" "$(jq -n --arg v "$version" --arg f "$bfile" --arg by "$by" \
    --arg req "$requested_at" --arg t "$(now_iso)" '{version:$v, file:$f, requestedBy:$by, requestedAt:$req, startedAt:$t}')"
  log "Tarea $id: ${args[*]} (pedida por $by)"

  SONRISAS_NONINTERACTIVE=1 SONRISAS_IN_UPDATER=1 SONRISAS_JOB_BY="$by" SONRISAS_DIR="$DIR" \
    bash "$DIR/deploy.sh" "${args[@]}" --yes >>"$logf" 2>&1
  local code=$?

  local msg
  case "$code" in
    0) msg="Completado" ;;
    1) msg="Falló (el sistema quedó en la versión/estado anterior; ver log)" ;;
    2) msg="CRÍTICO: falló también la vuelta atrás automática. Revisar el servidor" ;;
    *) msg="Falló con código $code" ;;
  esac
  set_status "$id" "$action" "$([ "$code" = 0 ] && echo success || echo failed)" "$msg" \
    "$(jq -n --argjson c "$code" --arg t "$(now_iso)" '{exitCode:$c, finishedAt:$t}')"
  : > "$CUR"
  log "Tarea $id terminó con código $code"
  mirror_history
  refresh_versions
}

# ------------------------------------------------------------ arranque
mkdir -p "$JOBS" "$JSTATUS"
chown 1000:1000 "$JOBS" && chmod 770 "$JOBS"
chmod 755 "$STATUS" "$JSTATUS"
git config --global --add safe.directory "$DIR"
: > "$CUR"

# Tareas que quedaron "en curso" si el actualizador se reinició a mitad.
for s in "$JSTATUS"/*.json; do
  [ -f "$s" ] || continue
  if [ "$(jq -r '.state // ""' "$s" 2>/dev/null)" = "running" ]; then
    id="$(basename "$s" .json)"
    set_status "$id" "$(jq -r '.action // ""' "$s")" failed "Interrumpida (el actualizador se reinició)" '{"exitCode":-2}'
  fi
done
# Limpieza: estados de más de 90 días.
find "$JSTATUS" -type f -mtime +90 -delete 2>/dev/null || true

docker compose version >/dev/null 2>&1 || log "AVISO: docker compose no disponible"
[ -f "$DIR/deploy.sh" ] || log "AVISO: no encuentro $DIR/deploy.sh (¿SONRISAS_DIR correcto?)"

heartbeat_loop &
log "Actualizador listo (proyecto: $DIR, sondeo cada ${POLL}s, versiones cada ${FETCH_MIN} min)"
last_fetch=0
while true; do
  now="$(date +%s)"
  if [ $((now - last_fetch)) -ge $((FETCH_MIN * 60)) ]; then
    refresh_versions; mirror_history; last_fetch="$now"
  fi
  for f in $(find "$JOBS" -maxdepth 1 -type f -name '*.json' 2>/dev/null | sort); do
    process_job "$f"
  done
  sleep "$POLL"
done
