import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, FileText, FileWarning, Paperclip, Plus, X } from '../components/icons'
import { api, apiError, mediaUrl, shortDate } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { FilterChips } from '../components/SmartTable'
import { DataToolbar, LoadMore } from '../components/DataToolbar'
import { useDataView } from '../components/dataView'
import ChildPicker from '../components/ChildPicker'
import { formatDocumentId } from '../components/childSearch'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
  Loading,
  PageHeader,
} from '../components/ui'

const JUSTIFICATION_TYPES = [
  { value: 'enfermedad', label: 'Enfermedad' },
  { value: 'cita_medica', label: 'Cita médica' },
  { value: 'viaje', label: 'Viaje' },
  { value: 'familiar', label: 'Motivo familiar' },
  { value: 'tardanza', label: 'Tardanza' },
  { value: 'otro', label: 'Otro' },
]

const typeLabel = (t) => JUSTIFICATION_TYPES.find((x) => x.value === t)?.label || 'Otro'

const STATUS = {
  pending: ['Pendiente', 'amber'],
  approved: ['Aprobada', 'green'],
  rejected: ['Rechazada', 'rose'],
}

const FILTERS = [
  ['pending', 'Por revisar'],
  ['approved', 'Aprobadas'],
  ['rejected', 'Rechazadas'],
  ['', 'Todas'],
]

const isImage = (url) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url || '')

