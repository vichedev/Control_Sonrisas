import { useCallback, useMemo, useState } from 'react'
import {
  Baby,
  Briefcase,
  CalendarClock,
  ClipboardList,
  Database,
  FileText,
  FileWarning,
  Image,
  KeyRound,
  RefreshCw,
  Buildings as School,
  ShieldCheck,
  User as UserIcon,
  Users,
} from '../components/icons'
import { api } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import SmartTable from '../components/SmartTable'
import { Button, Card, PageHeader, StatTile, inputClass } from '../components/ui'

const ENTITY_META = {
  attendance:       { label: 'Marcaje',             Icon: CalendarClock, tone: 'cyan' },
  child_attendance: { label: 'Asistencia de niño',  Icon: CalendarClock, tone: 'cyan' },
  staff_attendance: { label: 'Marcaje del personal', Icon: CalendarClock, tone: 'cyan' },
  activity:         { label: 'Actividad',           Icon: Briefcase,     tone: 'indigo' },
  child:            { label: 'Niño',                Icon: Baby,          tone: 'indigo' },
  guardian:         { label: 'Representante',       Icon: Users,         tone: 'violet' },
  staff:            { label: 'Personal',            Icon: UserIcon,      tone: 'violet' },
  user:             { label: 'Trabajador',          Icon: UserIcon,      tone: 'violet' },
  classroom:        { label: 'Sala',                Icon: School,        tone: 'slate' },
  justification:    { label: 'Justificación',       Icon: FileWarning,   tone: 'amber' },
  consent:          { label: 'Consentimiento',      Icon: FileText,      tone: 'amber' },
  consent_policy:   { label: 'Política de consentimiento', Icon: FileText, tone: 'amber' },
  daily_report:     { label: 'Reporte diario',      Icon: FileText,      tone: 'slate' },
  photo:            { label: 'Foto',                Icon: Image,         tone: 'slate' },
  backup:           { label: 'Respaldo',            Icon: Database,      tone: 'slate' },
  system:           { label: 'Sistema',             Icon: Database,      tone: 'slate' },
  auth:             { label: 'Acceso',              Icon: KeyRound,      tone: 'slate' },
  work_schedule:    { label: 'Jornada',             Icon: ClipboardList, tone: 'slate' },
}
const ACTION_LABEL = {
  update: 'Modificó',
  delete: 'Eliminó',
  create: 'Creó',
  security: 'Seguridad',
  login: 'Inicio de sesión',
  login_failed: 'Acceso fallido',
  login_blocked: 'Acceso bloqueado',
}

// Filtros en el navegador sobre los eventos cargados (máx. 500 del rango).
const AUDIT_FILTERS = [
  {
    key: 'action',
    label: 'Acción',
    multiple: true,
    value: (r) => r.action,
    optionLabel: (v) => ACTION_LABEL[v] || v,
  },
  {
    key: 'entity',
    label: 'Sobre',
    multiple: true,
    value: (r) => r.entity,
    optionLabel: (v) => ENTITY_META[v]?.label || v,
  },
  {
    key: 'actor',
    label: 'Quién',
    multiple: true,
    value: (r) => r.actorName || r.actorEmail || '',
    emptyLabel: 'Sistema',
  },
]
const ACTION_TONE = {
  update: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20',
  delete: 'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20',
  create: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
}
const TONE_DOT = {
  cyan: 'bg-sky-500', indigo: 'bg-accent', violet: 'bg-slate-400',
  amber: 'bg-amber-500', slate: 'bg-slate-500',
}

