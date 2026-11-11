import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CirclePlay, ListTodo, Plus, RotateCcw, Trash2 } from '../components/icons'
import { api, apiError, shortDate, timeOf } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { FilterChips, RowMenu } from '../components/SmartTable'
import { DataToolbar, LoadMore } from '../components/DataToolbar'
import { useDataView } from '../components/dataView'
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

const PRIORITIES = {
  low: ['Baja', 'slate'],
  normal: ['Normal', 'sky'],
  high: ['Alta', 'amber'],
  urgent: ['Urgente', 'rose'],
}
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 }

const STATUSES = {
  pending: ['Pendiente', 'slate'],
  in_progress: ['En curso', 'sky'],
  completed: ['Hecho', 'green'],
  cancelled: ['Cancelado', 'slate'],
}

const FILTERS = [
  ['mine', 'Míos'],
  ['open', 'Abiertos'],
  ['done', 'Hechos'],
  ['all', 'Todos'],
]

const PAGE = 30

const isOpen = (t) => t.status === 'pending' || t.status === 'in_progress'

/** Vence hoy / vencido / fecha: siempre en palabras. */
function dueInfo(t) {
  if (!t.dueAt) return null
  const due = new Date(t.dueAt)
  const now = new Date()
  const sameDay = due.toDateString() === now.toDateString()
  if (isOpen(t) && due < now) return ['Vencido', 'rose', `${shortDate(t.dueAt)} ${timeOf(t.dueAt)}`]
  if (sameDay) return ['Vence hoy', 'amber', timeOf(t.dueAt)]
  return [null, null, `Vence ${shortDate(t.dueAt)}`]
}