/** Días naturales que cubre el aviso (inclusive). */
function daysBetween(from, to) {
  const a = new Date(`${String(from).slice(0, 10)}T00:00:00`)
  const b = new Date(`${String(to || from).slice(0, 10)}T00:00:00`)
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

function dateRange(j) {
  const days = daysBetween(j.dateFrom, j.dateTo)
  if (days === 1) return shortDate(j.dateFrom)
  return `${shortDate(j.dateFrom)} – ${shortDate(j.dateTo)} · ${days} días`
}

const PAGE = 20

const childNameOf = (j) => (j.child ? `${j.child.firstName} ${j.child.lastName}`.trim() : 'Niño')

/** Avisos de ausencia de los niños: los envía la familia o los registra el personal. */
export default function JustificationsPage() {
  const { pushToast } = useToasts()
  const { canManage } = useAuth()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('pending')
  const [creating, setCreating] = useState(false)
  const [deciding, setDeciding] = useState(null)
  const [preview, setPreview] = useState(null)
  const [children, setChildren] = useState([])
  const [limit, setLimit] = useState(PAGE)

  // Se cargan todas y se filtra aquí: así los contadores de cada estado están siempre al día.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/justifications')
      setItems(res.data || [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar las ausencias') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useLoadEffect(load)

  // Niños (incluye dados de baja): cédula y sala para buscar/filtrar, y lista del formulario.
  useEffect(() => {
    api
      .get('/children', { params: { includeInactive: 'true' } })
      .then((r) => setChildren(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
  }, [])
  const childById = useMemo(() => new Map(children.map((c) => [c.id, c])), [children])
  // En vivo (el spinner sólo sale sin datos: recargar no parpadea).
  useLiveReload(load, { entities: ['justification'] })

  const counts = useMemo(() => {
    const c = { '': items.length, pending: 0, approved: 0, rejected: 0 }
    for (const j of items) c[j.status] = (c[j.status] || 0) + 1
    return c
  }, [items])

  // Pendientes primero; dentro de cada grupo, lo más próximo/reciente arriba.
  const shown = useMemo(() => {
    const order = { pending: 0, approved: 1, rejected: 2 }
    return items
      .filter((j) => !status || j.status === status)
      .sort(
        (a, b) =>
          (order[a.status] ?? 3) - (order[b.status] ?? 3) ||
          String(b.dateFrom).localeCompare(String(a.dateFrom)),
      )
  }, [items, status])

  const filters = useMemo(
    () => [
      {
        key: 'room',
        label: 'Sala',
        multiple: true,
        value: (j) => childById.get(j.childId)?.classroomName,
        emptyLabel: 'Sin sala',
      },
      { key: 'type', label: 'Motivo', multiple: true, options: JUSTIFICATION_TYPES },
      { key: 'dates', label: 'Fechas', type: 'dateRange', value: (j) => [j.dateFrom, j.dateTo || j.dateFrom] },
    ],
    [childById],
  )
  const view = useDataView({
    rows: shown,
    searchKeys: [
      childNameOf,
      (j) => childById.get(j.childId)?.documentId,
      'reason',
      'createdByName',
    ],
    filters,
    storageKey: 'justifications',
  })
  const visible = view.filtered
  const sig = `${status}|${view.search}|${JSON.stringify(view.values)}`
  const [prevSig, setPrevSig] = useState(sig)
  if (sig !== prevSig) {
    setPrevSig(sig)
    setLimit(PAGE)
  }

  return (
    <>
      <PageHeader
        title="Ausencias y tardanzas"
        subtitle={
          loading
            ? 'Cargando…'
            : counts.pending
              ? `${counts.pending} aviso(s) por revisar`
              : 'Todo revisado'
        }
        icon={FileWarning}
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Registrar aviso
          </Button>
        }
      />

      <FilterChips value={status} onChange={setStatus} options={FILTERS} counts={counts} className="mb-2" />
      <DataToolbar view={view} searchPlaceholder="Buscar por niño, cédula o detalle…" className="mb-4" />

      {loading && items.length === 0 ? (
        <Card>
          <Loading />
        </Card>
      ) : visible.length === 0 && shown.length > 0 ? (
        <Card>
          <EmptyState
            icon={FileWarning}
            title="Nada coincide"
            message="Prueba con otra búsqueda o quita algún filtro."
            action={
              <Button variant="secondary" onClick={view.clearAll}>
                Limpiar búsqueda y filtros
              </Button>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={status === 'pending' ? Check : FileWarning}
            title={status === 'pending' ? 'Nada por revisar' : 'Sin avisos en esta vista'}
            message={
              status === 'pending'
                ? 'Cuando una familia avise de una ausencia aparecerá aquí.'
                : 'Si una familia avisó por teléfono, regístralo tú.'
            }
            action={
              <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
                Registrar aviso
              </Button>
            }
          />
        </Card>
      ) : (
        <>
        <ul className="space-y-3">
          {visible.slice(0, limit).map((j) => {
            const st = STATUS[j.status] || STATUS.pending
            const childName = childNameOf(j)
            const pending = j.status === 'pending'
            return (
              <li key={j.id}>
                <Card
                  className={pending ? 'border-l-4 border-l-amber-400! dark:border-l-amber-400/70!' : ''}
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <Avatar src={j.child?.photoUrl} name={childName} size="md" />
                    <div className="min-w-0 flex-1 basis-60">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {j.childId ? (
                          <Link
                            to={`/panel/ninos/${j.childId}`}
                            className="font-semibold text-slate-900 dark:text-white hover:text-accent-text hover:underline"
                          >
                            {childName}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-900 dark:text-white">{childName}</span>
                        )}
                        <Badge tone={st[1]}>{st[0]}</Badge>
                        <Badge tone="slate">{typeLabel(j.type)}</Badge>
                      </div>
                      {childById.get(j.childId)?.documentId && (
                        <p className="text-xs text-slate-400 dark:text-white/35 tabular-nums">
                          CI {formatDocumentId(childById.get(j.childId).documentId)}
                          {childById.get(j.childId).classroomName ? ` · ${childById.get(j.childId).classroomName}` : ''}
                        </p>
                      )}
                      <p className="text-sm font-semibold text-slate-700 dark:text-white/75 mt-0.5">{dateRange(j)}</p>
                      <p className="text-sm text-slate-600 dark:text-white/60 mt-1.5 whitespace-pre-wrap">{j.reason}</p>
                      <p className="text-xs text-slate-400 dark:text-white/35 mt-1">
                        {j.createdByName ? `Enviado por ${j.createdByName}` : 'Aviso registrado'}
                        {j.createdAt ? ` · ${shortDate(String(j.createdAt).slice(0, 10))}` : ''}
                      </p>
                      {j.adminNote && (
                        <p className="text-xs text-slate-600 dark:text-white/60 mt-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5">
                          <strong>Comentario:</strong> {j.adminNote}
                        </p>
                      )}
                    </div>

                    {j.attachmentUrl &&
                      (isImage(j.attachmentUrl) ? (
                        <button
                          type="button"
                          onClick={() => setPreview(j)}
                          className="group shrink-0 text-center"
                          aria-label={`Ver adjunto de ${childName}`}
                        >
                          <img
                            src={mediaUrl(j.attachmentUrl)}
                            alt=""
                            className="w-20 h-20 rounded-lg object-cover border border-slate-200 dark:border-white/10 group-hover:ring-2 ring-accent"
                          />
                          <span className="block text-[11px] font-medium text-accent-text mt-1">
                            Ver adjunto
                          </span>
                        </button>
                      ) : (
                        <a
                          href={mediaUrl(j.attachmentUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 inline-flex items-center gap-2 min-h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5"
                        >
                          <FileText className="w-4 h-4 text-slate-500 dark:text-white/60" /> Ver documento
                        </a>
                      ))}
                  </div>

                  {canManage && pending && (
                    <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
                      <Button
                        variant="success"
                        icon={Check}
                        className="flex-1 sm:flex-none min-h-11"
                        onClick={() => setDeciding({ item: j, decision: 'approved' })}
                      >
                        Aprobar
                      </Button>
                      <Button
                        variant="secondary"
                        icon={X}
                        className="flex-1 sm:flex-none min-h-11"
                        onClick={() => setDeciding({ item: j, decision: 'rejected' })}
                      >
                        Rechazar
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
        {visible.length > PAGE && (
          <LoadMore
            className="mt-2"
            shown={Math.min(limit, visible.length)}
            total={visible.length}
            step={PAGE}
            label="avisos"
            onMore={() => setLimit((l) => l + PAGE)}
            onAll={() => setLimit(visible.length)}
          />
        )}
        </>
      )}

      {creating && (
        <JustificationForm
          kids={children.filter((c) => c.active !== false)}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            load()
          }}
        />
      )}

      {deciding && (
        <DecideModal
          {...deciding}
          onClose={() => setDeciding(null)}
          onSaved={() => {
            setDeciding(null)
            load()
          }}
        />
      )}

      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          width="lg"
          title={`Adjunto de ${childNameOf(preview)}`}
          subtitle={`${typeLabel(preview.type)} · ${dateRange(preview)}`}
          footer={
            <a href={mediaUrl(preview.attachmentUrl)} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" icon={Paperclip}>
                Abrir en otra pestaña
              </Button>
            </a>
          }
        >
          <img src={mediaUrl(preview.attachmentUrl)} alt="Documento adjunto" className="w-full rounded-lg" />
        </Modal>
      )}
    </>
  )
}

function JustificationForm({ kids, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [form, setForm] = useState({
    childId: '',
    dateFrom: '',
    dateTo: '',
    type: 'enfermedad',
    reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.childId) {
      setError('Elige el niño.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.post('/justifications', { ...form, dateTo: form.dateTo || form.dateFrom })
      pushToast({ type: 'success', message: 'Aviso registrado' })
      onSaved()
    } catch (err) {
      setError(apiError(err, 'No se pudo registrar'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar aviso de ausencia"
      subtitle="Úsalo cuando la familia avisa por teléfono o en persona."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Registrar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Niño" required>
          <ChildPicker
            items={kids}
            multiple={false}
            value={form.childId}
            onChange={(id) => setForm((f) => ({ ...f, childId: id }))}
            compactThreshold={0}
            maxListHeight="min(32vh, 260px)"
            label="Niño del aviso"
          />
        </Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Desde" required>
            <input className={inputClass} type="date" value={form.dateFrom} onChange={set('dateFrom')} required />
          </Field>
          <Field label="Hasta" hint="Vacío = un solo día.">
            <input className={inputClass} type="date" value={form.dateTo} onChange={set('dateTo')} />
          </Field>
          <Field label="Motivo">
            <select className={inputClass} value={form.type} onChange={set('type')}>
              {JUSTIFICATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Detalle" required>
          <textarea className={inputClass} rows={3} value={form.reason} onChange={set('reason')} required />
        </Field>
        {error && (
          <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

function DecideModal({ item, decision, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [adminNote, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const approving = decision === 'approved'

  const submit = async () => {
    setSaving(true)
    try {
      await api.post(`/justifications/${item.id}/decide`, {
        decision,
        adminNote: adminNote || undefined,
      })
      pushToast({
        type: 'success',
        message: approving ? 'Ausencia aprobada' : 'Ausencia rechazada',
      })
      onSaved()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={approving ? '¿Aprobar esta ausencia?' : '¿Rechazar esta ausencia?'}
      subtitle={`${childNameOf(item)} · ${dateRange(item)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={approving ? 'success' : 'danger'} icon={approving ? Check : X} onClick={submit} loading={saving}>
            {approving ? 'Sí, aprobar' : 'Sí, rechazar'}
          </Button>
        </>
      }
    >
      <div className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2.5 mb-3">
        <p className="text-xs font-semibold text-slate-500 dark:text-white/45">{typeLabel(item.type)}</p>
        <p className="text-sm text-slate-700 dark:text-white/75 whitespace-pre-wrap">{item.reason}</p>
      </div>
      <p className="text-sm text-slate-600 dark:text-white/60 mb-3">
        {approving
          ? 'Esos días no contarán como falta injustificada en los informes.'
          : 'Esos días seguirán contando como falta.'}
      </p>
      <Field label="Comentario (opcional)" hint="Queda guardado en el registro del aviso.">
        <textarea className={inputClass} rows={2} value={adminNote} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}
