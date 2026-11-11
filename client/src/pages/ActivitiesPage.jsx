import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  Palmtree,
  PlayCircle,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  XCircle,
  PersonSimpleRun,
  PaintBrush,
  MusicNotes,
  BookOpen,
  PuzzlePiece,
  TextAa,
  Tree,
  HandPalm,
  Shower,
  Star,
} from '../components/icons'
import { api, apiError, longDate, mediaUrl, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import DayFilters from '../components/DayFilters'
import Modal from '../components/Modal'
import PhotoCapture from '../components/PhotoCapture'
import ConsentWarning from '../components/consent/ConsentWarning'
import MomentCaptureModal from '../components/photos/MomentCaptureModal'
import StaffPhotoGrid from '../components/photos/StaffPhotoGrid'
import ConfirmDialog from '../components/ConfirmDialog'
import { LoadMore, SearchInput } from '../components/DataToolbar'
import { matchChild } from '../components/childSearch'
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

const CATEGORIES = [
  { value: 'motor', label: 'Motricidad', icon: PersonSimpleRun },
  { value: 'arte', label: 'Arte', icon: PaintBrush },
  { value: 'musica', label: 'Música', icon: MusicNotes },
  { value: 'lectura', label: 'Cuentos', icon: BookOpen },
  { value: 'juego', label: 'Juego libre', icon: PuzzlePiece },
  { value: 'aprendizaje', label: 'Aprendizaje', icon: TextAa },
  { value: 'exterior', label: 'Aire libre', icon: Tree },
  { value: 'sensorial', label: 'Sensorial', icon: HandPalm },
  { value: 'higiene', label: 'Hábitos', icon: Shower },
  { value: 'otro', label: 'Otra', icon: Star },
]

/** Valores exactos del backend (PARTICIPATIONS) con su texto corto. Seleccionado = tono suave + texto fuerte. */
const PARTICIPATIONS = [
  {
    value: 'excellent',
    label: 'Entusiasmo',
    on: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/40',
  },
  { value: 'good', label: 'Bien', on: 'bg-accent-soft text-accent-text border-accent/40' },
  { value: 'regular', label: 'A ratos', on: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/40' },
  { value: 'low', label: 'Le costó', on: 'bg-red-50 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/40' },
  { value: 'absent', label: 'No participó', on: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-white/10 dark:text-white/80 dark:border-white/20' },
]

const STATUS = {
  planned: { label: 'Planificada', tone: 'slate', icon: CalendarClock },
  in_progress: { label: 'En curso', tone: 'amber', icon: PlayCircle },
  completed: { label: 'Terminada', tone: 'green', icon: CheckCircle2 },
  cancelled: { label: 'Cancelada', tone: 'rose', icon: XCircle },
}
const statusOf = (s) => STATUS[s] || STATUS.in_progress

const categoryOf = (v) => CATEGORIES.find((c) => c.value === v) || CATEGORIES[CATEGORIES.length - 1]

/** Cambia el estado de una actividad con los endpoints que existen. */
async function transition(activity, to) {
  if (to === 'completed') {
    return api.post(`/activities/${activity.id}/complete`, {})
  }
  if (to === 'in_progress' && activity.status === 'completed') {
    // Reabrir: se borra la hora de fin (cadena vacía = sin fin).
    return api.patch(`/activities/${activity.id}`, { status: 'in_progress', endedAt: '' })
  }
  if (to === 'in_progress') {
    return api.patch(`/activities/${activity.id}`, {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    })
  }
  return api.patch(`/activities/${activity.id}`, { status: to })
}

const TRANSITION_TOAST = {
  in_progress: 'Actividad en curso',
  completed: 'Actividad terminada',
  planned: 'Actividad planificada',
}

function StatusBadge({ status }) {
  const s = statusOf(status)
  return (
    <Badge tone={s.tone}>
      <s.icon className="w-3 h-3" /> {s.label}
    </Badge>
  )
}

export default function ActivitiesPage() {
  const { pushToast } = useToasts()
  const { canManage } = useAuth()

  const [date, setDate] = useState(todayKey())
  const [classroomId, setClassroomId] = useState('')
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const loadSeq = useRef(0)
  // `silent`: recarga en vivo o tras una acción, sin spinner (no parpadea ni salta el scroll).
  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    try {
      const res = await api.get('/activities', {
        params: { date, classroomId: classroomId || undefined },
      })
      if (seq !== loadSeq.current) return
      setActivities(res.data || [])
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar las actividades') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [date, classroomId, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['activity', 'photo'], date, classroomId: classroomId || undefined })

  const move = async (a, to) => {
    setBusyId(a.id)
    try {
      await transition(a, to)
      pushToast({ type: 'success', message: TRANSITION_TOAST[to] || 'Estado actualizado' })
      quietReload()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Actividades"
        subtitle={longDate(date)}
        icon={Palmtree}
        actions={
          <>
            <DayFilters
              date={date}
              onDateChange={setDate}
              classroomId={classroomId}
              onClassroomChange={setClassroomId}
            />
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Nueva actividad
            </Button>
          </>
        }
      />

      {loading ? (
        <Loading />
      ) : activities.length === 0 ? (
        <Card>
          <EmptyState
            icon={Palmtree}
            title="Sin actividades ese día"
            message="Registra lo que hicieron los niños: es lo que más leen las familias en el reporte."
            action={
              <Button icon={Plus} onClick={() => setCreating(true)}>
                Crear la primera
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {activities.map((a) => {
            const cat = categoryOf(a.category)
            return (
              <Card key={a.id} padded={false} className="overflow-hidden flex flex-col">
                <button
                  type="button"
                  onClick={() => setDetailId(a.id)}
                  className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring rounded-t-xl"
                  aria-label={`Abrir ${a.title}`}
                >
                  {a.coverPhotoUrl ? (
                    <img
                      src={mediaUrl(a.coverPhotoUrl)}
                      alt=""
                      className="w-full aspect-video object-cover"
                    />
                  ) : (
                    <div className="w-full h-20 bg-slate-50 dark:bg-white/4 border-b border-slate-100 dark:border-white/5 flex items-center justify-center">
                      <cat.icon className="w-7 h-7 text-slate-400 dark:text-white/35" aria-hidden />
                    </div>
                  )}
                </button>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{a.title}</h3>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-white/40 mt-1">
                    <cat.icon className="inline w-3.5 h-3.5 -mt-0.5 mr-1 text-slate-400 dark:text-white/40" aria-hidden />
                    {cat.label}
                    {a.classroom?.name ? ` · ${a.classroom.name}` : ' · Toda la guardería'}
                    {a.startedAt && a.status !== 'planned' ? ` · ${timeOf(a.startedAt)}` : ''}
                    {a.endedAt ? `–${timeOf(a.endedAt)}` : ''}
                  </p>
                  {a.description && (
                    <p className="text-sm text-slate-600 dark:text-white/60 mt-2 line-clamp-3">
                      {a.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-3 mb-3">
                    <Badge tone="sky">
                      <Users className="w-3 h-3" /> {a.participantCount}{' '}
                      {a.participantCount === 1 ? 'niño' : 'niños'}
                    </Badge>
                    {a.shareWithFamilies ? (
                      <Badge tone="green">
                        <Eye className="w-3 h-3" /> La ven las familias
                      </Badge>
                    ) : (
                      <Badge tone="slate">
                        <EyeOff className="w-3 h-3" /> Sólo personal
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-auto pt-3 border-t border-slate-100 dark:border-white/5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-10"
                      onClick={() => setDetailId(a.id)}
                    >
                      Participación y fotos
                    </Button>
                    {a.status === 'planned' && (
                      <Button
                        size="sm"
                        icon={PlayCircle}
                        className="min-h-10"
                        loading={busyId === a.id}
                        onClick={() => move(a, 'in_progress')}
                      >
                        Empezar
                      </Button>
                    )}
                    {a.status === 'in_progress' && (
                      <Button
                        size="sm"
                        variant="success"
                        icon={CheckCircle2}
                        className="min-h-10"
                        loading={busyId === a.id}
                        onClick={() => move(a, 'completed')}
                      >
                        Terminar
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        className="ml-auto"
                        aria-label={`Eliminar ${a.title}`}
                        onClick={() => setToDelete(a)}
                      />
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {creating && (
        <ActivityForm
          date={date}
          classroomId={classroomId}
          onClose={() => setCreating(false)}
          onSaved={(created) => {
            setCreating(false)
            quietReload()
            if (created?.id) setDetailId(created.id)
          }}
        />
      )}

      {detailId && (
        <ActivityDetail id={detailId} onClose={() => setDetailId(null)} onChanged={quietReload} />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        variant="danger"
        title={`¿Eliminar "${toDelete?.title}"?`}
        message="También se quitarán sus fotos de la galería y del reporte diario."
        confirmText="Eliminar"
        onConfirm={async () => {
          try {
            await api.delete(`/activities/${toDelete.id}`)
            pushToast({ type: 'success', message: 'Actividad eliminada' })
            setToDelete(null)
            quietReload()
          } catch (err) {
            pushToast({ type: 'error', message: apiError(err) })
          }
        }}
      />
    </>
  )
}

/** Interruptor accesible con texto (no sólo color). */
function Switch({ checked, onChange, title, description }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-white/10 p-3 cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`mt-0.5 shrink-0 w-11 h-6 rounded-full transition relative peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ring ${
          checked ? 'bg-accent' : 'bg-slate-300 dark:bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-5.5' : 'left-0.5'
          }`}
        />
      </span>
      <span className="text-sm">
        <span className="font-semibold text-slate-800 dark:text-white">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-white/40">{description}</span>
      </span>
    </label>
  )
}

const WHEN_OPTIONS = [
  { value: 'in_progress', label: 'Ahora', hint: 'En curso' },
  { value: 'planned', label: 'Más tarde', hint: 'Planificada' },
  { value: 'completed', label: 'Ya terminó', hint: 'Terminada' },
]

function ActivityForm({ date, classroomId, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const { isTeacher } = useAuth()
  const [classrooms, setClassrooms] = useState([])
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'juego',
    classroomId: classroomId || '',
    shareWithFamilies: true,
  })
  const [when, setWhen] = useState('in_progress')
  const [coverPhoto, setCoverPhoto] = useState('')
  const [extraPhoto, setExtraPhoto] = useState('')
  const [withPhotos, setWithPhotos] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get('/classrooms', { params: { includeInactive: 'false' } })
      .then((r) => {
        const list = r.data || []
        setClassrooms(list)
        // La educadora no puede crear actividades de toda la guardería: su sala por defecto.
        if (isTeacher && list.length) {
          setForm((f) => (f.classroomId ? f : { ...f, classroomId: list[0].id }))
        }
      })
      .catch(() => {})
  }, [isTeacher])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e) => {
    e?.preventDefault()
    setError('')
    if (form.title.trim().length < 2) {
      setError('Escribe un título (mínimo 2 letras)')
      return
    }
    setSaving(true)
    try {
      const res = await api.post('/activities', {
        ...form,
        date,
        classroomId: form.classroomId || undefined,
        coverPhoto: coverPhoto || undefined,
        photos: extraPhoto ? [extraPhoto] : undefined,
        endedAt: when === 'completed' ? new Date().toISOString() : undefined,
      })
      // El alta siempre nace "en curso": la planificada se ajusta después.
      if (when === 'planned' && res.data?.id) {
        await api.patch(`/activities/${res.data.id}`, { status: 'planned' })
      }
      pushToast({ type: 'success', message: 'Actividad creada · marca ahora cómo participó cada niño' })
      onSaved(res.data)
    } catch (err) {
      const msg = apiError(err, 'No se pudo crear la actividad')
      setError(msg)
      pushToast({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title="Nueva actividad"
      subtitle="Participa toda la sala; luego ajustas uno a uno."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} className="min-h-11">
            Crear actividad
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="Título" required>
          <input
            className={`${inputClass} min-h-11`}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Pintura con las manos"
            required
            autoFocus
          />
        </Field>

        <div>
          <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-1.5">
            Tipo de actividad
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="radiogroup" aria-label="Tipo de actividad">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={form.category === c.value}
                onClick={() => set('category', c.value)}
                className={`min-h-11 px-2.5 rounded-lg text-sm font-medium border transition flex items-center gap-2 ${
                  form.category === c.value
                    ? 'border-accent bg-accent-soft text-accent-text ring-1 ring-accent'
                    : 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                <c.icon className="w-4 h-4 shrink-0" aria-hidden /> {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Sala">
            <select
              className={`${inputClass} min-h-11`}
              value={form.classroomId}
              onChange={(e) => set('classroomId', e.target.value)}
            >
              {!isTeacher && <option value="">Toda la guardería</option>}
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-1.5">
              ¿Cuándo?
            </span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 dark:bg-white/5 p-1" role="radiogroup" aria-label="¿Cuándo?">
              {WHEN_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={when === o.value}
                  onClick={() => setWhen(o.value)}
                  className={`min-h-10 rounded-lg px-1 text-xs font-semibold leading-tight transition ${
                    when === o.value
                      ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-white/50'
                  }`}
                >
                  {o.label}
                  <span className="block text-[10px] font-semibold opacity-70">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <Field label="Descripción" hint="Lo que se cuenta a la familia en el reporte.">
          <textarea
            className={inputClass}
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Exploramos colores primarios pintando con las manos."
          />
        </Field>

        <Switch
          checked={form.shareWithFamilies}
          onChange={(v) => set('shareWithFamilies', v)}
          title={form.shareWithFamilies ? 'Compartir con las familias · Sí' : 'Compartir con las familias · No'}
          description={
            form.shareWithFamilies
              ? 'Aparece en el reporte diario y en el portal de las familias, con sus fotos.'
              : 'Sólo la ve el personal: no sale en el reporte ni en el portal.'
          }
        />

        {withPhotos || coverPhoto || extraPhoto ? (
          <div className="space-y-3">
            {/* Fotos de grupo: qué niños de la sala no deben aparecer. */}
            <ConsentWarning classroomId={form.classroomId} />
            <div className="grid sm:grid-cols-2 gap-4">
              <PhotoCapture value={coverPhoto} onChange={setCoverPhoto} label="Foto principal" compact />
              <PhotoCapture value={extraPhoto} onChange={setExtraPhoto} label="Otra foto" compact />
            </div>
          </div>
        ) : (
          <Button type="button" variant="secondary" icon={Camera} onClick={() => setWithPhotos(true)}>
            Añadir fotos (opcional)
          </Button>
        )}

        {error && (
          <p
            role="alert"
            className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

/** Con más niños que esto aparece el buscador; la lista va de PARTICIPANT_PAGE en PARTICIPANT_PAGE. */
const PARTICIPANT_SEARCH_MIN = 12
const PARTICIPANT_PAGE = 30

function ActivityDetail({ id, onClose, onChanged }) {
  const { pushToast } = useToasts()
  const [activity, setActivity] = useState(null)
  const [participants, setParticipants] = useState([])
  const [saved, setSaved] = useState([])
  const [saving, setSaving] = useState(false)
  const [moving, setMoving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [openNotes, setOpenNotes] = useState([])
  const [addingPhoto, setAddingPhoto] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  // Salas grandes: buscador (nombre o cédula), filtro por participación y lista por tandas.
  const [pSearch, setPSearch] = useState('')
  const [pFilter, setPFilter] = useState('')
  const [pLimit, setPLimit] = useState(PARTICIPANT_PAGE)
  const [docs, setDocs] = useState({})

  const savedRef = useRef([])
  // `merge` (en vivo): lo que la educadora está marcando y aún no guardó se conserva;
  // sólo se refrescan los niños sin cambios locales.
  const load = useCallback(({ merge = false } = {}) => {
    api
      .get(`/activities/${id}`)
      .then((r) => {
        setLoadError('')
        setActivity(r.data)
        const list = r.data.participants || []
        if (merge) {
          const before = new Map(savedRef.current.map((p) => [p.childId, p]))
          setParticipants((local) => {
            const mine = new Map(local.map((p) => [p.childId, p]))
            return list.map((p) => {
              const l = mine.get(p.childId)
              const b = before.get(p.childId)
              const dirty =
                l && (!b || b.participation !== l.participation || (b.note || '') !== (l.note || ''))
              return dirty ? { ...p, participation: l.participation, note: l.note } : p
            })
          })
        } else setParticipants(list)
        savedRef.current = list
        setSaved(list)
      })
      .catch((err) => {
        const msg = apiError(err, 'No se pudo cargar la actividad')
        setLoadError(msg)
        if (!merge) pushToast({ type: 'error', message: msg })
      })
  }, [id, pushToast])

  useLoadEffect(load)
  const mergeReload = useCallback(() => load({ merge: true }), [load])
  useLiveReload(mergeReload, { entities: ['activity', 'photo'] })

  const dirtyCount = useMemo(() => {
    const before = new Map(saved.map((p) => [p.childId, p]))
    return participants.filter((p) => {
      const b = before.get(p.childId)
      return !b || b.participation !== p.participation || (b.note || '') !== (p.note || '')
    }).length
  }, [participants, saved])

  const setParticipant = (childId, key, value) =>
    setParticipants((list) =>
      list.map((p) => (p.childId === childId ? { ...p, [key]: value } : p)),
    )

  const setAll = (value) => setParticipants((list) => list.map((p) => ({ ...p, participation: value })))

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/activities/${id}/participants`, {
        participants: participants.map((p) => ({
          childId: p.childId,
          participation: p.participation,
          note: p.note || undefined,
        })),
      })
      pushToast({ type: 'success', message: 'Participación guardada' })
      onChanged()
      load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setSaving(false)
    }
  }

  const move = async (to) => {
    setMoving(true)
    try {
      await transition(activity, to)
      pushToast({ type: 'success', message: TRANSITION_TOAST[to] || 'Estado actualizado' })
      onChanged()
      mergeReload()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setMoving(false)
    }
  }

  const tryClose = () => (dirtyCount ? setConfirmClose(true) : onClose())

  const bigList = participants.length > PARTICIPANT_SEARCH_MIN
  const roomId = activity?.classroomId
  useEffect(() => {
    if (!bigList) return undefined
    let alive = true
    api
      .get('/children', { params: { classroomId: roomId || undefined } })
      .then((r) => {
        if (!alive) return
        const map = {}
        for (const c of r.data || []) if (c.documentId) map[c.id] = c.documentId
        setDocs(map)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [bigList, roomId])

  const pQuery = bigList ? pSearch.trim() : ''
  const pSearched = pQuery
    ? participants.filter((p) => matchChild({ name: p.name, documentId: docs[p.childId] }, pQuery))
    : participants
  const pVisible = bigList && pFilter ? pSearched.filter((p) => p.participation === pFilter) : pSearched
  const pSig = `${pQuery}|${pFilter}`
  const [prevPSig, setPrevPSig] = useState(pSig)
  if (prevPSig !== pSig) {
    setPrevPSig(pSig)
    setPLimit(PARTICIPANT_PAGE)
  }
  const pShown = bigList ? pVisible.slice(0, pLimit) : pVisible

  const counts = PARTICIPATIONS.map((o) => ({
    ...o,
    n: participants.filter((p) => p.participation === o.value).length,
  })).filter((o) => o.n)

  const status = activity?.status

  return (
    <Modal
      open
      onClose={tryClose}
      width="lg"
      title={activity?.title || 'Actividad'}
      subtitle={
        activity
          ? `${activity.categoryLabel || categoryOf(activity.category).label} · ${participants.length} niños`
          : ''
      }
      footer={
        <>
          {dirtyCount > 0 ? (
            <Badge tone="amber" className="mr-auto self-center">
              Sin guardar · {dirtyCount} {dirtyCount === 1 ? 'cambio' : 'cambios'}
            </Badge>
          ) : (
            activity && (
              <Badge tone="green" className="mr-auto self-center">
                <CheckCircle2 className="w-3 h-3" /> Todo guardado
              </Badge>
            )
          )}
          <Button variant="ghost" onClick={tryClose}>
            Cerrar
          </Button>
          <Button onClick={save} loading={saving} disabled={!dirtyCount} className="min-h-11">
            Guardar participación
          </Button>
        </>
      }
    >
      {loadError && !activity ? (
        <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
          {loadError}
        </p>
      ) : !activity ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {/* Estado con transiciones de un toque */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 dark:bg-white/4 p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45">
              Estado
            </span>
            <StatusBadge status={status} />
            <div className="ml-auto flex flex-wrap gap-2">
              {status === 'planned' && (
                <Button size="sm" icon={PlayCircle} loading={moving} onClick={() => move('in_progress')}>
                  Empezar ahora
                </Button>
              )}
              {status === 'in_progress' && (
                <Button size="sm" variant="success" icon={CheckCircle2} loading={moving} onClick={() => move('completed')}>
                  Marcar como terminada
                </Button>
              )}
              {(status === 'completed' || status === 'cancelled') && (
                <Button size="sm" variant="secondary" icon={RotateCcw} loading={moving} onClick={() => move('in_progress')}>
                  Reabrir
                </Button>
              )}
            </div>
          </div>

          {activity.description && (
            <p className="text-sm text-slate-600 dark:text-white/60">{activity.description}</p>
          )}

          {/* Participación */}
          <section>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex-1">
                ¿Cómo participó cada niño?
              </h3>
              <Button size="sm" variant="secondary" onClick={() => setAll('good')}>
                Todos: Bien
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAll('excellent')}>
                Todos: Entusiasmo
              </Button>
            </div>
            {counts.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-white/40 mb-2">
                {counts.map((c) => `${c.label}: ${c.n}`).join(' · ')}
              </p>
            )}
            {bigList && (
              <div className="space-y-2 mb-1">
                <SearchInput
                  value={pSearch}
                  onChange={setPSearch}
                  placeholder="Buscar niño por nombre o cédula…"
                  aria-label="Buscar niño por nombre o cédula"
                />
                <div
                  className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 [scrollbar-width:none]"
                  role="group"
                  aria-label="Filtrar por participación"
                >
                  {[{ value: '', label: 'Todos' }, ...PARTICIPATIONS].map((o) => {
                    const n = o.value ? pSearched.filter((x) => x.participation === o.value).length : pSearched.length
                    if (o.value && !n && pFilter !== o.value) return null
                    const on = pFilter === o.value
                    return (
                      <button
                        key={o.value || 'all'}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPFilter(o.value)}
                        className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-9 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                          on
                            ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/25'
                            : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
                        }`}
                      >
                        {o.label}
                        <span className="min-w-5 px-1.5 rounded-md text-[11px] tabular-nums bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50">
                          {n}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {participants.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-white/40">
                No hay niños en esta actividad.
              </p>
            ) : pVisible.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-white/45">
                Ningún niño coincide.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setPSearch('')
                    setPFilter('')
                  }}
                  className="font-medium text-accent-text hover:underline"
                >
                  Limpiar
                </button>
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {pShown.map((p) => {
                  const noteOpen = openNotes.includes(p.childId) || !!p.note
                  return (
                    <li key={p.childId} className="py-3">
                      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                        <div className="flex items-center gap-2 lg:w-44 shrink-0">
                          <Avatar src={p.photoUrl} name={p.name} size="sm" />
                          <span className="text-sm font-semibold text-slate-800 dark:text-white truncate flex-1">
                            {p.name}
                          </span>
                          {!noteOpen && (
                            <button
                              type="button"
                              onClick={() => setOpenNotes((l) => [...l, p.childId])}
                              className="lg:hidden text-xs font-medium text-accent-text px-2 py-2"
                            >
                              + Nota
                            </button>
                          )}
                        </div>
                        <div
                          role="radiogroup"
                          aria-label={`Participación de ${p.name}`}
                          className="grid grid-cols-5 gap-1 flex-1"
                        >
                          {PARTICIPATIONS.map((opt) => {
                            const on = p.participation === opt.value
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setParticipant(p.childId, 'participation', opt.value)}
                                className={`min-h-11 px-1 rounded-lg text-[11px] sm:text-xs font-medium leading-tight border transition-colors ${
                                  on
                                    ? opt.on
                                    : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5'
                                }`}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                        {!noteOpen && (
                          <button
                            type="button"
                            onClick={() => setOpenNotes((l) => [...l, p.childId])}
                            className="hidden lg:block text-xs font-medium text-accent-text px-2 py-2 shrink-0"
                          >
                            + Nota
                          </button>
                        )}
                      </div>
                      {noteOpen && (
                        <input
                          className={`${inputClass} mt-2`}
                          value={p.note || ''}
                          aria-label={`Observación de ${p.name}`}
                          onChange={(e) => setParticipant(p.childId, 'note', e.target.value)}
                          placeholder="Observación individual (va a su reporte)…"
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {bigList && pVisible.length > PARTICIPANT_PAGE && (
              <LoadMore
                className="!px-0"
                shown={pShown.length}
                total={pVisible.length}
                step={PARTICIPANT_PAGE}
                label="niños"
                onMore={() => setPLimit((l) => l + PARTICIPANT_PAGE)}
                onAll={() => setPLimit(pVisible.length)}
              />
            )}
          </section>

          {/* Fotos */}
          <section>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <div className="flex-1 min-w-40">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white">
                  Fotos de la actividad ({activity.photos?.length || 0})
                </h3>
                <p className="text-xs text-slate-500 dark:text-white/45">
                  {activity.shareWithFamilies
                    ? 'Cada foto aparece en la galería del día de los niños que salen en ella.'
                    : 'Esta actividad no se comparte con las familias: las fotos quedan sólo para el personal.'}
                </p>
              </div>
              {!addingPhoto && (
                <Button size="sm" icon={Camera} onClick={() => setAddingPhoto(true)} className="min-h-10">
                  Añadir fotos
                </Button>
              )}
            </div>
            {addingPhoto && (
              <div className="mb-3">
                <MomentCaptureModal
                  inline
                  open
                  activityId={activity.id}
                  activityTitle={activity.title}
                  classroomId={activity.classroomId || undefined}
                  date={activity.date}
                  defaultShare={activity.shareWithFamilies !== false}
                  defaultChildIds={participants.filter((p) => p.participation !== 'absent').map((p) => p.childId)}
                  quickSelect={[
                    {
                      label: 'Participantes',
                      ids: participants.filter((p) => p.participation !== 'absent').map((p) => p.childId),
                    },
                  ]}
                  onClose={() => setAddingPhoto(false)}
                  onSaved={() => {
                    onChanged()
                    mergeReload()
                  }}
                />
              </div>
            )}
            {activity.photos?.length > 0 ? (
              <StaffPhotoGrid
                photos={activity.photos}
                showActivity={false}
                columns="grid-cols-2 sm:grid-cols-3"
                onChange={(photos) => setActivity((a) => ({ ...a, photos }))}
              />
            ) : (
              !addingPhoto && (
                <p className="text-sm text-slate-500 dark:text-white/40">
                  Sin fotos todavía. Toma fotos durante la actividad y etiqueta a los niños que salen.
                </p>
              )
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        variant="warning"
        title="¿Salir sin guardar?"
        message={`Tienes ${dirtyCount} ${dirtyCount === 1 ? 'cambio' : 'cambios'} de participación sin guardar.`}
        confirmText="Salir sin guardar"
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
    </Modal>
  )
}
