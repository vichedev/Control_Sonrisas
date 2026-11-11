# Sonrisas — Frontend (SPA)

Aplicación React del sistema de control y seguimiento infantil.

- Vite + React 19 + React Router 6 + TailwindCSS v4
- Cámara: `getUserMedia` (requiere HTTPS o `localhost`)

## Rutas

### Público

- `/` — redirige según la sesión (personal → `/panel`, representante → `/familia`); sin sesión muestra el login
- `/login` · `/cambiar-clave`

### Panel del personal (`/panel/*`)

| Ruta | Pantalla |
|---|---|
| `/panel` | Resumen del día |
| `/panel/dia` | Entradas y salidas (la pantalla operativa principal) |
| `/panel/comidas` | Alimentación por sala |
| `/panel/actividades` | Actividades con fotos y participación individual |
| `/panel/bitacora` | Siestas, higiene, salud, incidentes y observaciones |
| `/panel/reportes` | Generar, editar y enviar los reportes por WhatsApp |
| `/panel/ninos` · `/panel/ninos/:id` | Fichas, representantes e historial |
| `/panel/salas` · `/panel/galeria` · `/panel/justificaciones` · `/panel/informes` | Guardería |
| `/panel/mi-asistencia` · `/panel/pendientes` · `/panel/personal` | Equipo |
| `/panel/horario` · `/panel/marca` · `/panel/cuenta` · `/panel/seguridad` · `/panel/auditoria` | Configuración |

### Portal familiar (`/familia/*`)

| Ruta | Pantalla |
|---|---|
| `/familia` | Cómo va hoy cada uno de sus niños |
| `/familia/nino/:childId` | El día completo, el reporte enviado y el historial |
| `/familia/galeria` | Fotos compartidas por la guardería |
| `/familia/avisos` | Avisar una ausencia y ver el estado de los avisos |

## Scripts

El frontend vive en `client/` y se maneja desde la raíz del proyecto (ver el README principal):

| Comando | Qué hace |
|---|---|
| `npm run dev:web` | Sólo el frontend (`http://localhost:5173`) |
| `npm run build:web` | Compila a `public/`, que NestJS sirve en producción |
| `npm run lint` | ESLint |

La API se llama siempre por `/api` (mismo origen). En desarrollo, Vite hace de proxy a `/api` y `/uploads` para que el navegador hable siempre con el mismo origen (la CSP usa `connect-src 'self'`).
