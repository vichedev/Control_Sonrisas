import {
  ArrowsClockwise,
  Baby,
  Database,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  FileWarning,
  Gear,
  Images,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  MessageCircle,
  MessageCircleHeart,
  NotebookPen,
  Palette,
  Palmtree,
  Shield,
  ShieldCheck,
  Signature,
  UserCog,
  User as UserIcon,
  UserRound,
  Users,
  UtensilsCrossed,
} from './icons'

/**
 * Menú del panel (barra lateral, barra inferior y buscador Ctrl+K).
 * `manage: true` lo ve sólo dirección y coordinación; `adminOnly: true` sólo dirección.
 * `badge` es una clave de /summary/badges. `hidden: true` no sale en la barra lateral
 * (ya está en el menú de usuario) pero sí en el buscador. `keywords` ayuda al buscador.
 */
export const HOME = {
  to: '/panel',
  label: 'Resumen',
  icon: LayoutDashboard,
  end: true,
  keywords: 'inicio portada hoy',
}

export const SECTIONS = [
  {
    title: 'El día de hoy',
    items: [
      { to: '/panel/seguimiento', label: 'Seguimiento del día', short: 'Seguimiento', icon: ListChecks, keywords: 'checklist falta pendiente' },
      { to: '/panel/dia', label: 'Entradas y salidas', short: 'Entradas', icon: ClipboardList, badge: 'flaggedToday', keywords: 'llegada salida asistencia retiro' },
      { to: '/panel/comidas', label: 'Alimentación', short: 'Comidas', icon: UtensilsCrossed, keywords: 'comida almuerzo desayuno biberon' },
      { to: '/panel/bitacora', label: 'Bitácora', short: 'Bitácora', icon: NotebookPen, badge: 'pendingNotices', keywords: 'siesta pañal incidente salud' },
      { to: '/panel/actividades', label: 'Actividades', icon: Palmtree, keywords: 'juego pintura' },
      { to: '/panel/reportes', label: 'Reportes a familias', short: 'Reportes', icon: MessageCircleHeart, badge: 'pendingReports', keywords: 'whatsapp enviar' },
    ],
  },
  {
    title: 'Niños y familias',
    items: [
      { to: '/panel/ninos', label: 'Niños', icon: Baby, keywords: 'fichas alumnos' },
      { to: '/panel/representantes', label: 'Representantes', icon: UserRound, manage: true, keywords: 'padres madres familias' },
      { to: '/panel/consentimientos', label: 'Consentimientos', icon: Signature, manage: true, keywords: 'privacidad lopdp fotos imagen autorizacion datos' },
      { to: '/panel/justificaciones', label: 'Ausencias', icon: FileWarning, badge: 'pendingJustifications', keywords: 'justificaciones faltas' },
      { to: '/panel/galeria', label: 'Galería de fotos', icon: Images, keywords: 'fotos' },
    ],
  },
  {
    title: 'Centro',
    items: [
      { to: '/panel/salas', label: 'Salas', icon: Users, keywords: 'aulas grupos' },
      { to: '/panel/informes', label: 'Informes', icon: CalendarDays, keywords: 'estadisticas reportes generales' },
      { to: '/panel/personal', label: 'Personal', icon: UserCog, manage: true, keywords: 'equipo educadoras' },
    ],
  },
  {
    title: 'Mi trabajo',
    items: [
      { to: '/panel/pendientes', label: 'Pendientes', icon: ListTodo, badge: 'pendingTasks', keywords: 'tareas' },
      { to: '/panel/mi-asistencia', label: 'Mi asistencia', icon: CalendarClock, keywords: 'marcacion horario' },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { to: '/panel/ajustes', label: 'Ajustes', icon: Gear, keywords: 'configuracion horario marca logo auditoria respaldos actualizaciones whatsapp cuenta seguridad' },
    ],
  },
]

