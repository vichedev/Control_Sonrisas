import { MessageSquare, RefreshCw } from '../icons'
import { Badge, Button, Card, EmptyState, Loading, SectionTitle } from '../ui'

const STATUS = {
  sent: { label: 'Enviado', tone: 'green' },
  queued: { label: 'En cola', tone: 'sky' },
  manual_pending: { label: 'Manual pendiente', tone: 'amber' },
  failed: { label: 'Fallido', tone: 'red' },
}

const SOURCE = {
  report: 'Reporte del día',
  arrival: 'Llegada',
  pickup: 'Retiro',
  health: 'Salud / incidente',
  justification_approved: 'Justificación',
  justification_rejected: 'Justificación',
  test: 'Prueba',
  direct: 'Mensaje directo',
  access: 'Datos de acceso',
}

const PROVIDER = { linked: 'WhatsApp del centro', manual: 'Enlace wa.me', cloud: 'Cloud API' }

const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

/** Bitácora de los últimos mensajes de WhatsApp. */
export default function MessageLog({ messages, loading, onRefresh }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <SectionTitle hint="Últimos 50">Mensajes recientes</SectionTitle>
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={onRefresh} loading={loading}>
          Actualizar
        </Button>
      </div>
      {loading && !messages.length ? (
        <Loading />
      ) : !messages.length ? (
        <EmptyState icon={MessageSquare} title="Aún no hay mensajes" message="Aquí verás cada reporte y aviso enviado por WhatsApp." />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {messages.map((m) => {
            const st = STATUS[m.status] || { label: m.status, tone: 'slate' }
            return (
              <li key={m.id} className="px-5 py-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                      {m.toName || `+${m.toPhone}`}
                    </span>
                    {m.toName && <span className="text-xs text-slate-400 dark:text-white/40">+{m.toPhone}</span>}
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {m.source && SOURCE[m.source] && <Badge tone="slate">{SOURCE[m.source]}</Badge>}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-white/60 mt-1 line-clamp-2 whitespace-pre-line">{m.body}</p>
                  {m.status === 'failed' && m.errorMessage && (
                    <p className="text-xs text-red-600 dark:text-red-300 mt-1">{m.errorMessage}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-500 dark:text-white/50 tabular-nums">{fmt(m.createdAt)}</p>
                  <p className="text-[11px] text-slate-400 dark:text-white/30">{PROVIDER[m.provider] || m.provider}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
