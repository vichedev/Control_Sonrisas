# Sonrisas · Control y seguimiento infantil

Sistema para **guarderías y centros de cuidado infantil**. Registra el día de cada niño —a qué hora llegó, qué comió, qué actividades hizo, cuánto durmió, qué pasó— y al cerrar la jornada **envía el reporte a la familia por WhatsApp**. Las familias además tienen su **propio portal** para consultar el historial y ver las fotos.

## ¿Cómo funciona?

- **La dirección** crea las salas (Lactantes, Maternal, Caminadores…), las cuentas del personal y el horario del centro.
- **La coordinación o la dirección** inscribe a cada niño con su ficha completa: fecha de nacimiento, foto, **alergias**, condiciones médicas, pediatra, contacto de emergencia, rutinas de sueño y alimentación, y sus **representantes** (madre, padre, abuela…) con el número de WhatsApp al que llega el reporte.
- **La educadora**, desde el panel del día:
  - registra la **llegada** de cada niño (hora, estado de ánimo, temperatura, quién lo trae, foto opcional);
  - registra el **retiro** — y aquí está el único control de seguridad real del sistema: si quien retira **no está en la lista de autorizados**, el registro se rechaza salvo que se confirme la excepción de forma explícita, y entonces queda **señalado** para coordinación;
  - anota la **alimentación** por sala (un menú común y, niño a niño, cuánto comió) con foto del plato;
  - crea las **actividades** del día con fotos, y ajusta cómo participó cada niño;
  - lleva la **bitácora**: siestas, cambios de pañal, salud, incidentes y observaciones. Lo que marca como *«avisar a la familia»* aparece destacado y encabeza el reporte.
- **Al cerrar el día** se generan los reportes con todo lo anterior. La educadora puede editar el texto y añadir una nota personal antes de enviarlo.
- **Las familias** reciben el reporte por WhatsApp y entran al **portal familiar** para ver el día, el historial, las fotos compartidas y avisar de una ausencia sin llamar por teléfono.
- **El personal** sigue marcando su propia entrada y salida, y la coordinación puede asignar **pendientes** al equipo.

## Roles

| Rol | Qué puede hacer |
|---|---|
| **Dirección** (`admin`) | Todo: salas, cuentas, horario, marca, auditoría, borrados. |
| **Coordinación** (`coordinator`) | Inscribir niños, gestionar representantes (página **Representantes**: activar/desactivar, editar, restablecer acceso), aprobar ausencias, corregir registros, enviar reportes en bloque. No toca configuración ni cuentas. |
| **Educadora** (`teacher`) | El día a día **de su sala**: llegadas, retiros, comidas, actividades, bitácora, fotos, reportes y su propio marcaje. Sólo ve a los niños de las salas que tiene asignadas (en **Personal** o en **Salas**); sin sala asignada no ve ningún niño. |
| **Representante** (`guardian`) | Sólo el portal familiar, y sólo de **sus** niños: el día en vivo con la lista **«qué se hizo y qué no»**, el reporte de cierre, el historial, las fotos y los avisos de ausencia. |

## Stack

- **Backend:** NestJS + TypeORM + PostgreSQL + JWT (con 2FA TOTP opcional).
- **Frontend:** React + Vite + TailwindCSS v4 + React Router.
- **WhatsApp:** proveedor conmutable — enlace `wa.me` (manual) o WhatsApp Cloud API de Meta (automático).
- **Cámara:** `getUserMedia` del navegador. No hay reconocimiento facial: las fotos son recuerdo y constancia, no credenciales.

## Estructura

Un solo proyecto, un solo `package.json`, un solo `npm install`:

```text
sonrisas/
├── src/            # Backend: API NestJS
├── client/         # Frontend: SPA React (index.html, src/, public/, vite.config.mjs)
├── public/         # Frontend COMPILADO (lo genera `npm run build`; no se edita a mano)
├── dist/           # Backend compilado (lo genera `npm run build`)
├── uploads/        # Fotos subidas
├── scripts/        # backup.sh / restore.sh
├── package.json    # dependencias y scripts de todo el sistema
├── .env            # configuración local
└── Dockerfile · docker-compose.yml · Caddyfile · deploy.sh
```

En producción NestJS sirve la API en `/api` y la web desde `public/`, todo en el **mismo origen y puerto**.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Desarrollo: API (`:3000`, con recarga) + web (`:5173`, con recarga) a la vez |
| `npm run build` | Compila el frontend a `public/` y el backend a `dist/` |
| `npm start` | Producción sin Docker: API + web en `http://localhost:3000` |
| `npm run seed` | Crea la cuenta de dirección y las salas por defecto |
| `npm run dev:api` / `npm run dev:web` | Sólo una de las dos partes |
| `npm run lint` | ESLint del frontend |

Módulos del backend: `children` · `classrooms` · `attendance` (niños + personal) · `meals` · `daily-logs` · `activities` · `photos` · `reports` · `whatsapp` · `family` · `justifications` · `tasks` · `schedule` · `staff` · `audit` · `push` · `reminders` · `branding`.

