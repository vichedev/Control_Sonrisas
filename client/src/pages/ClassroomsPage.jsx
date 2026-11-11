import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Baby, Pencil, Plus, Trash2, UserRound, Users } from '../components/icons'
import { api, apiError } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { RowMenu } from '../components/SmartTable'
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
  StatTile,
} from '../components/ui'

const LEVELS = [
  { value: 'lactantes', label: 'Lactantes' },
  { value: 'maternal', label: 'Maternal' },
  { value: 'caminadores', label: 'Caminadores' },
  { value: 'prekinder', label: 'Prekínder' },
  { value: 'kinder', label: 'Kínder' },
  { value: 'otro', label: 'Otro' },
]

/** Barra de ocupación niños/cupo con texto (el color nunca va solo). */
function Occupancy({ count, capacity }) {
  if (!capacity) {
    return (
      <p className="text-sm text-slate-600 dark:text-white/65">
        <strong className="text-slate-900 dark:text-white tabular-nums">{count}</strong> {count === 1 ? 'niño' : 'niños'}
        <span className="text-xs text-slate-400 dark:text-white/35"> · sin cupo definido</span>
      </p>
    )
  }
  const pct = Math.min(100, Math.round((count / capacity) * 100))
  const full = count >= capacity
  const near = !full && pct >= 80
  const bar = full ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500'
  const free = Math.max(0, capacity - count)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <p className="text-slate-600 dark:text-white/65">
          <strong className="text-slate-900 dark:text-white tabular-nums">{count}</strong> de{' '}
          <span className="tabular-nums">{capacity}</span> niños
        </p>
        <span
          className={`text-xs font-semibold ${
            full ? 'text-red-600 dark:text-red-400' : near ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {full ? (count > capacity ? `Excede en ${count - capacity}` : 'Llena') : `${free} ${free === 1 ? 'cupo libre' : 'cupos libres'}`}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={count}
        aria-label="Ocupación"
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function ClassroomsPage() {
  const { pushToast } = useToasts()
  const { isAdmin } = useAuth()

  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // objeto o 'new'
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [teachers, setTeachers] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/classrooms')
      setRooms(res.data || [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar las salas') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useLoadEffect(load)
  // En vivo (el spinner sólo sale sin datos: recargar no parpadea).
  useLiveReload(load, { entities: ['child'] })

  // La sala puede tener una educadora "a cargo" y además educadoras asignadas desde Personal.
  useEffect(() => {
    api.get('/staff/teachers').then((r) => setTeachers(r.data || [])).catch(() => {})
  }, [])

  const teachersOf = (room) => {
    const names = teachers.filter((t) => t.classroomId === room.id).map((t) => t.name)
    if (room.teacherName && !names.includes(room.teacherName)) names.unshift(room.teacherName)
    return names
  }

  const active = rooms.filter((r) => r.active)
  const kids = active.reduce((s, r) => s + (r.childCount || 0), 0)
  const capacity = active.reduce((s, r) => s + (r.capacity || 0), 0)
  const withoutTeacher = active.filter((r) => !teachersOf(r).length).length

  return (
    <>
      <PageHeader
        title="Salas"
        subtitle={`${active.length} sala(s) activa(s)`}
        icon={Users}
        actions={
          isAdmin && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              Nueva sala
            </Button>
          )
        }
      />

      {loading && rooms.length === 0 ? (
        <Loading />
      ) : rooms.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Aún no hay salas"
            message="Crea las salas de la guardería para agrupar a los niños y asignar a cada educadora."
            action={
              isAdmin && (
                <Button icon={Plus} onClick={() => setEditing('new')}>
                  Crear la primera sala
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            <StatTile label="Niños en salas" value={kids} tone="sky" icon={Baby} />
            <StatTile
              label="Ocupación total"
              value={capacity ? `${Math.round((kids / capacity) * 100)}%` : '—'}
              tone="green"
              hint={capacity ? `${kids} de ${capacity} cupos` : 'Define el cupo de cada sala'}
            />
            <StatTile
              label="Sin educadora"
              value={withoutTeacher}
              tone={withoutTeacher ? 'amber' : 'slate'}
              icon={UserRound}
              hint={withoutTeacher ? 'Asigna una para que vea su sala' : 'Todas tienen educadora'}
            />
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <Card key={room.id} padded={false} className={`overflow-hidden flex flex-col ${room.active ? '' : 'opacity-60'}`}>
                <div className="p-5 flex-1 flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <span
                      className="relative w-10 h-10 rounded-lg shrink-0 inline-flex items-center justify-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/75 font-semibold"
                      aria-hidden="true"
                    >
                      {room.name?.[0]?.toUpperCase()}
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-surface"
                        style={{ backgroundColor: room.color || '#94a3b8' }}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">{room.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-white/45">
                        {LEVELS.find((l) => l.value === room.level)?.label || room.level}
                        {room.ageMaxMonths > 0 && ` · ${room.ageMinMonths}–${room.ageMaxMonths} meses`}
                      </p>
                      {!room.active && <Badge tone="slate" className="mt-1">Inactiva</Badge>}
                    </div>
                    {isAdmin && (
                      <RowMenu
                        label={`Acciones para ${room.name}`}
                        items={[
                          { label: 'Editar sala', icon: Pencil, onClick: () => setEditing(room) },
                          { label: 'Eliminar sala', icon: Trash2, danger: true, onClick: () => setToDelete(room) },
                        ]}
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    {teachersOf(room).length ? (
                      <>
                        <Avatar name={teachersOf(room)[0]} size="sm" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-slate-500 dark:text-white/45">
                            {teachersOf(room).length > 1 ? 'Educadoras' : 'Educadora'}
                          </p>
                          <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                            {teachersOf(room).join(', ')}
                          </p>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => setEditing(room)}
                        className="inline-flex items-center gap-2 min-h-9 px-3 rounded-lg text-xs font-medium bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 enabled:hover:bg-amber-100 dark:enabled:hover:bg-amber-500/15"
                      >
                        <UserRound className="w-4 h-4" />
                        Sin educadora{isAdmin ? ' · Asignar' : ''}
                      </button>
                    )}
                  </div>

                  <Occupancy count={room.childCount || 0} capacity={room.capacity || 0} />

                  <Link
                    to={`/panel/ninos?sala=${room.id}`}
                    className="mt-auto inline-flex items-center gap-1 min-h-9 text-sm font-medium text-accent-text hover:underline"
                  >
                    Ver los niños de esta sala <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {editing && (
        <ClassroomForm
          room={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        variant="danger"
        loading={deleting}
        title={`¿Eliminar la sala "${toDelete?.name}"?`}
        message={`Los ${toDelete?.childCount || 0} niño(s) de esta sala no se borran: quedarán sin sala asignada.`}
        confirmText="Eliminar"
        onConfirm={async () => {
          setDeleting(true)
          try {
            await api.delete(`/classrooms/${toDelete.id}`)
            pushToast({ type: 'success', message: 'Sala eliminada' })
            setToDelete(null)
            load()
          } catch (err) {
            pushToast({ type: 'error', message: apiError(err) })
          } finally {
            setDeleting(false)
          }
        }}
      />
    </>
  )
}

function ClassroomForm({ room, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [teachers, setTeachers] = useState([])
  const [form, setForm] = useState({
    name: room?.name || '',
    level: room?.level || 'otro',
    ageMinMonths: room?.ageMinMonths ?? 0,
    ageMaxMonths: room?.ageMaxMonths ?? 0,
    capacity: room?.capacity ?? 0,
    color: room?.color || '#38bdf8',
    teacherId: room?.teacherId || '',
    notes: room?.notes || '',
    active: room?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/staff/teachers').then((r) => setTeachers(r.data || [])).catch(() => {})
  }, [])

  const set = (key) => (e) => {
    const value =
      e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.type === 'number'
          ? Number(e.target.value)
          : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      // Al editar, `null` quita la educadora asignada; `undefined` la dejaría como estaba.
      const payload = { ...form, teacherId: form.teacherId || (room ? null : undefined) }
      if (room) await api.patch(`/classrooms/${room.id}`, payload)
      else await api.post('/classrooms', payload)
      pushToast({ type: 'success', message: room ? 'Sala actualizada' : 'Sala creada' })
      onSaved()
    } catch (err) {
      setError(apiError(err, 'No se pudo guardar'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={room ? `Editar ${room.name}` : 'Nueva sala'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nombre" required>
          <input className={inputClass} value={form.name} onChange={set('name')} required placeholder="Maternal A" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nivel">
            <select className={inputClass} value={form.level} onChange={set('level')}>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Educadora a cargo">
            <select className={inputClass} value={form.teacherId} onChange={set('teacherId')}>
              <option value="">Sin asignar</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="Edad mín. (meses)">
            <input className={inputClass} type="number" min="0" value={form.ageMinMonths} onChange={set('ageMinMonths')} />
          </Field>
          <Field label="Edad máx. (meses)">
            <input className={inputClass} type="number" min="0" value={form.ageMaxMonths} onChange={set('ageMaxMonths')} />
          </Field>
          <Field label="Cupo">
            <input className={inputClass} type="number" min="0" value={form.capacity} onChange={set('capacity')} />
          </Field>
          <Field label="Color">
            <input className={`${inputClass} h-[38px] p-1`} type="color" value={form.color} onChange={set('color')} />
          </Field>
        </div>
        <Field label="Notas">
          <textarea className={inputClass} rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/60">
          <input type="checkbox" checked={form.active} onChange={set('active')} />
          Sala activa
        </label>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