function pad2(n) { return String(n).padStart(2, '0') }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function fmtDateTime(d) {
  return new Date(d).toLocaleString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AuditPage() {
  const [filters, setFilters] = useState({ from: daysAgoStr(30), to: todayStr(), entity: '', actorId: '' })
  const [rows, setRows] = useState(null)

  // Filtros "aplicados": la consulta se lanza al montar y al pulsar Filtrar, no a cada tecla.
  const [applied, setApplied] = useState(filters)
  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (applied.from) p.set('from', applied.from)
    if (applied.to) p.set('to', applied.to)
    if (applied.entity) p.set('entity', applied.entity)
    if (applied.actorId) p.set('actorId', applied.actorId)
    p.set('limit', '500')
    return api.get(`/audit?${p.toString()}`).then((r) => setRows(r.data)).catch(() => setRows([]))
  }, [applied])
  useLoadEffect(load)

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const stats = useMemo(() => {
    if (!rows) return null
    return {
      total: rows.length,
      updates: rows.filter((r) => r.action === 'update').length,
      deletes: rows.filter((r) => r.action === 'delete').length,
      uniqueActors: new Set(rows.map((r) => r.actorId).filter(Boolean)).size,
    }
  }, [rows])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Auditoría"
        subtitle="Toda corrección o eliminación administrativa queda registrada aquí."
      />

      <Card className="p-4! flex flex-wrap items-end gap-3">
        <Field label="Desde"><input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className={inputCls} /></Field>
        <Field label="Hasta"><input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className={inputCls} /></Field>
        <Field label="Entidad">
          <select value={filters.entity} onChange={(e) => set('entity', e.target.value)} className={inputCls}>
            <option value="">Todas</option>
            {Object.entries(ENTITY_META)
              .filter(([k]) => k !== 'attendance' && k !== 'user' && k !== 'work_schedule')
              .map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
          </select>
        </Field>
        <Button icon={RefreshCw} onClick={() => setApplied({ ...filters })}>
          Aplicar
        </Button>
      </Card>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Eventos" value={stats.total} icon={ClipboardList} />
          <StatTile label="Correcciones" value={stats.updates} tone="amber" icon={RefreshCw} />
          <StatTile label="Eliminaciones" value={stats.deletes} tone="red" icon={FileWarning} />
          <StatTile label="Administradores" value={stats.uniqueActors} tone="accent" icon={UserIcon} />
        </div>
      )}

      <SmartTable
        rows={rows || []}
        loading={rows === null}
        rowKey="id"
        searchKeys={['summary', 'actorName', 'actorEmail', 'ip', (r) => ENTITY_META[r.entity]?.label, (r) => ACTION_LABEL[r.action]]}
        searchPlaceholder="Buscar por descripción, persona o IP…"
        filters={AUDIT_FILTERS}
        storageKey="audit"
        itemLabel={['evento', 'eventos']}
        emptyMessage="Sin eventos en este rango."
        emptyAfterSearch="Sin eventos que coincidan con la búsqueda o los filtros."
        initialPageSize={25}
        renderExpanded={(r) => <AuditDetail row={r} />}
        columns={[
          {
            key: 'action',
            label: 'Acción',
            render: (r) => (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium leading-4 ring-1 ring-inset ${ACTION_TONE[r.action] || ACTION_TONE.update}`}>{ACTION_LABEL[r.action] || r.action}</span>
                {(() => {
                  const meta = ENTITY_META[r.entity] || { label: r.entity, tone: 'slate' }
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-white/60">
                      <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[meta.tone]}`} />{meta.label}
                    </span>
                  )
                })()}
              </div>
            ),
          },
          {
            key: 'summary',
            label: 'Descripción',
            primary: true,
            render: (r) => {
              const meta = ENTITY_META[r.entity] || { label: r.entity, Icon: ClipboardList, tone: 'slate' }
              const Icon = meta.Icon
              return (
                <div className="min-w-0">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/60 flex items-center justify-center shrink-0 md:hidden">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900 dark:text-white font-medium break-words">{r.summary}</p>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
                        Por <span className="font-semibold">{r.actorName || r.actorEmail || 'admin'}</span>
                        {r.ip && <> · IP {r.ip}</>}
                      </p>
                    </div>
                  </div>
                </div>
              )
            },
          },
          {
            key: 'when',
            label: 'Fecha',
            mobileLabel: 'Cuándo',
            render: (r) => <span className="whitespace-nowrap tabular-nums text-xs text-slate-600 dark:text-white/70">{fmtDateTime(r.createdAt)}</span>,
          },
        ]}
      />
    </div>
  )
}

/** Antes / después del evento (fila desplegable). */
function AuditDetail({ row: r }) {
  if (!r.before && !r.after) {
    return <p className="text-xs text-slate-500 dark:text-white/50">Sin detalle adicional{r.ip ? ` · IP ${r.ip}` : ''}.</p>
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {r.before && (
        <div className="rounded-lg bg-white dark:bg-white/4 border border-slate-200 dark:border-white/10 px-3 py-2 text-xs">
          <p className="font-medium text-red-700 dark:text-red-300 mb-1">Antes</p>
          <pre className="whitespace-pre-wrap wrap-break-word text-slate-700 dark:text-white/80 font-mono text-[11px]">{JSON.stringify(r.before, null, 2)}</pre>
        </div>
      )}
      {r.after && (
        <div className="rounded-lg bg-white dark:bg-white/4 border border-slate-200 dark:border-white/10 px-3 py-2 text-xs">
          <p className="font-medium text-emerald-700 dark:text-emerald-300 mb-1">Después</p>
          <pre className="whitespace-pre-wrap wrap-break-word text-slate-700 dark:text-white/80 font-mono text-[11px]">{JSON.stringify(r.after, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

const inputCls = inputClass.replace('w-full ', '')
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