## Puesta en marcha (desarrollo)

### 1. Base de datos

```sql
CREATE DATABASE sonrisas;
```

> El esquema lo crea TypeORM solo (`synchronize`). Este sistema tiene un modelo de datos **distinto** al de un control de asistencia laboral: usa una base nueva, no reutilices una anterior.

### 2. Instalar y arrancar

```bash
cd sonrisas
cp .env.example .env        # ajusta credenciales de Postgres y JWT_SECRET
npm install                 # instala backend y frontend juntos
npm run seed                # crea la cuenta de dirección y las salas por defecto
npm run dev                 # API en :3000 + web en http://localhost:5173
```

Variables clave de `.env`:

| Variable | Descripción |
|---|---|
| `DB_*` | Conexión a PostgreSQL |
| `JWT_SECRET` | Secreto de los tokens (≥32 caracteres; la app no arranca sin él) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Cuenta de dirección que crea `npm run seed` |
| `UPLOADS_REQUIRE_AUTH` | Exige token firmado para servir las fotos. `true` en producción |
| `WHATSAPP_PROVIDER` | `manual` (enlace wa.me; usa el número vinculado si está conectado), `linked` o `cloud` (Cloud API de Meta) |
| `WHATSAPP_SESSION_DIR` | Carpeta de la sesión del WhatsApp vinculado (por defecto `./.wa-auth`; no se sube a git) |
| `WHATSAPP_COUNTRY_CODE` | Prefijo por defecto para números escritos sin él (Ecuador: `593`) |
| `TZ` (contenedor) | Zona horaria. El sistema razona en días naturales: una TZ equivocada desplaza los registros de la tarde |

> En desarrollo el navegador habla sólo con `:5173` y Vite reenvía `/api` y `/uploads` al backend (`:3000`), así se respeta la CSP `connect-src 'self'`. Si el backend está en otra máquina: `VITE_DEV_BACKEND=http://IP:3000 npm run dev:web`.

### 3. Entrar

- **Dirección:** `http://localhost:5173/` → inicia sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Revisa **Salas**, crea las cuentas del personal en **Personal** y configura **Horario del centro**.
- Inscribe niños en **Niños → Inscribir niño**, añadiendo sus representantes con teléfono. Si marcas *«crear acceso al portal»*, el sistema genera una contraseña temporal que se muestra **una sola vez**: anótala y entrégala a la familia.
- **Representante:** entra con su correo y la contraseña temporal → portal familiar.

## WhatsApp

El centro maneja **un solo número de WhatsApp** para avisar a las familias de cualquier novedad. Hay tres formas de enviar:

