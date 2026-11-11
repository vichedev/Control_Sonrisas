# Despliegue — Sonrisas (Docker)

Guía para instalar, actualizar, volver atrás y respaldar Sonrisas en un servidor **Ubuntu/Debian** con Docker.

```text
caddy    →  HTTPS (Let's Encrypt con dominio · auto-firmado con IP) — único con puertos (80/443)
api      →  NestJS: API /api/* + la web. Aplica migraciones al arrancar
db       →  PostgreSQL 16, en red interna sin internet, nunca publicado
backup   →  respaldo nocturno (BD + fotos)
updater  →  aplica actualizaciones / vuelta atrás / restauraciones pedidas desde la app
```

**Datos que nunca se pierden** — viven en volúmenes de Docker, no en la carpeta del proyecto: `sonrisas_db_data` (BD), `sonrisas_uploads` (fotos), `sonrisas_backups` (respaldos), `sonrisas_wa_auth` (sesión de WhatsApp), `sonrisas_caddy_data` (certificados). Ningún comando de `deploy.sh` los borra.

> ⚠️ **Nunca** ejecutes `docker compose down -v` ni `docker volume rm`: borran la base de datos y las fotos.

---

## 1. Instalación (primera vez)

Requisitos: Ubuntu 22.04/24.04 o Debian 12, 2 GB de RAM, 20 GB de disco, acceso root. Si usas dominio, su registro **A** debe apuntar a la IP del servidor **antes** de instalar.

```bash
curl -fsSL https://raw.githubusercontent.com/vichedev/Control_Sonrisas/main/install.sh | sudo bash
```

El instalador:

1. Instala Docker (si falta), `git`, `jq`, `openssl`.
2. Clona el proyecto en `/opt/sonrisas` (última versión publicada `vX.Y.Z`; si no hay, la rama `main`).
3. Pregunta: dominio o IP, correo y nombre de la cuenta de dirección, nombre del centro, zona horaria (por defecto `America/Guayaquil`), código de país de WhatsApp (593) y si cifrar los respaldos (recomendado).
4. Genera secretos fuertes (clave de BD, `JWT_SECRET`, contraseña inicial de dirección, clave de cifrado de respaldos, claves VAPID) y escribe `.env.production` con permisos **600**.
5. Abre 80/443 si `ufw` está activo, construye la imagen, arranca todo, espera a que la API esté sana y crea la cuenta de dirección.
6. Muestra **una sola vez** la contraseña de dirección y la **clave de cifrado de respaldos**.

> **Guarda la clave de cifrado FUERA del servidor** (gestor de contraseñas). Sin ella ningún respaldo cifrado se puede abrir si el servidor se pierde.

Sin preguntas (automatizado):

```bash
sudo SONRISAS_NONINTERACTIVE=1 SITE_ADDRESS=asistencia.midominio.com ADMIN_EMAIL=direccion@midominio.com \
     ADMIN_NAME="Dirección" TZ=America/Guayaquil BACKUP_ENCRYPT=1 bash install.sh
```

Volver a ejecutar el instalador es seguro: no sobrescribe `.env.production` ni toca los volúmenes.

Después de entrar: cambia la contraseña de dirección, **activa la verificación en dos pasos (2FA)** en Seguridad (las operaciones críticas la piden), y configura horario, salas, personal y niños.

### Instalación existente sin git (copiada con rsync)

Ejecuta igualmente el instalador: detecta la carpeta, hace una copia `/opt/sonrisas.bak-FECHA`, la convierte en repositorio git (sin tocar `.env.production` ni los volúmenes), **vuelca la BD a `exports/pre-install-*.sql.gz`** antes de cambiar nada, cambia `DB_SYNC` a `false` y arranca la nueva versión. La primera vez, la BD existente (creada con `synchronize`) **adopta** la migración base sin re-ejecutarla.

> Si tu `.env.production` antiguo usa `DB_PASSWORD=postgres` u otra clave débil, `deploy.sh` se negará a continuar. Cámbiala primero dentro de Postgres y luego en el archivo:
> `docker exec -it sonrisas_db psql -U <usuario> -c "ALTER USER <usuario> PASSWORD 'clave-nueva-larga'"`

