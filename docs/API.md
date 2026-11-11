# Sonrisas — Backend (API)

API NestJS del sistema de control y seguimiento infantil.

- NestJS 10 + TypeORM + PostgreSQL + JWT (2FA TOTP opcional)
- Envío del reporte diario por WhatsApp: proveedor conmutable (`manual` / `cloud`)
- Sirve también la SPA del frontend desde `public/` (despliegue de un solo origen)

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev:api` | API en modo watch (`http://localhost:3000/api`) |
| `npm run seed` | Crea la cuenta de dirección y las salas por defecto |
| `npm run build` | Compila a `dist/` |
| `npm run start:prod` | Ejecuta `dist/main.js` |
| `npm run build` | Compila frontend (`public/`) y backend (`dist/`) |

Configura `.env` (ver `.env.example`). El esquema de la base de datos se crea solo (TypeORM `synchronize`).

## Roles

`admin` (dirección) · `coordinator` (coordinación) · `teacher` (educadora) · `guardian` (representante).

Los guards viven en `src/auth/roles.guard.ts`: `AdminGuard`, `CoordinatorGuard`, `StaffGuard` y `GuardianGuard`.

## Endpoints principales

### Autenticación

- `POST /api/auth/login` · `POST /api/auth/2fa/login` · `GET /api/auth/me`
- `POST /api/auth/change-password` · endpoints de 2FA

### Guardería

- `GET/POST/PATCH/DELETE /api/classrooms` — salas
- `GET/POST/PATCH/DELETE /api/children` — fichas de los niños
- `GET/POST/PATCH/DELETE /api/children/:id/guardians` — representantes de un niño
- `GET /api/attendance/board?date=&classroomId=` — tablero del día (todos los niños con su estado)
- `POST /api/attendance/children/:childId/in` · `/out` — llegada y retiro
- `POST /api/meals` · `POST /api/meals/bulk` · `GET /api/meals/summary` — alimentación
- `POST /api/daily-logs` · `POST /api/daily-logs/bulk` — siestas, higiene, salud, incidentes
- `GET/POST/PATCH /api/activities` · `PATCH /api/activities/:id/participants` — actividades y participación
- `GET/POST/PATCH/DELETE /api/photos` — galería

### Reportes y WhatsApp

- `GET /api/reports/preview/:childId?date=` — vista previa sin guardar
- `POST /api/reports/generate` — genera el reporte de un niño o de toda una sala
- `POST /api/reports/daily/:id/send` · `POST /api/reports/send-day` — envío
- `GET /api/reports/attendance?from=&to=` · `/attendance-trend` · `/overview` — informes generales
- `GET /api/whatsapp/provider` · `GET /api/whatsapp/messages` · `POST /api/whatsapp/send`

### Portal familiar

Rol `guardian`. El alcance lo decide siempre el usuario autenticado, nunca un parámetro de la petición.

- `GET /api/family/children` · `/today` · `/gallery`
- `GET /api/family/children/:childId/day` · `/attendance` · `/history` · `/reports`
- `GET/POST /api/family/justifications`

### Equipo y configuración

- `GET/POST/PATCH/DELETE /api/staff` — cuentas del personal
- `POST /api/attendance/staff/mark` · `GET /api/attendance/staff/me` — marcaje propio
- `GET/POST/PATCH/DELETE /api/tasks` — pendientes del equipo
- `GET/POST /api/justifications` · `POST /api/justifications/:id/decide` — ausencias
- `GET /api/schedule` (cualquier usuario) · `PATCH /api/schedule` (sólo dirección)
- `GET /api/audit` · `GET /api/summary/badges` · `/api/branding` · `/api/push`

Consulta el `README.md` y el `DEPLOY.md` de la raíz del proyecto para la guía completa.
