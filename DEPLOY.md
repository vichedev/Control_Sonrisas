# Despliegue — Sonrisitas (Docker)

Guía para instalar, actualizar, volver atrás y respaldar el sistema en un servidor **Ubuntu/Debian** con Docker.

## Instalación rápida con Nginx Proxy Manager (recomendada)

1. En el servidor, como root:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/vichedev/Control_Sonrisas/main/install.sh | sudo bash
   ```

   Sólo pregunta **el correo y la contraseña de dirección** y **el dominio** que tienes en NPM
   (Enter = `sonrisitas.maat.ec`). Instala Docker si falta, genera las claves, levanta todo en el
   puerto **8986** (`8986:3000`) y crea la cuenta de dirección. La contraseña no se guarda en disco.

2. En **Nginx Proxy Manager → Proxy Hosts → Add Proxy Host**:

   | Campo | Valor |
   |---|---|
   | Domain Names | `sonrisitas.maat.ec` |
   | Scheme | `http` |
   | Forward Hostname / IP | IP del servidor (p. ej. `205.235.2.135`) |
   | Forward Port | `8986` |
   | Opciones | Websockets Support · Block Common Exploits |
   | SSL | Let's Encrypt · Force SSL · HTTP/2 |
   | Advanced (recomendado) | `proxy_buffering off;  proxy_read_timeout 3600s;  client_max_body_size 50m;` |

   El "Advanced" evita que NPM retenga el canal de tiempo real y permite subir fotos grandes.

3. Abre `https://sonrisitas.maat.ec` y entra con el correo y la contraseña que escribiste.

> **Seguridad:** el puerto 8986 queda abierto (Docker se salta ufw). Si NPM está en **otro**
> servidor, limita en el firewall de tu proveedor el acceso al 8986 sólo desde la IP de NPM.
> Si NPM está en este mismo servidor, ver §1.3 para dejarlo sólo en local.
>
> Cambiar la contraseña de dirección más adelante: `cd /opt/sonrisas && sudo ./deploy.sh admin`.
> Cuestionario completo (Caddy con Let's Encrypt propio, otros puertos…): `SONRISAS_ADVANCED=1`.

```text
api      →  NestJS: API /api/* + la web. Publica el puerto 8986 (→ 3000). Aplica migraciones al arrancar
caddy    →  sólo en modo HTTPS: Let's Encrypt en 80/443 (perfil `https` de docker compose)
db       →  PostgreSQL 16, en red interna sin internet, nunca publicado
backup   →  respaldo nocturno (BD + fotos)
updater  →  aplica actualizaciones / vuelta atrás / restauraciones pedidas desde la app
```

**Datos que nunca se pierden** — viven en volúmenes de Docker, no en la carpeta del proyecto: `sonrisas_db_data` (BD), `sonrisas_uploads` (fotos), `sonrisas_backups` (respaldos), `sonrisas_wa_auth` (sesión de WhatsApp), `sonrisas_caddy_data` (certificados, modo HTTPS). Ningún comando de `deploy.sh` los borra.

> ⚠️ **Nunca** ejecutes `docker compose down -v` ni `docker volume rm`: borran la base de datos y las fotos.

---

## 1. Instalación (primera vez)

Requisitos: Ubuntu 22.04/24.04 o Debian 12, 2 GB de RAM, 20 GB de disco, acceso root (`sudo`).

```bash
curl -fsSL https://raw.githubusercontent.com/vichedev/Control_Sonrisas/main/install.sh | sudo bash
```

### Qué pregunta el instalador

| # | Pregunta | Por defecto |
|---|---|---|
| 1 | **Usuario** de la cuenta de dirección (correo) | — |
| 1 | **Contraseña** (oculta, se pide dos veces). Política del sistema: **mínimo 10 caracteres, con al menos una letra y un número** (rechaza contraseñas comunes o de un solo carácter repetido) | — |
| 1 | Nombre que se mostrará | `Dirección` |
| 2 | Nombre del centro | `Sonrisitas` |
| 2 | Lema / descripción | `Centro de Desarrollo Infantil` |
| 2 | Zona horaria · código de país de WhatsApp | `America/Guayaquil` · `593` |
| 3 | **Modo de acceso**: `1` puerto directo · `2` HTTPS con dominio | `1` |
| 3 | IP pública o dominio del servidor · puerto | IP detectada · `8986` |
| 4 | ¿Cifrar los respaldos? | sí |

La **contraseña nunca se guarda en disco**: el instalador se la entrega al contenedor por la entrada estándar sólo para crear la cuenta (`ADMIN_PASSWORD` queda vacía en `.env.production`). Para cambiarla más adelante: `./deploy.sh admin`.

### Los dos modos de acceso

**1) Puerto directo (por defecto)** — Docker publica `8986:3000` y se entra por **`http://IP-o-dominio:8986`**. No arranca Caddy ni usa los puertos 80/443 (útil si el servidor ya tiene otra web).