---

## 2. Comandos (`cd /opt/sonrisas && ./deploy.sh <comando>`)

| Comando | Qué hace |
|---|---|
| `status` | Contenedores, salud, versión y últimos respaldos |
| `update [vX.Y.Z]` | Actualiza (por defecto a la última versión). Ver §3 |
| `rollback [--restore-db]` | Vuelve a la versión anterior. Ver §4 |
| `backup` | Respaldo manual (BD + fotos) |
| `backups` | Lista los respaldos |
| `verify <archivo>` | Comprueba la integridad (sha256) de un respaldo |
| `restore <archivo>` | Restaura un respaldo. Ver §5 |
| `export <archivo> [carpeta]` | Copia un respaldo del volumen a `/opt/sonrisas/exports` (para sacarlo del servidor) |
| `version` / `versions` | Versión instalada / versiones publicadas |
| `history` | Historial de actualizaciones y vueltas atrás |
| `migrations` | Migraciones de la BD aplicadas y pendientes |
| `logs [servicio]` | Logs en vivo (`api`, `db`, `caddy`, `backup`, `updater`) |
| `up` · `restart` · `stop` | Levantar · reiniciar · detener (no borra datos) |
| `admin` | Crea/actualiza la cuenta de dirección (seed) |
| `psql` · `shell` | Consola de Postgres · shell en la api |
| `redeploy` | Reconstruye el código actual sin cambiar de versión (con respaldo y vuelta atrás) |

Opciones: `--yes` (no preguntar), `--force`.

---

## 3. Actualizar

Desde la app: **Ajustes → Actualizaciones** → *Actualizar a vX.Y.Z* (pide contraseña y 2FA). O en el servidor: `./deploy.sh update`.

Lo que ocurre (igual en ambos casos):

1. **Comprobaciones**: espacio en disco, BD sana, sin archivos modificados a mano en el servidor.
2. `git fetch --tags` y cambio del código al tag `vX.Y.Z` (se recuerda el commit anterior).
3. **Compilación** de la imagen `sonrisas-api:vX.Y.Z` mientras el sistema sigue funcionando. Si falla, no se cambia nada.
4. Se detiene la api y se hace un **respaldo previo** completo (BD + fotos, tipo `pre-update`). Si el respaldo falla, no se actualiza.
5. Se arranca la versión nueva: las **migraciones** se aplican en una sola transacción.
6. Se espera a que `/api/health` responda (hasta 150 s).
7. **Si todo va bien**: queda registrada en el historial. **Si falla**: **vuelta atrás automática** — se vuelve a la imagen y al código anteriores; si las migraciones llegaron a cambiar la BD (el contador de migraciones difiere), se restaura el respaldo previo, que se tomó con la api detenida, así que no se pierde nada. Como las migraciones corren en una transacción, una migración fallida no deja cambios y no hace falta restaurar.

Imágenes: `sonrisas-api:current` (en uso), `:previous` y las tres últimas `:vX.Y.Z`.

### Publicar una versión (desarrollo)

```bash
# 1. si cambiaste entidades, crea la migración y revísala
npm run migration:generate -- src/database/migrations/AgregarCampoX
# 2. sube la versión
npm version 1.2.0 --no-git-tag-version      # cambia package.json
git commit -am "v1.2.0"
# 3. tag anotado: el mensaje aparece como "notas de la versión" en la app
git tag -a v1.2.0 -m "Mejoras en reportes" -m "- Detalle 1\n- Detalle 2"
git push origin main --tags
```

El actualizador consulta los tags cada 30 min (`UPDATER_FETCH_MINUTES`). Si el repositorio es **privado**, configura una *deploy key* de sólo lectura: `ssh-keygen -t ed25519 -f /root/.ssh/sonrisas_deploy`, añádela en GitHub → Settings → Deploy keys, y `git -C /opt/sonrisas remote set-url origin git@github.com:vichedev/Control_Sonrisas.git` (monta `/root/.ssh` en el servicio `updater` si actualizas desde la app).

### Migraciones (esquema de la base de datos)