/**
 * Sección "Ajustes": todo lo de configuración en un solo lugar.
 * Mismas reglas de rol que el menú (`adminOnly`, `manage`). El buscador Ctrl+K los encuentra
 * también (ver `allPagesFor`).
 */
export const SETTINGS = [
  {
    title: 'Centro',
    items: [
      { to: '/panel/ajustes/horario', label: 'Horario del centro', icon: CalendarClock, adminOnly: true, keywords: 'feriados cierre dias apertura' },
      { to: '/panel/ajustes/marca', label: 'Marca y logo', icon: Palette, adminOnly: true, keywords: 'colores logo nombre' },
      { to: '/panel/ajustes/whatsapp', label: 'WhatsApp del centro', icon: MessageCircle, manage: true, keywords: 'whatsapp qr vincular avisos' },
    ],
  },
  {
    title: 'Privacidad',
    items: [
      { to: '/panel/consentimientos?tab=textos', label: 'Textos de consentimiento', icon: Signature, adminOnly: true, external: true, keywords: 'lopdp politica privacidad fotos' },
    ],
  },
  {
    title: 'Datos y sistema',
    items: [
      { to: '/panel/ajustes/respaldos', label: 'Respaldos', icon: Database, adminOnly: true, keywords: 'backup copia seguridad restaurar descargar' },
      { to: '/panel/ajustes/actualizaciones', label: 'Actualizaciones', icon: ArrowsClockwise, adminOnly: true, keywords: 'version actualizar rollback volver anterior' },
      { to: '/panel/ajustes/auditoria', label: 'Auditoría', icon: ShieldCheck, adminOnly: true, keywords: 'historial cambios registro' },
    ],
  },
  {
    title: 'Mi cuenta',
    items: [
      { to: '/panel/ajustes/cuenta', label: 'Mi cuenta', icon: UserIcon, keywords: 'perfil foto contraseña' },
      { to: '/panel/ajustes/seguridad', label: 'Seguridad / 2FA', icon: Shield, keywords: 'contraseña doble factor' },
    ],
  },
]

/** Grupos de Ajustes con sólo los ítems que puede ver el rol. */
export function settingsFor({ isAdmin, canManage }) {
  return SETTINGS.map((g) => ({
    ...g,
    items: g.items.filter((it) => (!it.adminOnly || isAdmin) && (!it.manage || canManage)),
  })).filter((g) => g.items.length)
}

/** Evento global que abre el buscador: window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)). */
export const OPEN_SEARCH_EVENT = 'sonrisas:open-search'

/** Atajos de la barra inferior en móvil (el 5.º botón es "Más", que abre el menú). */
export const BOTTOM_NAV = ['/panel/seguimiento', '/panel/dia', '/panel/comidas', '/panel/bitacora']

/** Secciones con sólo los ítems que puede ver el rol. */
export function sectionsFor({ isAdmin, canManage }) {
  return SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((it) => (!it.adminOnly || isAdmin) && (!it.manage || canManage)),
  })).filter((s) => s.items.length)
}

/** Lista plana (incluye Resumen y los ocultos) para el buscador. */
export function allPagesFor(auth) {
  return [
    HOME,
    ...sectionsFor(auth).flatMap((s) => s.items.map((it) => ({ ...it, section: s.title }))),
    ...settingsFor(auth).flatMap((g) => g.items.map((it) => ({ ...it, section: `Ajustes · ${g.title}` }))),
  ]
}

/** Ítem del menú que corresponde a una ruta (para el título en móvil). */
export function pageForPath(pathname) {
  const all = [HOME, ...SECTIONS.flatMap((s) => s.items), ...SETTINGS.flatMap((g) => g.items)]
  return (
    all.find((it) => it.to === pathname) ||
    all
      .filter((it) => it.to !== '/panel' && pathname.startsWith(it.to + '/'))
      .sort((a, b) => b.to.length - a.to.length)[0] ||
    null
  )
}

/** Minúsculas y sin tildes, para buscar "maria" y encontrar "María". */
export function normalize(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}