> ⚠️ **Sin HTTPS el navegador no permite usar la cámara** (fotos de entrada/salida) **ni instalar la app (PWA)**, salvo en `http://localhost`. Todo lo demás funciona. Para la cámara: pon delante un proxy con certificado (tu Nginx, Caddy o Cloudflare — ver §1.1) o reinstala con el modo 2. El instalador pregunta si ya tienes ese proxy: si dices que sí, pide la URL `https://…` pública y, si el proxy está en el mismo servidor, deja el 8986 sólo en `127.0.0.1`.

**2) HTTPS con dominio (Caddy + Let's Encrypt)** — Caddy en 80/443 obtiene el certificado solo. El registro **A** del dominio debe apuntar a la IP del servidor **antes** de instalar (con una IP en vez de dominio el certificado es auto-firmado y el navegador avisa). La app sigue escuchando en el 8986 **sólo en `127.0.0.1`**; el instalador pregunta si quieres exponerlo también (por defecto no).

### Qué hace, paso a paso

1. Instala Docker (si falta), `git`, `jq`, `openssl`.
2. Clona el proyecto en `/opt/sonrisas` en la **última versión publicada** (`vX.Y.Z`; si no hay, `main`).
3. Hace las preguntas de arriba (o las toma de variables de entorno, ver abajo).
4. Genera secretos fuertes (clave de BD, `JWT_SECRET`, clave de cifrado de respaldos, claves VAPID) y escribe `.env.production` con permisos **600**. Si el archivo ya existe, ofrece **conservarlo** (por defecto) o **reconfigurar** (copia `.env.production.bak-FECHA`; se conservan la clave de la BD, `JWT_SECRET`, la de respaldos y VAPID). Aun conservándolo, pregunta si quieres fijar el usuario y la contraseña de dirección.
5. Abre en `ufw` (si está activo) el 8986, o 80/443 en modo HTTPS.
6. Construye la imagen, arranca todo, espera a que `/api/health` responda y crea la cuenta de dirección con el usuario y la contraseña indicados (si ya existe, le pone esa contraseña).
7. Muestra la **URL** y el **usuario** (no la contraseña) y, una sola vez, la **clave de cifrado de respaldos**.

> **Guarda la clave de cifrado FUERA del servidor** (gestor de contraseñas). Sin ella ningún respaldo cifrado se puede abrir si el servidor se pierde.

Sin preguntas (automatizado):

```bash
# Puerto directo
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD     # así la contraseña no queda en el historial
sudo -E SONRISAS_NONINTERACTIVE=1 PUBLIC_MODE=http PUBLIC_HOST=203.0.113.10 APP_PORT=8986 \
     ADMIN_EMAIL=direccion@sonrisitas.com ADMIN_NAME="Dirección" \
     COMPANY_NAME="Sonrisitas" COMPANY_TAGLINE="Centro de Desarrollo Infantil" \
     TZ=America/Guayaquil BACKUP_ENCRYPT=1 bash install.sh

# HTTPS con dominio: PUBLIC_MODE=https PUBLIC_HOST=asistencia.midominio.com [EXPOSE_APP_PORT=1]
# Proxy propio delante (modo http): BEHIND_PROXY=1 PUBLIC_URL=https://asistencia.midominio.com [PROXY_LOCAL=1]
# .env.production existente: KEEP_ENV=1 (conservar, por defecto) o KEEP_ENV=0 (reconfigurar)
```

Volver a ejecutar el instalador es seguro: no toca los volúmenes de datos ni cambia de versión una instalación existente (para eso, `./deploy.sh update`).

Después de entrar: **activa la verificación en dos pasos (2FA)** en Seguridad (las operaciones críticas la piden) y configura horario, salas, personal y niños. El logo de Sonrisitas viene puesto por defecto; se cambia en **Marca**.

### 1.1 Proxy propio con HTTPS delante (modo puerto directo)

Si el servidor ya tiene Nginx (u otro proxy) con certificado, déjalo delante del 8986. Instala con el modo 1, responde **sí** a «¿proxy propio con HTTPS?», escribe la URL pública `https://…` y elige que el proxy está en este servidor (el 8986 queda en `127.0.0.1`). Eso deja en `.env.production`:

```ini
PUBLIC_MODE=http
APP_BIND=127.0.0.1
APP_PORT=8986
FRONTEND_URL=https://asistencia.midominio.com
BACKEND_URL=https://asistencia.midominio.com
TRUST_PROXY=true
```

(Si ya instalaste sin proxy, edita esas líneas y ejecuta `./deploy.sh up`.) Ejemplo de Nginx (certificado con `certbot --nginx -d asistencia.midominio.com`):

```nginx
# En el bloque http { } de nginx.conf, si no existe ya:
# map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 80;
    server_name asistencia.midominio.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name asistencia.midominio.com;

    ssl_certificate     /etc/letsencrypt/live/asistencia.midominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/asistencia.midominio.com/privkey.pem;

    # Fotos en base64 dentro de las peticiones
    client_max_body_size 20m;
    # Sin log de accesos: las URLs de las fotos llevan tokens (?mt=)
    access_log off;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Tiempo real (Server-Sent Events): sin buffer y con lectura larga
    location /api/realtime/ {
        proxy_pass http://127.0.0.1:8986;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_set_header Connection "";
    }

    # Subida de respaldos desde la app (hasta ~2 GB)
    location = /api/system/backups/upload {
        proxy_pass http://127.0.0.1:8986;
        client_max_body_size 2100m;
        proxy_request_buffering off;
        proxy_read_timeout 30m;
    }

    location / {
        proxy_pass http://127.0.0.1:8986;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

Con `X-Forwarded-Proto: https` la api envía HSTS y `upgrade-insecure-requests` sólo en esas peticiones; por `http://IP:8986` directo no los envía (si lo hiciera, la página dejaría de cargar). **Cloudflare** (proxy naranja o *Tunnel*) funciona igual: origen `http://IP:8986` (o `http://127.0.0.1:8986` con `cloudflared`), `FRONTEND_URL`/`BACKEND_URL` con la URL `https://` y `TRUST_PROXY=true`.

### 1.2 Cambiar de modo después

Edita `.env.production` y ejecuta `./deploy.sh up` (crea o retira Caddy según el modo):

- **A HTTPS con Caddy:** `PUBLIC_MODE=https`, `SITE_ADDRESS=tu-dominio`, `FRONTEND_URL` y `BACKEND_URL` = `https://tu-dominio`, `TRUST_PROXY=true`, `APP_BIND=127.0.0.1`; abre 80/443 (`ufw allow 80/tcp && ufw allow 443/tcp`).
- **A puerto directo:** `PUBLIC_MODE=http`, `APP_BIND=0.0.0.0`, `FRONTEND_URL` y `BACKEND_URL` = `http://IP:8986`, `TRUST_PROXY=false`.

### 1.3 Firewall

`ufw` **no filtra** los puertos que publica Docker (Docker inserta sus reglas antes). Por eso en modo HTTPS el 8986 se publica sólo en `127.0.0.1`, y en modo directo el 8986 queda abierto a la red aunque `ufw` no lo permita. Para restringirlo por IP usa el firewall del proveedor o la cadena `DOCKER-USER` de iptables.

### Instalación existente sin git (copiada con rsync)

Ejecuta igualmente el instalador: detecta la carpeta, hace una copia `/opt/sonrisas.bak-FECHA`, la convierte en repositorio git (sin tocar `.env.production` ni los volúmenes), **vuelca la BD a `exports/pre-install-*.sql.gz`** antes de cambiar nada, cambia `DB_SYNC` a `false` y arranca la nueva versión. La primera vez, la BD existente (creada con `synchronize`) **adopta** la migración base sin re-ejecutarla. Un `.env.production` antiguo sin `PUBLIC_MODE` se trata como instalación con Caddy (`deploy.sh` añade `PUBLIC_MODE=https` y deja el 8986 sólo en `127.0.0.1`).

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
| `logs [servicio]` | Logs en vivo (`api`, `db`, `backup`, `updater`; `caddy` en modo HTTPS) |
| `up` · `restart` · `stop` | Levantar (aplica cambios de `.env.production`, p. ej. el modo de acceso) · reiniciar · detener (no borra datos) |
| `admin` | Crea la cuenta de dirección o le cambia la contraseña: pide usuario y contraseña (oculta, dos veces) y no la guarda en disco |
| `psql` · `shell` | Consola de Postgres · shell en la api |
| `redeploy` | Reconstruye el código actual sin cambiar de versión (con respaldo y vuelta atrás) |

Opciones: `--yes` (no preguntar), `--force`. Todos los comandos leen `PUBLIC_MODE` y activan Caddy (`--profile https`) sólo en modo HTTPS; no uses `docker compose` a mano sin ese perfil en modo HTTPS.

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
- **Caddy** (modo HTTPS): HTTPS obligatorio, cabeceras de seguridad (HSTS, nosniff, DENY de iframes, Permissions-Policy), sin log de accesos (las URLs de fotos llevan tokens), límite de tamaño de peticiones.
- **Puerto directo** (modo HTTP): el tráfico va **sin cifrar** (contraseñas y fotos incluidas) entre el navegador y el servidor. Úsalo en una red de confianza o pon un proxy con TLS delante (§1.1). La api sólo envía HSTS y `upgrade-insecure-requests` a las peticiones que llegan por HTTPS.
- **Cuenta de dirección**: la contraseña no se guarda en `.env.production`; `install.sh` y `./deploy.sh admin` se la pasan al contenedor por la entrada estándar.
- **Actualizador**: tiene el socket de Docker (equivale a root), por eso no publica puertos, no comparte red con la api ni la BD, sólo acepta 3 acciones con parámetros validados (`^vX.Y.Z$`, nombre de respaldo con formato fijo) y nunca pasa texto del usuario a un shell. La api le habla sólo a través de archivos en volúmenes (`/ops/jobs` → escritura de la api; `/ops/status` → sólo lectura para la api). Para desactivarlo: `docker compose --env-file .env.production stop updater` (se puede seguir actualizando por SSH).
- **Secretos**: `.env.production` con permisos 600, fuera de git y de la imagen. Respaldos con permisos 640 y cifrados.
- **Operaciones críticas** desde la app (restaurar, actualizar, volver atrás, descargar o borrar respaldos): sólo dirección, con contraseña + 2FA, bloqueo tras 5 intentos fallidos en 15 min, y auditoría.

---

## 7. Variables de `.env.production`

| Variable | Descripción |
|---|---|
| `SONRISAS_DIR` | Carpeta del proyecto (`/opt/sonrisas`) |
| `PUBLIC_MODE` | `http` (puerto directo, sin Caddy) o `https` (Caddy en 80/443). Sin valor = `https` (instalaciones antiguas) |
| `APP_PORT` / `APP_BIND` | Puerto del host para la app (`8986`) y en qué interfaz: `0.0.0.0` (red) o `127.0.0.1` (sólo local, detrás de un proxy) |
| `TRUST_PROXY` | `true` si hay un proxy delante (Caddy o el tuyo): IP real del cliente para los límites de intentos |
| `SITE_ADDRESS` | Dominio (Let's Encrypt) o IP (auto-firmado) para Caddy; en modo http, sólo referencia |
| `HTTP_PORT` / `HTTPS_PORT` | Puertos del host de Caddy (80 / 443) |
| `TZ` | Zona horaria: determina qué cuenta como "hoy" y la hora del respaldo nocturno |
| `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | PostgreSQL. La clave sólo se lee al crear el volumen |
| `DB_SYNC` | `false` en producción (migraciones). `deploy.sh` corrige `true` automáticamente |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | ≥ 32 caracteres. Rotarlo cierra todas las sesiones |
| `FRONTEND_URL` / `BACKEND_URL` | URL pública: `http://IP:8986` (modo http) o `https://dominio`. Si empieza por `https://`, la api lo considera publicado con TLS |
| `ADMIN_EMAIL` / `ADMIN_NAME` | Cuenta de dirección (seed). `ADMIN_PASSWORD` debe quedar **vacía**: si la rellenas a mano, se usa una vez y se borra |
| `COMPANY_NAME` / `COMPANY_TAGLINE` | Nombre y lema iniciales del centro (`Sonrisitas` / `Centro de Desarrollo Infantil`); luego se cambian en Marca |
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

- **Modo puerto directo: no carga `http://IP:8986`:** comprueba `./deploy.sh status` (la api debe mostrar `0.0.0.0:8986->3000/tcp`), que `curl -s http://127.0.0.1:8986/api/health` responda en el servidor y que el firewall del proveedor permita el 8986/tcp. Si el navegador salta solo a `https://IP:8986`, es una caché de HSTS de una prueba anterior con HTTPS: bórrala en `chrome://net-internals/#hsts` (o prueba en ventana privada).
- **No se ve la web / `ERR_SSL_PROTOCOL_ERROR` (modo HTTPS):** suele ser Caddy aún negociando el certificado o un problema de puertos. Mira `./deploy.sh logs caddy` — debe decir `certificate obtained successfully`. Si dice errores de challenge: el dominio no resuelve aún a la IP del servidor, o los puertos 80/443 no están abiertos. Espera la propagación DNS y reintenta `./deploy.sh restart`.
- **`docker compose ps` no muestra `sonrisas_caddy` con `0.0.0.0:80->80/tcp`:** revisa que `HTTP_PORT` y `HTTPS_PORT` no estén vacíos, y que nada más use esos puertos (`ss -tlnp | grep -E ':80|:443'`).
- **La cámara no abre:** el navegador sólo la permite con `https://` (o en `localhost`). En modo puerto directo pon un proxy con TLS delante (§1.1) o cambia al modo HTTPS (§1.2); después concede el permiso de cámara al sitio.
- **Las fotos no se ven (403 en `/uploads/...`):** el frontend desplegado no está enviando el token de medios. Actualiza o reconstruye (`./deploy.sh update` / `./deploy.sh redeploy`), o cierra sesión y vuelve a entrar para recibir un token nuevo.
- **"Ningún representante de este niño tiene teléfono":** el reporte no se puede enviar hasta que al menos un representante tenga número y la casilla *«recibe reporte»* marcada. Se configura en la ficha del niño → Representantes.
- **El WhatsApp vinculado aparece "Desvinculado" o "Sin conexión":** si se cerró desde el teléfono (o pasó mucho tiempo apagado) hay que volver a escanear el QR en **Panel → WhatsApp**. Para ver más detalle: `WHATSAPP_LOG_LEVEL=warn` y `docker compose --env-file .env.production logs api`.
- **El navegador bloquea las pestañas al enviar reportes en bloque:** con el proveedor manual cada reporte abre un `wa.me`. Permite las ventanas emergentes para el sitio, o envíalos de uno en uno desde el detalle de cada reporte.
- **Una educadora dice que su cuenta está bloqueada:** son 5 intentos fallidos; se desbloquea sola en 15 minutos, o la dirección puede forzarlo desde **Personal** (botón del candado) o con `POST /api/staff/:id/unlock`.
- **Los reportes salen con el día equivocado:** revisa `TZ` en `.env.production`. Ver la nota del paso 3.
- **Cambiaste `DB_PASSWORD` y la api no conecta:** Postgres sólo lee la clave al crear su volumen. Vuelve a la clave anterior en `.env.production`, entra con `./deploy.sh psql`, ejecuta `ALTER USER <usuario> PASSWORD 'nueva';` y luego pon la nueva en el archivo y `./deploy.sh restart`. **Nunca** borres el volumen para "arreglarlo".
- **Olvidaste la contraseña de dirección:** `cd /opt/sonrisas && ./deploy.sh admin`, escribe el correo de la cuenta y una contraseña nueva (se cierran sus sesiones; la 2FA se conserva). Con otro correo, crea una cuenta de dirección nueva.
- **La actualización falló y volvió sola atrás:** el sistema sigue en la versión anterior con los datos intactos. Mira el motivo en Ajustes → Actualizaciones (log de la tarea) o `./deploy.sh history` y `./deploy.sh logs api`.
- **"Hay archivos del proyecto modificados a mano":** alguien editó archivos en `/opt/sonrisas`. Revisa `git status`; guarda los cambios (`git stash`) o descártalos (`git checkout -- <archivo>`) y reintenta.
- **"El actualizador no está en línea":** `./deploy.sh logs updater`. Suele ser `SONRISAS_DIR` mal configurado en `.env.production`. Reconstrúyelo: `docker compose --env-file .env.production up -d --build updater`.
- **La api no arranca con "El ajuste de esquema borraría o transformaría datos":** las entidades cambiaron sin migración. No se tocó nada. Vuelve atrás (`./deploy.sh rollback`) y publica una versión con la migración correspondiente.
- **"Otra operación de respaldo en curso":** espera a que termine (el nocturno tarda según la cantidad de fotos). Si quedó colgada tras un corte, el bloqueo se libera solo a las 6 h, o bórralo: `docker run --rm -v sonrisas_sonrisas_backups:/b alpine rm /b/.lock`.
- **"No se pudo descifrar el respaldo":** la `BACKUP_ENCRYPTION_KEY` no es la misma con la que se creó.
- **Restauraste y algo no cuadra:** la BD anterior a la restauración sigue en `sonrisas_prev`. Para volver a ella: `./deploy.sh stop`, `docker compose --env-file .env.production run --rm --no-deps api node dist/ops/cli.js swap-prev`, `./deploy.sh up`.
- **Disco lleno:** `docker system df`; borra respaldos antiguos desde la app y `docker image prune` (nunca `docker volume prune`).