- **Producción** (`DB_SYNC=false`): nunca `synchronize` (puede borrar columnas). Al arrancar se ejecutan las migraciones pendientes de `src/database/migrations`. Si las entidades no coinciden con la BD, el log avisa *"Falta una migración"*.
- **Desarrollo** (`DB_SYNC=true`): `synchronize` como siempre.
- **Baseline**: la primera migración (`<timestamp>-Baseline.ts`, clase `Baseline<timestamp>`) contiene el esquema completo; se genera con `npm run migration:baseline` contra una BD temporal vacía. En una BD nueva se ejecuta; en una BD existente (creada con synchronize) se **marca como aplicada sin ejecutarla**, aplicando antes sólo cambios **aditivos** que falten. Si el ajuste implicara borrar o transformar columnas, la api no arranca y no toca nada.
- Comandos: `npm run migration:show|run|revert` (dev), `node dist/database/migrate-cli.js show|run|revert [n]` (dentro de la imagen; `./deploy.sh migrations`).

---

## 4. Volver a la versión anterior

Desde la app: **Ajustes → Actualizaciones → Volver a la versión anterior**. En el servidor: `./deploy.sh rollback`.

1. Respaldo de seguridad del estado actual (tipo `pre-rollback`).
2. Si la versión actual aplicó migraciones nuevas, se **deshacen** con su `down()` — se conservan los datos registrados desde la actualización.
3. Se vuelve al código e imagen anteriores y se verifica la salud.

`--restore-db` (casilla en la app, pide escribir RESTAURAR): además restaura la BD del respaldo previo a la actualización. **Se pierde lo registrado desde entonces**; úsalo sólo si los datos quedaron dañados.

---

## 5. Respaldos

| Tipo | Cuándo | Retención |
|---|---|---|
| Nocturno | Cada día (`BACKUP_CRON`, por defecto 03:15) | últimos `BACKUP_KEEP_DAILY` (14) |
| Antes de actualizar / restaurar / volver atrás | Automático | últimos `BACKUP_KEEP_SAFETY` (10) |
| Manual / subido | Desde la app o `./deploy.sh backup` | nunca se borran solos salvo pasar de `BACKUP_MAX_MANUAL` (30) |

Cada respaldo es **un archivo** `sonrisas-backup-AAAAMMDD-HHMMSS-<tipo>.tar[.enc]` con `manifest.json` (versión, fecha, tamaños, sha256), `db.dump` (`pg_dump -Fc`) y `uploads.tar.gz` (fotos), más un `.json` de resumen al lado. Viven en el volumen `sonrisas_backups`.

**Desde la app** (Ajustes → Respaldos, sólo dirección): crear ahora, subir un respaldo (hasta `BACKUP_UPLOAD_MAX_MB`, se verifica antes de aceptarlo), verificar, descargar, eliminar y restaurar. Descargar/eliminar/restaurar piden contraseña y código 2FA; todo queda en **Auditoría**.

**Cifrado** (`BACKUP_ENCRYPTION_KEY`): AES-256-CBC con PBKDF2 (200 000 iteraciones), compatible con OpenSSL. Descifrar a mano en cualquier equipo:

```bash
BACKUP_ENCRYPTION_KEY='la-clave' scripts/decrypt-backup.sh sonrisas-backup-….tar.enc ./recuperado
# o sólo con openssl:
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_ENCRYPTION_KEY -in X.tar.enc | tar -x
```

Si cambias la clave, los respaldos anteriores siguen necesitando la clave antigua: guárdala.

### Restaurar

App: **Respaldos → Restaurar** (escribir RESTAURAR + contraseña + 2FA). Servidor: `./deploy.sh restore sonrisas-backup-….tar.enc`.

1. Se verifica la integridad (sha256 de cada pieza).
2. Se detiene la api y se hace un respaldo de seguridad del estado actual.
3. La BD se restaura en una base **nueva** y, sólo si todo salió bien, se intercambia por la actual. La anterior queda como `sonrisas_prev` hasta la siguiente restauración.
4. Las fotos se **fusionan** (no se borra ninguna existente).
5. Se arranca la api (aplica migraciones si el respaldo es de una versión anterior). Si no arranca, se vuelve automáticamente a `sonrisas_prev`.