- **WhatsApp vinculado (recomendado).** En **Panel → WhatsApp** la dirección pulsa *Vincular WhatsApp* y escanea el código QR desde el teléfono del centro (*WhatsApp → Dispositivos vinculados → Vincular un dispositivo*), igual que WhatsApp Web. Desde ese momento los reportes y avisos salen **solos** desde ese número. Usa la librería [Baileys](https://github.com/WhiskeySockets/Baileys) (sin navegador). La sesión se guarda en `WHATSAPP_SESSION_DIR` y se reconecta sola al reiniciar.
  - Se usa siempre que esté conectado, salvo con `WHATSAPP_PROVIDER=cloud`. Si se desconecta, los reportes vuelven al modo manual (`wa.me`) y nada se pierde.
  - **Cola con ritmo:** un mensaje cada 2–4 s, máximo 20 por minuto, 2 reintentos; antes de enviar se comprueba que el número tenga WhatsApp.
  - **Avisos automáticos** (se activan en la misma pantalla, apagados por defecto): llegada, retiro, salud/incidente marcado *«avisar a la familia»* y justificación aprobada/rechazada. Van a los representantes con *«recibe reporte»* y teléfono, respetan un horario de silencio (por defecto 20:00–06:30) y no se duplican. Sólo salen por el número vinculado: si no está conectado quedan como *fallidos* en la bitácora.
  - **Riesgos:** es una conexión **no oficial** (WhatsApp Web). Usa un número dedicado del centro, mantén el teléfono con batería e internet (si pasa ~14 días sin conectarse, WhatsApp cierra los dispositivos vinculados) y evita envíos masivos a números que no tienen guardado el contacto del centro: WhatsApp puede restringir o bloquear el número. Quien tenga la carpeta de sesión puede enviar como el centro: protégela como una contraseña.
- **`manual` (por defecto).** El sistema arma el mensaje y devuelve un enlace `wa.me`; el panel lo abre y la educadora pulsa enviar desde su propio WhatsApp. Sin costo, sin verificación de Meta, funciona desde el primer día. Todo queda registrado en la bitácora de mensajes.
- **`cloud`.** Envío automático con la WhatsApp Cloud API. Requiere cuenta de Meta Business, número verificado y —fuera de la ventana de 24 h de atención— una **plantilla aprobada** (`WHATSAPP_TEMPLATE_NAME`, con el texto del reporte como parámetro del cuerpo). Se activa sólo con variables de entorno, sin tocar código.

Las **fotos no viajan en el mensaje**: el reporte las menciona y la familia las ve en su portal, donde el acceso está autenticado.

## Despliegue

Producción con **Docker Compose** en Ubuntu/Debian (NestJS + PostgreSQL + respaldos + actualizador, y Caddy en modo HTTPS). Guía completa: **[DEPLOY.md](DEPLOY.md)**.

```bash
# Instalación en el servidor (una línea). Pregunta el usuario y la contraseña de dirección
# (oculta, no se guarda en disco), el nombre del centro y el modo de acceso:
#   1) puerto directo http://IP-o-dominio:8986 (Docker 8986:3000, por defecto)
#   2) HTTPS con dominio (Caddy + Let's Encrypt en 80/443)
curl -fsSL https://raw.githubusercontent.com/vichedev/Control_Sonrisas/main/install.sh | sudo bash

cd /opt/sonrisas
./deploy.sh status            # estado, versión y últimos respaldos
./deploy.sh update            # a la última versión publicada (respaldo previo + vuelta atrás automática)
./deploy.sh rollback          # volver a la versión anterior
./deploy.sh backup            # respaldo manual (también desde Panel → Respaldos)
./deploy.sh admin             # crear la cuenta de dirección o cambiarle la contraseña
```

> En modo puerto directo (HTTP) el navegador no permite la cámara ni instalar la app: pon delante un proxy con HTTPS (ejemplo de Nginx en [DEPLOY.md §1.1](DEPLOY.md)) o usa el modo 2.

- **Versiones:** cada versión es un tag `vX.Y.Z` en GitHub. Publicar: subir `version` en `package.json`, `git tag -a v1.2.0 -m "Notas…"` y `git push --tags`.
- **Esquema de la BD:** en producción se usan **migraciones** (`DB_SYNC=false`, nunca `synchronize`). Tras cambiar entidades: `npm run migration:generate -- src/database/migrations/NombreDelCambio`.
- La imagen Docker compila frontend y backend por sí sola. Sin Docker: `npm run build && npm start`.

## Privacidad y seguridad

Este sistema guarda **datos de menores**: fotos, salud, rutinas y quién puede retirarlos. Eso condiciona varias decisiones del diseño.

| Área | Control |
|---|---|
| **Cuentas** | No hay registro público. La primera cuenta de dirección la crea `npm run seed`; el resto las crea la dirección. Contraseñas de mínimo 10 caracteres con letra y número. Bloqueo de 15 min tras 5 intentos fallidos. Contraseñas temporales generadas con CSPRNG y mostradas una sola vez. |
| **Sesiones** | JWT firmado con `JWT_SECRET` + `tokenVersion` para invalidar sesiones al cambiar contraseña o desactivar una cuenta. 2FA TOTP opcional para cualquier usuario. Límite de 5 intentos de login por minuto y por IP. |
| **Fotos de los niños** | `/uploads` **no es público**: cada petición exige un token de medios firmado (HMAC) ligado al usuario y a su `tokenVersion`. Sólo se sirven extensiones de imagen, con `nosniff`, `Content-Type` forzado y CSP `sandbox`. |
| **Portal familiar** | Cada endpoint resuelve primero qué niños tiene a cargo el representante autenticado y filtra por esa lista. Ningún parámetro de la petición amplía el alcance: pedir el historial de un niño ajeno devuelve 404. Las notas internas del personal nunca se exponen. |
| **Retiro de los niños** | Sólo se acepta a un representante marcado como autorizado. Cualquier excepción exige confirmación explícita, queda **señalada** y se registra en auditoría con el nombre y la cédula de quien retiró. |
| **Auditoría** | Se registran inicios de sesión, fallos, bloqueos, cambios de contraseña, alta/baja de 2FA, y las acciones sobre niños, salas, registros de asistencia, actividades, justificaciones y reportes enviados. |
| **Cabeceras** | CSP estricta por cabecera y por `<meta>`, HSTS 180 días, `X-Content-Type-Options`, `frame-ancestors 'none'`, sin `x-powered-by`. |
| **Copias** | Respaldo nocturno + antes de cada actualización/restauración + manuales desde **Panel → Respaldos**: base de datos **y fotos** en un solo archivo con sha256, cifrado AES-256 opcional (`BACKUP_ENCRYPTION_KEY`) y retención configurable. Descargar, borrar o restaurar exige contraseña (y 2FA) y queda auditado. |
| **Despliegue** | Postgres en red interna sin salida a internet y nunca publicado; contenedores sin root, con sistema de archivos de sólo lectura y `no-new-privileges`; `.env.production` con permisos 600 y fuera de git. |

> La cámara del navegador requiere **HTTPS** (o `localhost`). En producción sirve el sitio por HTTPS y no publiques el archivo `.env`.