/** Pendientes del equipo: preparar material, llamar a una familia, reponer insumos. */
export default function TasksPage() {
  const { pushToast } = useToasts()
  const { canManage, user } = useAuth()

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(() => (canManage ? 'open' : 'mine'))
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const firstLoad = useRef(true)
  const [limit, setLimit] = useState(PAGE)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/tasks')
      const list = res.data || []
      setTasks(list)
      // La primera vez, si "Míos" está vacío se muestran los abiertos para no ver una pantalla en blanco.
      if (firstLoad.current) {
        firstLoad.current = false
        if (!list.some((t) => t.assigneeId === user?.id && isOpen(t)) && list.some(isOpen)) setFilter('open')
      }
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar los pendientes') })
    } finally {
      setLoading(false)
    }
  }, [pushToast, user?.id])

  useLoadEffect(load)
  // En vivo (el spinner sólo sale sin datos: recargar no parpadea).
  useLiveReload(load, { entities: ['task'] })

  /** Cambio optimista de estado: se ve al instante y se revierte si falla. */
  const advance = async (task, status) => {
    const prev = tasks
    setBusy(task.id)
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status } : t)))
    try {
      await api.patch(`/tasks/${task.id}`, { status })
      pushToast({
        type: 'success',
        message:
          status === 'completed' ? `Hecho: ${task.title}` : status === 'in_progress' ? 'Marcado en curso' : 'Pendiente reabierto',
      })
    } catch (err) {
      setTasks(prev)
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    try {
      await api.delete(`/tasks/${toDelete.id}`)
      pushToast({ type: 'success', message: 'Pendiente eliminado' })
      setToDelete(null)
      load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    }
  }

  const counts = useMemo(
    () => ({
      mine: tasks.filter((t) => t.assigneeId === user?.id && isOpen(t)).length,
      open: tasks.filter(isOpen).length,
      done: tasks.filter((t) => t.status === 'completed').length,
      all: tasks.length,
    }),
    [tasks, user?.id],
  )

  const shown = useMemo(() => {
    const list = tasks.filter((t) => {
      if (filter === 'open') return isOpen(t)
      if (filter === 'mine') return t.assigneeId === user?.id && isOpen(t)
      if (filter === 'done') return t.status === 'completed'
      return true
    })
    // Abiertos primero; luego vencidos, prioridad y fecha.
    return list.sort((a, b) => {
      const oa = isOpen(a) ? 0 : 1
      const ob = isOpen(b) ? 0 : 1
      if (oa !== ob) return oa - ob
      const pa = PRIORITY_ORDER[a.priority] ?? 2
      const pb = PRIORITY_ORDER[b.priority] ?? 2
      if (pa !== pb) return pa - pb
      return String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'))
    })
  }, [tasks, filter, user?.id])

  // Búsqueda + filtros extra (responsable, prioridad, vencimiento) sobre la vista elegida.
  const filters = useMemo(() => {
    const names = Object.fromEntries(tasks.map((t) => [t.assigneeId, t.assignee?.name]))
    return [
      {
        key: 'assignee',
        label: 'Responsable',
        multiple: true,
        value: (t) => t.assigneeId,
        optionLabel: (id) => (id === user?.id ? `${names[id] || 'Yo'} (tú)` : names[id] || 'Sin nombre'),
        emptyLabel: 'Sin responsable',
      },
      {
        key: 'priority',
        label: 'Prioridad',
        multiple: true,
        options: Object.entries(PRIORITIES).map(([value, [label]]) => ({ value, label })),
      },
      {
        key: 'due',
        label: 'Vencimiento',
        value: (t) => {
          const d = dueInfo(t)?.[0]
          return d === 'Vencido' ? 'overdue' : d === 'Vence hoy' ? 'today' : t.dueAt ? 'later' : 'none'
        },
        options: [
          { value: 'overdue', label: 'Vencidos' },
          { value: 'today', label: 'Vencen hoy' },
          { value: 'later', label: 'Más adelante' },
          { value: 'none', label: 'Sin fecha' },
        ],
      },
    ]
  }, [tasks, user?.id])
  const view = useDataView({
    rows: shown,
    searchKeys: ['title', 'description', (t) => t.assignee?.name],
    filters,
    storageKey: 'tasks',
  })
  const visible = view.filtered
  // Nueva vista/búsqueda → volver a los primeros PAGE (ajuste durante el render).
  const sig = `${filter}|${view.search}|${JSON.stringify(view.values)}`
  const [prevSig, setPrevSig] = useState(sig)
  if (sig !== prevSig) {
    setPrevSig(sig)
    setLimit(PAGE)
  }

  return (
    <>
      <PageHeader
        title="Pendientes"
        subtitle={counts.mine ? `Tienes ${counts.mine} por hacer` : 'Nada asignado a ti por ahora'}
        icon={ListTodo}
        actions={
          canManage && (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Nuevo pendiente
            </Button>
          )
        }
      />

      <FilterChips value={filter} onChange={setFilter} options={FILTERS} counts={counts} className="mb-2" />
      <DataToolbar view={view} searchPlaceholder="Buscar pendiente o responsable…" className="mb-4" />

      {loading && tasks.length === 0 ? (
        <Card>
          <Loading />
        </Card>
      ) : visible.length === 0 && shown.length > 0 ? (
        <Card>
          <EmptyState
            icon={ListTodo}
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
            icon={Check}
            title={filter === 'done' ? 'Todavía nada hecho' : 'Nada pendiente'}
            message={filter === 'done' ? undefined : 'Buen momento para tomarse un café.'}
            action={
              canManage && (
                <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
                  Nuevo pendiente
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {visible.slice(0, limit).map((t) => {
              const prio = PRIORITIES[t.priority] || PRIORITIES.normal
              const status = STATUSES[t.status] || STATUSES.pending
              const completed = t.status === 'completed'
              const due = dueInfo(t)
              return (
                <li key={t.id} className={`p-3 sm:p-4 flex items-start gap-3 ${completed ? 'bg-slate-50/60 dark:bg-white/2' : ''}`}>
                  {/* Completar con un toque: casilla grande a la izquierda */}
                  <button
                    type="button"
                    onClick={() => advance(t, completed ? 'pending' : 'completed')}
                    disabled={busy === t.id || t.status === 'cancelled'}
                    aria-label={completed ? `Reabrir: ${t.title}` : `Marcar como hecho: ${t.title}`}
                    className="group shrink-0 flex flex-col items-center gap-0.5 disabled:opacity-50"
                  >
                    <span
                      className={`w-11 h-11 rounded-full border-2 inline-flex items-center justify-center transition ${
                        completed
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-slate-300 dark:border-white/25 text-transparent group-hover:border-emerald-400 group-hover:text-emerald-400 group-active:bg-emerald-50'
                      }`}
                    >
                      <Check className="w-5 h-5" />
                    </span>
                    <span className={`text-[10px] font-semibold ${completed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-white/40'}`}>
                      {completed ? 'Hecho' : 'Marcar'}
                    </span>
                  </button>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-semibold text-sm sm:text-base ${
                        completed ? 'text-slate-400 dark:text-white/35 line-through' : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {t.title}
                    </p>
                    {t.description && (
                      <p className="text-sm text-slate-600 dark:text-white/55 line-clamp-2">{t.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {completed ? (
                        <Badge tone="green">Hecho</Badge>
                      ) : (
                        <>
                          {t.status !== 'pending' && <Badge tone={status[1]}>{status[0]}</Badge>}
                          {t.priority !== 'normal' && <Badge tone={prio[1]}>Prioridad {prio[0].toLowerCase()}</Badge>}
                          {due?.[0] && <Badge tone={due[1]}>{due[0]}</Badge>}
                        </>
                      )}
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/45">
                        <Avatar src={t.assignee?.photoUrl} name={t.assignee?.name || '?'} size="xs" />
                        {t.assigneeId === user?.id ? 'Tú' : t.assignee?.name || 'Sin responsable'}
                        {due?.[2] && ` · ${due[2]}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {t.status === 'pending' && (
                      <span className="hidden sm:inline-flex">
                        <Button size="sm" variant="ghost" icon={CirclePlay} onClick={() => advance(t, 'in_progress')}>
                          Empezar
                        </Button>
                      </span>
                    )}
                    <RowMenu
                      label={`Acciones para ${t.title}`}
                      items={[
                        { label: 'Empezar', icon: CirclePlay, onClick: () => advance(t, 'in_progress'), hidden: t.status !== 'pending' },
                        { label: 'Reabrir', icon: RotateCcw, onClick: () => advance(t, 'pending'), hidden: t.status !== 'completed' },
                        { label: 'Eliminar', icon: Trash2, danger: true, onClick: () => setToDelete(t), hidden: !canManage },
                      ]}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          {visible.length > PAGE && (
            <LoadMore
              className="border-t border-slate-100 dark:border-white/5"
              shown={Math.min(limit, visible.length)}
              total={visible.length}
              step={PAGE}
              label="pendientes"
              onMore={() => setLimit((l) => l + PAGE)}
              onAll={() => setLimit(visible.length)}
            />
          )}
        </Card>
      )}

      {creating && (
        <TaskForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            load()
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        variant="danger"
        title="¿Eliminar este pendiente?"
        message={toDelete?.title}
        confirmText="Eliminar"
        onConfirm={remove}
      />
    </>
  )
}

function TaskForm({ onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [staff, setStaff] = useState([])
  const [form, setForm] = useState({
    assigneeId: '',
    title: '',
    description: '',
    priority: 'normal',
    dueAt: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/staff', { params: { includeInactive: 'false' } })
      .then((r) => {
        setStaff(r.data || [])
        if (r.data?.[0]) setForm((f) => ({ ...f, assigneeId: r.data[0].id }))
      })
      .catch(() => {})
  }, [])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post('/tasks', {
        ...form,
        description: form.description || undefined,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
      })
      pushToast({ type: 'success', message: 'Pendiente creado' })
      onSaved()
    } catch (err) {
      setError(apiError(err, 'No se pudo crear'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo pendiente"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Crear
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Título" required>
          <input className={inputClass} value={form.title} onChange={set('title')} required placeholder="Preparar material de plástica" />
        </Field>
        <Field label="Detalle">
          <textarea className={inputClass} rows={2} value={form.description} onChange={set('description')} />
        </Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Responsable" required>
            <select className={inputClass} value={form.assigneeId} onChange={set('assigneeId')} required>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prioridad">
            <select className={inputClass} value={form.priority} onChange={set('priority')}>
              {Object.entries(PRIORITIES).map(([value, [label]]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vence">
            <input className={inputClass} type="datetime-local" value={form.dueAt} onChange={set('dueAt')} />
          </Field>
        </div>
        {error && (
          <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