Respaldos del formato antiguo (`ftw-*.sql.gz`, `ftw-uploads-*.tar.gz`) se listan y descargan, pero se restauran a mano:
`gunzip -c ftw-….sql.gz | docker exec -i sonrisas_db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.

### Copia fuera del servidor (imprescindible)

Si el disco o el proveedor fallan, los respaldos locales se pierden con el servidor. Regla **3-2-1**: 3 copias, 2 soportes, 1 fuera.

```bash
# en .env.production, UNO de los dos:
OFFSITE_RSYNC=usuario@otro-servidor:/srv/respaldos/sonrisas     # con clave SSH
OFFSITE_RCLONE=remoto:sonrisas                                    # rclone config: Drive, S3, B2…

# cron del servidor (crontab -e), después del nocturno:
0 4 * * * /opt/sonrisas/scripts/offsite-copy.sh >> /var/log/sonrisas-offsite.log 2>&1
```

Copia sólo archivos nuevos y nunca borra en el destino. Como alternativa mínima: descarga un respaldo cada semana desde la app.

**Prueba la restauración** cada pocos meses: en otro equipo con Docker, instala Sonrisas, sube el respaldo en *Respaldos → Subir* y restáuralo (o usa `scripts/decrypt-backup.sh` + `pg_restore` en una BD de prueba).

---

## 6. Seguridad del despliegue

- **Base de datos**: nunca publicada; en una red Docker interna sin salida a internet; autenticación SCRAM; `deploy.sh` rechaza claves por defecto o de menos de 16 caracteres.
- **Contenedores**: api y backup como usuario `node`, sistema de archivos de **sólo lectura** (+ `/tmp` en memoria), `cap_drop: ALL`, `no-new-privileges`, límites de memoria, `restart: unless-stopped`, logs rotados (10 MB × 5).
- **Caddy**: HTTPS obligatorio, cabeceras de seguridad (HSTS, nosniff, DENY de iframes, Permissions-Policy), sin log de accesos (las URLs de fotos llevan tokens), límite de tamaño de peticiones.
- **Actualizador**: tiene el socket de Docker (equivale a root), por eso no publica puertos, no comparte red con la api ni la BD, sólo acepta 3 acciones con parámetros validados (`^vX.Y.Z$`, nombre de respaldo con formato fijo) y nunca pasa texto del usuario a un shell. La api le habla sólo a través de archivos en volúmenes (`/ops/jobs` → escritura de la api; `/ops/status` → sólo lectura para la api). Para desactivarlo: `docker compose --env-file .env.production stop updater` (se puede seguir actualizando por SSH).
- **Secretos**: `.env.production` con permisos 600, fuera de git y de la imagen. Respaldos con permisos 640 y cifrados.
- **Operaciones críticas** desde la app (restaurar, actualizar, volver atrás, descargar o borrar respaldos): sólo dirección, con contraseña + 2FA, bloqueo tras 5 intentos fallidos en 15 min, y auditoría.

---

## 7. Variables de `.env.production`

| Variable | Descripción |
|---|---|
| `SONRISAS_DIR` | Carpeta del proyecto (`/opt/sonrisas`) |
| `SITE_ADDRESS` | Dominio (Let's Encrypt) o IP (auto-firmado) |
| `HTTP_PORT` / `HTTPS_PORT` | Puertos del host (80 / 443) |
| `TZ` | Zona horaria: determina qué cuenta como "hoy" y la hora del respaldo nocturno |
| `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | PostgreSQL. La clave sólo se lee al crear el volumen |
| `DB_SYNC` | `false` en producción (migraciones). `deploy.sh` corrige `true` automáticamente |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | ≥ 32 caracteres. Rotarlo cierra todas las sesiones |
| `FRONTEND_URL` / `BACKEND_URL` | `https://SITE_ADDRESS` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Cuenta de dirección inicial (seed) |
| `UPLOADS_REQUIRE_AUTH` | `true`: las fotos exigen token firmado |
| `WHATSAPP_*` | Ver secciones de WhatsApp |
| `VAPID_*` | Notificaciones push (se generan solas en la instalación) |
| `BACKUP_ENCRYPTION_KEY` | Cifrado de respaldos (vacía = sin cifrar) |
| `BACKUP_CRON` | Hora del respaldo nocturno (cron) |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_SAFETY` / `BACKUP_MAX_MANUAL` | Retención |
| `BACKUP_UPLOAD_MAX_MB` | Tamaño máximo al subir un respaldo |
| `OFFSITE_RSYNC` / `OFFSITE_RCLONE` | Destino de `scripts/offsite-copy.sh` |
| `UPDATER_FETCH_MINUTES` | Frecuencia de consulta de versiones |
| `OPS_INPROCESS_RESTORE` | `true` permite restaurar sin actualizador (no recomendado) |
| `DB_MEM_LIMIT` / `API_MEM_LIMIT` | Límites de memoria (1g por defecto) |

---

## Vincular el WhatsApp del centro (envío automático por QR)

Es la forma recomendada: no requiere cuenta de Meta ni plantillas.

1. Entra como **dirección** → **Panel → WhatsApp** → *Vincular WhatsApp*.
2. En el teléfono del centro: *WhatsApp → ⋮ / Configuración → Dispositivos vinculados → Vincular un dispositivo* y escanea el QR (cambia cada ~20 s; la página se actualiza sola).
3. Cuando aparezca **Conectado** con el número, pulsa *Enviar mensaje de prueba*.
4. En **Avisos automáticos** activa el interruptor general y elige qué novedades se avisan (llegada, retiro, salud/incidentes, justificaciones) y el horario de silencio.

La sesión se guarda en el volumen Docker **`sonrisas_wa_auth`** (montado en `/app/.wa-auth`), así sobrevive a `./deploy.sh restart/update`. Si borras el volumen (p. ej. con `docker compose down -v`, que nunca debes usar) hay que volver a escanear. Para desvincular: botón *Desvincular* en la misma pantalla (o desde el teléfono, en Dispositivos vinculados).

> **Una sola instancia.** No arranques dos servidores con la misma sesión (p. ej. desarrollo local + producción con una copia de la carpeta): WhatsApp cierra uno de los dos (*"La sesión se abrió en otro servidor"*).

**Riesgos:** conexión no oficial (como WhatsApp Web). Usa un número dedicado, evita envíos masivos (el sistema ya espacia: 2–4 s entre mensajes, máx. 20/min) y mantén el teléfono encendido con internet. El volumen `sonrisas_wa_auth` permite enviar como el centro: no lo copies ni lo compartas. Si el número se desconecta, los reportes vuelven solos al modo manual (`wa.me`) y los avisos automáticos se registran como fallidos.

## Activar el envío automático por la Cloud API de Meta

Por defecto el sistema usa el proveedor **manual**: prepara el mensaje y abre `wa.me` para que la educadora pulse enviar (o el WhatsApp vinculado, si está conectado). Para usar la API oficial de Meta:

1. Crea una app en **Meta for Developers** con el producto *WhatsApp* y verifica un número de empresa.
2. Copia el **Phone Number ID** y un **token permanente** (usuario del sistema) a `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_TOKEN`.
3. Crea y espera la aprobación de una **plantilla** de tipo *utility* con un parámetro de cuerpo (`{{1}}`), y ponla en `WHATSAPP_TEMPLATE_NAME`. Sin plantilla, la API sólo permite responder dentro de la ventana de 24 h desde el último mensaje de la familia.
4. Cambia `WHATSAPP_PROVIDER=cloud` y `./deploy.sh restart`.

No hay que tocar código: el proveedor se elige al arrancar y el resto del sistema no cambia. Los envíos siguen quedando registrados en la bitácora de mensajes.

## Problemas comunes

- **No se ve la web / `ERR_SSL_PROTOCOL_ERROR`:** suele ser Caddy aún negociando el certificado o un problema de puertos. Mira `docker compose --env-file .env.production logs caddy` — debe decir `certificate obtained successfully`. Si dice errores de challenge: el dominio no resuelve aún a la IP del servidor, o los puertos 80/443 no están abiertos. Espera la propagación DNS y reintenta `./deploy.sh restart`.
- **`docker compose ps` no muestra `sonrisas_caddy` con `0.0.0.0:80->80/tcp`:** revisa que `HTTP_PORT` y `HTTPS_PORT` no estén vacíos, y que nada más use esos puertos (`ss -tlnp | grep -E ':80|:443'`).
- **La cámara no abre:** entra por `https://` (no `http://`) y concede el permiso de cámara al sitio.
- **Las fotos no se ven (403 en `/uploads/...`):** el frontend desplegado no está enviando el token de medios. Actualiza o reconstruye (`./deploy.sh update` / `./deploy.sh redeploy`), o cierra sesión y vuelve a entrar para recibir un token nuevo.
- **"Ningún representante de este niño tiene teléfono":** el reporte no se puede enviar hasta que al menos un representante tenga número y la casilla *«recibe reporte»* marcada. Se configura en la ficha del niño → Representantes.
- **El WhatsApp vinculado aparece "Desvinculado" o "Sin conexión":** si se cerró desde el teléfono (o pasó mucho tiempo apagado) hay que volver a escanear el QR en **Panel → WhatsApp**. Para ver más detalle: `WHATSAPP_LOG_LEVEL=warn` y `docker compose --env-file .env.production logs api`.
- **El navegador bloquea las pestañas al enviar reportes en bloque:** con el proveedor manual cada reporte abre un `wa.me`. Permite las ventanas emergentes para el sitio, o envíalos de uno en uno desde el detalle de cada reporte.
- **Una educadora dice que su cuenta está bloqueada:** son 5 intentos fallidos; se desbloquea sola en 15 minutos, o la dirección puede forzarlo desde **Personal** (botón del candado) o con `POST /api/staff/:id/unlock`.
- **Los reportes salen con el día equivocado:** revisa `TZ` en `.env.production`. Ver la nota del paso 3.
- **Cambiaste `DB_PASSWORD` y la api no conecta:** Postgres sólo lee la clave al crear su volumen. Vuelve a la clave anterior en `.env.production`, entra con `./deploy.sh psql`, ejecuta `ALTER USER <usuario> PASSWORD 'nueva';` y luego pon la nueva en el archivo y `./deploy.sh restart`. **Nunca** borres el volumen para "arreglarlo".
- **Olvidaste la contraseña de dirección:** cambia `ADMIN_PASSWORD` (con otro `ADMIN_EMAIL`) en `.env.production` y `./deploy.sh admin`, o entra al contenedor de la BD y edita la tabla `users`.
- **La actualización falló y volvió sola atrás:** el sistema sigue en la versión anterior con los datos intactos. Mira el motivo en Ajustes → Actualizaciones (log de la tarea) o `./deploy.sh history` y `./deploy.sh logs api`.
- **"Hay archivos del proyecto modificados a mano":** alguien editó archivos en `/opt/sonrisas`. Revisa `git status`; guarda los cambios (`git stash`) o descártalos (`git checkout -- <archivo>`) y reintenta.
- **"El actualizador no está en línea":** `./deploy.sh logs updater`. Suele ser `SONRISAS_DIR` mal configurado en `.env.production`. Reconstrúyelo: `docker compose --env-file .env.production up -d --build updater`.
- **La api no arranca con "El ajuste de esquema borraría o transformaría datos":** las entidades cambiaron sin migración. No se tocó nada. Vuelve atrás (`./deploy.sh rollback`) y publica una versión con la migración correspondiente.
- **"Otra operación de respaldo en curso":** espera a que termine (el nocturno tarda según la cantidad de fotos). Si quedó colgada tras un corte, el bloqueo se libera solo a las 6 h, o bórralo: `docker run --rm -v sonrisas_sonrisas_backups:/b alpine rm /b/.lock`.
- **"No se pudo descifrar el respaldo":** la `BACKUP_ENCRYPTION_KEY` no es la misma con la que se creó.
- **Restauraste y algo no cuadra:** la BD anterior a la restauración sigue en `sonrisas_prev`. Para volver a ella: `./deploy.sh stop`, `docker compose --env-file .env.production run --rm --no-deps api node dist/ops/cli.js swap-prev`, `./deploy.sh up`.
- **Disco lleno:** `docker system df`; borra respaldos antiguos desde la app y `docker image prune` (nunca `docker volume prune`).
