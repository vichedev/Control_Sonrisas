import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Baby,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  IdentificationCard,
  History,
  Images,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  Mail,
  MessageCircleHeart,
  Moon,
  NotebookPen,
  Palette,
  Pencil,
  Phone,
  Pill,
  Plus,
  ShieldCheck,
  Signature,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Utensils,
} from '../components/icons'
import { addDays, api, apiError, longDate, mediaUrl, shortDate, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import ChildForm, { GuardianPicker } from '../components/ChildForm'
import Modal from '../components/Modal'
import CredentialsModal from '../components/CredentialsModal'
import ConfirmDialog from '../components/ConfirmDialog'
import DayChecklist from '../components/DayChecklist'
import { ConsentBadges } from '../components/consent/ConsentBadge'
import ConsentBadge from '../components/consent/ConsentBadge'
import ChildDayGallery from '../components/photos/ChildDayGallery'
import ChildPhotoHistory from '../components/photos/ChildPhotoHistory'
import { CONSENT_LABEL, CONSENT_TYPES, formatDateTime, statusOf } from '../components/consent/consentModel'
import { RowMenu } from '../components/SmartTable'
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
  SectionTitle,
} from '../components/ui'

const TABS = [
  ['hoy', 'Hoy', CalendarDays],
  ['fotos', 'Fotos', Images],
  ['ficha', 'Ficha', ClipboardList],
  ['familia', 'Representantes', Users],
  ['historial', 'Historial', History],
]

const TODAY_STATUS = {
  present: ['Presente', 'green'],
  checked_out: ['Ya se retiró', 'sky'],
  justified: ['Ausencia avisada', 'sky'],
  absent: ['Aún no llega', 'slate'],
}

/** Los correos internos (`.invalid`) no son correos reales: no se muestran. */
const realEmail = (email) => (email && !/\.invalid$/i.test(email) ? email : '')

export default function ChildDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { pushToast } = useToasts()
  const { canManage, isAdmin } = useAuth()

  const [child, setChild] = useState(null)
  const [today, setToday] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmActive, setConfirmActive] = useState(false)
  const [savingActive, setSavingActive] = useState(false)

  const tabParam = params.get('tab')
  const tab = TABS.some(([v]) => v === tabParam) ? tabParam : 'hoy'
  const setTab = (value) => {
    const next = new URLSearchParams(params)
    if (value === 'hoy') next.delete('tab')
    else next.set('tab', value)
    setParams(next, { replace: true })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/children/${id}`)
      setChild(res.data)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la ficha') })
    } finally {
      setLoading(false)
    }
  }, [id, pushToast])

  /** Dar de baja (active=false) o reactivar. No borra nada. Devuelve true si se guardó. */
  const setActive = async (value) => {
    setSavingActive(true)
    try {
      await api.patch(`/children/${id}`, { active: value })
      pushToast({
        type: 'success',
        message: value ? `${child?.firstName || 'El niño'} vuelve a estar activo` : `${child?.firstName || 'El niño'} quedó dado de baja`,
      })
      setConfirmActive(false)
      await load()
      return true
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo guardar') })
      return false
    } finally {
      setSavingActive(false)
    }
  }

  useLoadEffect(load)
  // Ficha en vivo; con el formulario de edición abierto no se recarga (se pone al día al cerrarlo).
  useLiveReload(load, { entities: ['child'], childId: id }, { enabled: !editing })

  // Estado de hoy (presente / retirado…) para el encabezado. Complementario.
  const childKey = child?.id
  const roomId = child?.classroomId
  const active = !!child?.active
  const loadToday = useCallback(() => {
    if (!roomId || !active) return undefined
    let cancelled = false
    api
      .get('/attendance/board', { params: { classroomId: roomId } })
      .then((r) => {
        if (!cancelled) setToday((r.data?.children || []).find((c) => c.childId === childKey) || null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [childKey, roomId, active])
  useEffect(() => loadToday(), [loadToday])
  useLiveReload(loadToday, { entities: ['attendance', 'justification'], childId: id, date: todayKey() })

  if (loading && !child) return <Loading />
  if (!child)
    return (
      <EmptyState
        icon={Baby}
        title="Niño no encontrado"
        action={
          <Link to="/panel/ninos">
            <Button variant="secondary" icon={ArrowLeft}>
              Volver a niños
            </Button>
          </Link>
        }
      />
    )

  const guardians = child.guardians || []
  const todayStatus = today && TODAY_STATUS[today.status]
  const alerts = [
    child.allergies && { key: 'a', icon: AlertTriangle, title: 'Alergias', text: child.allergies, tone: 'red' },
    child.medicalConditions && {
      key: 'm',
      icon: HeartPulse,
      title: 'Condición médica',
      text: child.medicalConditions,
      tone: 'amber',
    },
    child.medications && { key: 'p', icon: Pill, title: 'Medicación', text: child.medications, tone: 'amber' },
  ].filter(Boolean)

  return (
    <>
      <Link
        to="/panel/ninos"
        className="inline-flex items-center gap-1 min-h-9 text-sm font-medium text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white mb-2"
      >
        <ArrowLeft className="w-4 h-4" /> Niños
      </Link>

      <Card className="mb-5 overflow-hidden" padded={false}>
        <div className="p-5 flex flex-wrap items-start gap-4">
          <Avatar src={child.photoUrl} name={child.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                {child.fullName}
              </h1>
              {!child.active && <Badge tone="red">Dado de baja</Badge>}
            </div>
            <p className="text-sm text-slate-500 dark:text-white/50 mt-0.5">
              {child.age} · nació el {shortDate(child.birthDate)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {child.classroomName ? (
                <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-[11px] font-medium leading-4 bg-slate-100 dark:bg-white/8 text-slate-700 dark:text-white/75 ring-1 ring-inset ring-slate-500/15 dark:ring-white/10">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: child.classroomColor || '#94a3b8' }}
                  />
                  {child.classroomName}
                </span>
              ) : (
                <Badge tone="amber">Sin sala asignada</Badge>
              )}
              {todayStatus && (
                <Badge tone={todayStatus[1]}>
                  Hoy: {todayStatus[0]}
                  {today.status === 'present' && today.arrival ? ` desde ${timeOf(today.arrival.createdAt)}` : ''}
                </Badge>
              )}
              {child.documentId && (
                <Badge tone="slate" className="tabular-nums">
                  <IdentificationCard className="w-3.5 h-3.5" aria-hidden="true" />
                  Cédula {formatDocumentId(child.documentId)}
                </Badge>
              )}
              {child.code && <Badge tone="slate">Matrícula {child.code}</Badge>}
              {child.bloodType && <Badge tone="slate">Sangre {child.bloodType}</Badge>}
            </div>
            {/* Autorizaciones de la familia (LOPDP): fotos, WhatsApp, datos. */}
            {child.consents && <ConsentBadges consents={child.consents} className="mt-1.5" />}
          </div>
          {canManage && (
            <div className="flex items-center gap-1">
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Editar ficha
              </Button>
              <RowMenu
                label="Más acciones de la ficha"
                items={[
                  {
                    label: child.active ? 'Dar de baja' : 'Reactivar',
                    icon: child.active ? UserMinus : UserPlus,
                    onClick: () => setConfirmActive(true),
                  },
                  {
                    label: 'Eliminar definitivamente',
                    icon: Trash2,
                    danger: true,
                    hidden: !isAdmin,
                    onClick: () => setConfirmDelete(true),
                  },
                ]}
              />
            </div>
          )}
        </div>

        {/* Alertas de salud: siempre visibles, antes que cualquier otra cosa. */}
        {alerts.length > 0 && (
          <div className={`grid gap-px bg-slate-200 dark:bg-white/10 border-t border-slate-200 dark:border-white/10 ${alerts.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>
            {alerts.map((a) => {
              const Icon = a.icon
              return (
                <div
                  key={a.key}
                  role="note"
                  className={`flex items-start gap-2.5 px-5 py-3 ${
                    a.tone === 'red'
                      ? 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200'
                      : 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100'
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">
                    <strong className="block text-xs font-semibold">{a.title}</strong>
                    {a.text}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div
        role="tablist"
        aria-label="Secciones de la ficha"
        className="flex gap-1 mb-5 overflow-x-auto border-b border-slate-200 dark:border-white/10 -mx-1 px-1"
      >
        {TABS.map(([value, label, Icon]) => {
          const active = tab === value
          return (
            <button
              key={value}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(value)}
              className={`relative inline-flex items-center gap-2 px-3 min-h-11 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                active
                  ? 'border-accent text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {value === 'familia' && (
                <span
                  className={`min-w-5 h-5 px-1 rounded-full text-[11px] inline-flex items-center justify-center ${
                    guardians.length
                      ? 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/70'
                      : 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200'
                  }`}
                >
                  {guardians.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'hoy' && <ChildDayTab childId={child.id} child={child} />}
      {tab === 'fotos' && <ChildPhotoHistory childId={child.id} classroomId={child.classroomId || undefined} childName={child.fullName} />}
      {tab === 'ficha' && <ChildProfileTab child={child} onEdit={canManage ? () => setEditing(true) : null} />}
      {tab === 'familia' && <ChildGuardiansTab child={child} onChanged={load} />}
      {tab === 'historial' && <ChildHistoryTab childId={child.id} />}

      {editing && (
        <ChildForm
          child={child}
          onClose={() => {
            setEditing(false)
            load()
          }}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      )}

      {/* Dar de baja / reactivar: no borra nada, la ficha y su historial se conservan. */}
      <ConfirmDialog
        open={confirmActive}
        onClose={() => setConfirmActive(false)}
        variant={child.active ? 'warning' : 'info'}
        loading={savingActive}
        title={child.active ? `¿Dar de baja a ${child.firstName}?` : `¿Reactivar a ${child.firstName}?`}
        message={
          child.active
            ? 'Dejará de aparecer en las listas del día, pero se conservan su ficha y todo su historial. Puedes reactivarlo cuando quieras.'
            : 'Volverá a aparecer en las listas del día de su sala.'
        }
        confirmText={child.active ? 'Dar de baja' : 'Reactivar'}
        onConfirm={() => setActive(!child.active)}
      />

      {confirmDelete && (
        <DeleteChildModal
          child={child}
          onClose={() => setConfirmDelete(false)}
          onDeactivate={
            child.active
              ? async () => {
                  if (await setActive(false)) setConfirmDelete(false)
                }
              : null
          }
          deactivating={savingActive}
          onDeleted={() => navigate('/panel/ninos')}
        />
      )}
    </>
  )
}

/** Mayúsculas, tildes y espacios no cuentan al escribir el nombre para confirmar. */
const foldName = (s) =>
  String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ')

const DELETE_COUNTS = [
  ['attendanceDays', 'día de asistencia', 'días de asistencia'],
  ['meals', 'registro de comidas', 'registros de comidas'],
  ['dailyLogs', 'registro de bitácora', 'registros de bitácora'],
  ['reports', 'reporte diario', 'reportes diarios'],
  ['photos', 'foto', 'fotos'],
  ['consents', 'autorización firmada', 'autorizaciones firmadas'],
  ['justifications', 'justificación de ausencia', 'justificaciones de ausencia'],
]

/**
 * Eliminación definitiva (sólo dirección). Primero ofrece "Dar de baja" (recomendado),
 * muestra lo que se borrará y pide escribir el nombre completo del niño.
 */
function DeleteChildModal({ child, onClose, onDeactivate, deactivating, onDeleted }) {
  const { pushToast } = useToasts()
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const matches = foldName(typed) === foldName(child.fullName)

  useEffect(() => {
    let cancelled = false
    api
      .get(`/children/${child.id}/delete-preview`)
      .then((r) => !cancelled && setPreview(r.data))
      .catch((err) => !cancelled && setPreviewError(apiError(err, 'No se pudo calcular qué se borrará')))
    return () => {
      cancelled = true
    }
  }, [child.id])

  const counts = preview?.counts || {}
  const items = DELETE_COUNTS.filter(([key]) => counts[key] > 0)

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await api.delete(`/children/${child.id}`)
      pushToast({ type: 'success', message: `Se eliminó la ficha de ${child.fullName}` })
      onDeleted()
    } catch (err) {
      setError(apiError(err, 'No se pudo eliminar'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      width="sm"
      title={`¿Eliminar la ficha de ${child.fullName}?`}
      subtitle="La eliminación definitiva no se puede deshacer."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" icon={Trash2} disabled={!matches || !preview} loading={busy} onClick={remove}>
            Eliminar definitivamente
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-600 dark:text-white/65">
        {onDeactivate && (
          <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/4 px-3 py-3">
            <p className="font-semibold text-slate-900 dark:text-white">Recomendado: dar de baja</p>
            <p className="mt-0.5 text-xs">
              Si dejó de asistir, dalo de baja: sale de las listas del día pero se conservan su ficha, asistencia,
              fotos y reportes. Puedes reactivarlo después.
            </p>
            <Button className="mt-2.5" size="sm" icon={UserMinus} loading={deactivating} disabled={busy} onClick={onDeactivate}>
              Dar de baja
            </Button>
          </div>
        )}

        <div>
          <p className="font-medium text-slate-800 dark:text-white/85">Al eliminar definitivamente se borrará:</p>
          {!preview && !previewError ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-white/45" aria-live="polite">
              Calculando…
            </p>
          ) : previewError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
              {previewError}
            </p>
          ) : (
            <ul className="mt-2 rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
              <li className="px-3 py-2 font-medium text-slate-800 dark:text-white/85">Su ficha y datos de salud</li>
              {items.map(([key, one, many]) => (
                <li key={key} className="px-3 py-2 flex items-center justify-between gap-2">
                  <span>{counts[key] === 1 ? one : many}</span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{counts[key]}</span>
                </li>
              ))}
              {!items.length && (
                <li className="px-3 py-2 text-xs text-slate-500 dark:text-white/45">No tiene historial registrado.</li>
              )}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-white/45">
            {counts.guardians
              ? `Se quitará el vínculo con ${counts.guardians === 1 ? 'su representante' : `sus ${counts.guardians} representantes`}; sus cuentas del portal se conservan. `
              : ''}
            Queda registrado en la auditoría.
          </p>
        </div>

        <Field label={`Para confirmar, escribe su nombre completo: ${child.fullName}`}>
          <input
            className={inputClass}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Nombre completo del niño para confirmar"
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** Bloque compacto de un tipo de registro del día. */
function DayBlock({ icon: Icon, title, children, empty }) {
  return (
    <div className="h-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/3 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-2">
        <Icon className="w-4 h-4" />
        {title}
      </p>
      {empty ? <p className="text-sm text-slate-400 dark:text-white/30">{empty}</p> : children}
    </div>
  )
}

/** Pestaña "Hoy": lo mismo que verá la familia en el reporte, antes de enviarlo. */
function ChildDayTab({ childId, child }) {
  const [date, setDate] = useState(todayKey())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  // `silent`: recarga en vivo sin spinner (y si falla, se conserva lo que ya se ve).
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const res = await api.get(`/reports/preview/${childId}`, { params: { date } })
      setData(res.data)
    } catch {
      if (!silent) setData(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [childId, date])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { childId, date })

  const snap = data?.snapshot
  const isToday = date === todayKey()
  const checklist = data?.checklist || snap?.checklist

  return (
    <div className="space-y-5">
      {/* Navegación por días: hoy es lo habitual, pero se puede revisar otro día */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <button
            type="button"
            onClick={() => setDate(addDays(date, -1))}
            className="w-11 h-11 inline-flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-white/10"
            aria-label="Día anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 text-sm font-semibold text-slate-800 dark:text-white capitalize min-w-44 text-center">
            {isToday ? `Hoy · ${shortDate(date)}` : longDate(date)}
          </span>
          <button
            type="button"
            onClick={() => setDate(addDays(date, 1))}
            disabled={isToday}
            className="w-11 h-11 inline-flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-30"
            aria-label="Día siguiente"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <input
          type="date"
          value={date}
          max={todayKey()}
          onChange={(e) => setDate(e.target.value || todayKey())}
          className={`${inputClass} w-auto! min-h-11`}
          aria-label="Elegir fecha"
        />
        {!isToday && (
          <Button variant="ghost" onClick={() => setDate(todayKey())}>
            Volver a hoy
          </Button>
        )}
      </div>

      {loading ? (
        <Card>
          <Loading />
        </Card>
      ) : !snap ? (
        <Card>
          <EmptyState icon={Baby} title="Sin datos de ese día" message="No hay registros para esta fecha." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            {checklist && (
              <Card>
                <SectionTitle hint="Revisa lo pendiente antes de enviar el reporte">
                  Qué se hizo y qué no
                </SectionTitle>
                <DayChecklist checklist={checklist} />
              </Card>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <DayBlock
                icon={LogIn}
                title="Asistencia"
                empty={!snap.arrival && !snap.departure ? 'No asistió ese día.' : null}
              >
                <ul className="text-sm text-slate-700 dark:text-white/75 space-y-1">
                  {snap.arrival && (
                    <li className="flex items-center gap-2">
                      <LogIn className="w-3.5 h-3.5 text-emerald-500" /> Llegó a las{' '}
                      <strong className="tabular-nums">{timeOf(snap.arrival.createdAt)}</strong>
                    </li>
                  )}
                  {snap.departure && (
                    <li className="flex items-center gap-2">
                      <LogOut className="w-3.5 h-3.5 text-sky-500" /> Se retiró a las{' '}
                      <strong className="tabular-nums">{timeOf(snap.departure.createdAt)}</strong>
                    </li>
                  )}
                </ul>
              </DayBlock>

              <DayBlock icon={Utensils} title="Alimentación" empty={!snap.meals?.length ? 'Sin registros.' : null}>
                <ul className="text-sm space-y-1.5 text-slate-700 dark:text-white/75">
                  {snap.meals?.map((m, i) => (
                    <li key={i}>
                      <strong>{m.typeLabel}</strong> · {m.intakeLabel}
                      {m.menu && <span className="block text-xs text-slate-500 dark:text-white/45">{m.menu}</span>}
                      {m.notes && <span className="block text-xs text-slate-400 dark:text-white/35">{m.notes}</span>}
                    </li>
                  ))}
                </ul>
              </DayBlock>

              <DayBlock icon={Moon} title="Descanso" empty={!snap.naps?.length ? 'Sin siestas registradas.' : null}>
                <ul className="text-sm space-y-1 text-slate-700 dark:text-white/75">
                  {snap.naps?.map((n, i) => (
                    <li key={i}>
                      Durmió de {n.from} {n.to ? `a ${n.to}` : ''}{' '}
                      <span className="text-slate-400 dark:text-white/35">({n.minutes} min)</span>
                    </li>
                  ))}
                </ul>
              </DayBlock>

              <DayBlock icon={Palette} title="Actividades" empty={!snap.activities?.length ? 'Sin actividades.' : null}>
                <ul className="text-sm space-y-1 text-slate-700 dark:text-white/75">
                  {snap.activities?.map((a, i) => (
                    <li key={i} className={a.participation === 'absent' ? 'text-slate-400 dark:text-white/40' : ''}>
                      <strong>{a.title}</strong>
                      {a.participation === 'absent' && ' (no participó)'}
                      {a.note && <span className="block text-xs text-slate-500 dark:text-white/45">{a.note}</span>}
                    </li>
                  ))}
                </ul>
              </DayBlock>

              <div className="sm:col-span-2">
                <DayBlock icon={NotebookPen} title="Bitácora" empty={!snap.logs?.length ? 'Sin anotaciones.' : null}>
                  <ul className="text-sm space-y-1.5 text-slate-700 dark:text-white/75">
                    {snap.logs?.map((l, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="tabular-nums text-slate-400 dark:text-white/40">{l.time}</span>
                        <strong>{l.kindLabel}</strong>
                        {l.notifyGuardian && <Badge tone="amber">Avisado a la familia</Badge>}
                        {l.notes && <span className="text-slate-600 dark:text-white/60">— {l.notes}</span>}
                      </li>
                    ))}
                  </ul>
                </DayBlock>
              </div>
            </div>
          </div>

          <Card className="lg:sticky lg:top-20">
            <SectionTitle hint={`${snap.photoUrls?.length || 0} foto(s)`}>Mensaje para la familia</SectionTitle>
            <pre className="whitespace-pre-wrap text-sm rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-4 text-slate-800 dark:text-white/80 font-sans max-h-96 overflow-y-auto">
              {data.messageText}
            </pre>
            {snap.photoUrls?.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-3">
                {snap.photoUrls.map((url) => (
                  <img key={url} src={mediaUrl(url)} alt="" className="aspect-square object-cover rounded-lg" />
                ))}
              </div>
            )}
            <Link to="/panel/reportes" className="block mt-3">
              <Button className="w-full" icon={MessageCircleHeart}>
                Ir a reportes para enviarlo
              </Button>
            </Link>
          </Card>
        </div>
      )}
      {/* Galería del día: lo que verá la familia en su portal. */}
      {!loading && (
        <ChildDayGallery childId={childId} classroomId={child?.classroomId || undefined} childName={child?.fullName} date={date} />
      )}
    </div>
  )
}

function ChildProfileTab({ child, onEdit }) {
  const sections = [
    {
      title: 'Salud',
      icon: HeartPulse,
      items: [
        ['Alergias', child.allergies],
        ['Condiciones médicas', child.medicalConditions],
        ['Medicación habitual', child.medications],
        ['Tipo de sangre', child.bloodType],
        ['Pediatra', [child.pediatricianName, child.pediatricianPhone].filter(Boolean).join(' · ')],
        ['Seguro médico', child.insurance],
      ],
    },
    {
      title: 'Emergencias',
      icon: Phone,
      items: [
        ['Contacto de emergencia', child.emergencyContactName],
        ['Teléfono de emergencia', child.emergencyContactPhone],
      ],
    },
    {
      title: 'Rutinas',
      icon: Utensils,
      items: [
        ['Alimentación', child.dietaryNotes],
        ['Siesta', child.napNotes],
        ['Personas autorizadas a retirar (notas)', child.authorizedPickupNotes],
      ],
    },
    {
      title: 'Datos de inscripción',
      icon: ClipboardList,
      items: [
        ['Fecha de nacimiento', child.birthDate ? shortDate(child.birthDate) : ''],
        ['Género', { m: 'Masculino', f: 'Femenino' }[child.gender] || 'Prefiero no decirlo'],
        ['Cédula', child.documentId ? formatDocumentId(child.documentId) : ''],
        ['Matrícula', child.code],
        ['Fecha de inscripción', child.enrolledAt ? shortDate(child.enrolledAt) : ''],
        ['Notas internas', child.internalNotes],
      ],
    },
  ]

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      {child.consents && <ChildConsentsCard child={child} />}
      {sections.map((s) => {
        const Icon = s.icon
        // Las notas internas se editan aparte: no cuentan como dato por completar.
        const missing = s.items.filter(([label, v]) => !v && label !== 'Notas internas' && label !== 'Cédula').length
        return (
          <Card key={s.title}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-white">
                <Icon className="w-4 h-4 text-slate-400 dark:text-white/40" />
                {s.title}
              </h2>
              {onEdit && missing > 0 && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="text-xs font-medium text-accent-text hover:underline min-h-9"
                >
                  Completar ({missing})
                </button>
              )}
            </div>
            <dl className="divide-y divide-slate-100 dark:divide-white/5">
              {s.items.map(([label, value]) => (
                <div key={label} className="py-2 grid sm:grid-cols-[200px_1fr] gap-x-4 gap-y-0.5">
                  <dt className="text-xs font-semibold text-slate-500 dark:text-white/40 sm:pt-0.5">{label}</dt>
                  <dd
                    className={`text-sm whitespace-pre-wrap ${
                      value ? 'text-slate-800 dark:text-white/80' : 'text-slate-400 dark:text-white/25 italic'
                    }`}
                  >
                    {value || 'Sin dato'}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        )
      })}
    </div>
  )
}

const CONSENT_METHOD = { portal: 'Portal familiar', presencial: 'Formulario en papel' }

/** Estado de cada autorización (LOPDP) con fecha, quién y cómo. Se gestiona en Consentimientos. */
function ChildConsentsCard({ child }) {
  const { canManage } = useAuth()
  const base = `/panel/consentimientos?child=${child.id}`
  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-white">
          <Signature className="w-4 h-4 text-slate-400 dark:text-white/40" aria-hidden="true" />
          Consentimientos
        </h2>
        {canManage && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link to={base} className="inline-flex items-center min-h-9 text-xs font-medium text-accent-text hover:underline">
              Ver historial
            </Link>
            <Link
              to={`${base}&accion=papel`}
              className="inline-flex items-center min-h-9 text-xs font-medium text-accent-text hover:underline"
            >
              Registrar formulario en papel
            </Link>
          </div>
        )}
      </div>
      <dl className="divide-y divide-slate-100 dark:divide-white/5">
        {CONSENT_TYPES.map((t) => {
          const c = child.consents[t]
          const st = statusOf(c)
          const info = typeof c === 'object' && c ? c : {}
          const meta = [
            info.at && formatDateTime(info.at),
            info.method && (CONSENT_METHOD[info.method] || info.method),
            info.by,
            info.version && `texto v${info.version}`,
          ].filter(Boolean)
          return (
            <div key={t} className="py-2 grid sm:grid-cols-[200px_auto_1fr] items-center gap-x-4 gap-y-1">
              <dt className="text-xs font-semibold text-slate-500 dark:text-white/40">{CONSENT_LABEL[t]}</dt>
              <dd>
                <ConsentBadge type={t} status={c} />
              </dd>
              <dd className="text-xs text-slate-500 dark:text-white/45 tabular-nums">
                {st === 'pending' && !info.at
                  ? 'La familia aún no responde.'
                  : meta.join(' · ')}
                {info.outdated ? ' · Texto actualizado: falta renovar' : ''}
              </dd>
            </div>
          )
        })}
      </dl>
    </Card>
  )
}

const LINK_FLAGS = [
  ['canPickup', 'Puede retirar'],
  ['receivesReport', 'Recibe el reporte'],
  ['isPrimary', 'Contacto principal'],
]

/** Interruptor con texto: el estado se lee sin depender del color. */
function FlagToggle({ checked, label, disabled, busy, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 pl-1.5 pr-3 min-h-10 rounded-full border text-xs font-semibold transition disabled:cursor-not-allowed ${
        checked
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
          : 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-white/50'
      } ${disabled ? 'opacity-70' : 'hover:shadow-sm'} ${busy ? 'opacity-60' : ''}`}
    >
      <span
        className={`relative w-8 h-5 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
      {label}: {checked ? 'Sí' : 'No'}
    </button>
  )
}

function ChildGuardiansTab({ child, onChanged }) {
  const { pushToast } = useToasts()
  const { canManage } = useAuth()
  const [adding, setAdding] = useState(null) // 'new' | 'existing'
  const [credentials, setCredentials] = useState(null)
  const [busy, setBusy] = useState(null)
  const [toRemove, setToRemove] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [resetting, setResetting] = useState(null)

  const guardians = child.guardians || []
  const pickups = guardians.filter((g) => g.canPickup)

  const toggle = async (link, key, value) => {
    setBusy(`${link.linkId}:${key}`)
    try {
      await api.patch(`/children/${child.id}/guardians/${link.linkId}`, { [key]: value })
      pushToast({ type: 'success', message: 'Cambio guardado' })
      onChanged()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setBusy(null)
    }
  }

  const resetAccess = async (link) => {
    setResetting(link.guardianId)
    try {
      const res = await api.post(`/children/guardians/${link.guardianId}/reset-access`)
      setCredentials([res.data])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setResetting(null)
    }
  }

  const remove = async () => {
    setRemoving(true)
    try {
      await api.delete(`/children/${child.id}/guardians/${toRemove.linkId}`)
      pushToast({ type: 'success', message: `${toRemove.name} ya no está vinculado a ${child.firstName}` })
      setToRemove(null)
      onChanged()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle hint="Reciben el reporte diario y entran al portal familiar">Representantes</SectionTitle>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={Link2} onClick={() => setAdding('existing')}>
                  Vincular existente
                </Button>
                <Button icon={UserPlus} onClick={() => setAdding('new')}>
                  Añadir representante
                </Button>
              </div>
            )}
          </div>

          {guardians.length === 0 ? (
            <Card>
              <EmptyState
                icon={UserPlus}
                title="Sin representantes registrados"
                message="Sin al menos uno con WhatsApp, este niño no recibirá el reporte diario."
                action={
                  canManage && (
                    <Button icon={UserPlus} onClick={() => setAdding('new')}>
                      Añadir representante
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            guardians.map((g) => {
              const email = realEmail(g.email)
              const access = !g.active
                ? ['Cuenta desactivada', 'slate']
                : !email
                  ? ['Sin acceso al portal', 'slate']
                  : g.hasAccount
                    ? ['Con acceso al portal', 'green']
                    : ['Clave temporal sin usar', 'amber']
              return (
                <Card key={g.linkId}>
                  <div className="flex items-start gap-3">
                    <Avatar name={g.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
                        {g.name}
                        {g.relationship && (
                          <span className="font-normal text-sm text-slate-500 dark:text-white/50">· {g.relationship}</span>
                        )}
                        {g.isPrimary && <Badge tone="accent">Principal</Badge>}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm">
                        {g.phone ? (
                          <a
                            href={`tel:${g.phone}`}
                            className="inline-flex items-center gap-1.5 text-slate-700 dark:text-white/75 hover:text-accent-text"
                          >
                            <Phone className="w-3.5 h-3.5" /> {g.phone}
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                            <Phone className="w-3.5 h-3.5" /> Sin WhatsApp: no recibe el reporte
                          </span>
                        )}
                        {email && (
                          <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-white/50 break-all">
                            <Mail className="w-3.5 h-3.5 shrink-0" /> {email}
                          </span>
                        )}
                        {g.documentId && (
                          <span className="text-slate-400 dark:text-white/35">Cédula {g.documentId}</span>
                        )}
                      </div>
                      <div className="mt-1.5">
                        <Badge tone={access[1]}>
                          <KeyRound className="w-3 h-3" /> {access[0]}
                        </Badge>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="hidden sm:inline-flex">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={KeyRound}
                            loading={resetting === g.guardianId}
                            onClick={() => resetAccess(g)}
                            className="min-h-9"
                          >
                            Restablecer acceso
                          </Button>
                        </span>
                        <RowMenu
                          label={`Acciones para ${g.name}`}
                          items={[
                            {
                              label: 'Restablecer acceso',
                              icon: KeyRound,
                              onClick: () => resetAccess(g),
                              className: 'sm:hidden',
                            },
                            {
                              label: 'Quitar de este niño',
                              icon: UserMinus,
                              danger: true,
                              onClick: () => setToRemove(g),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                    {LINK_FLAGS.map(([key, label]) => (
                      <FlagToggle
                        key={key}
                        label={label}
                        checked={!!g[key]}
                        disabled={!canManage}
                        busy={busy === `${g.linkId}:${key}`}
                        onChange={(v) => toggle(g, key, v)}
                      />
                    ))}
                  </div>
                </Card>
              )
            })
          )}
        </div>

        {/* Quién puede retirar: lo que se consulta en la puerta. */}
        <Card className="lg:sticky lg:top-20">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-white mb-3">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            Quién puede retirar
          </h2>
          {pickups.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              Ningún representante tiene permiso para retirar a {child.firstName}.
            </p>
          ) : (
            <ul className="space-y-2">
              {pickups.map((g) => (
                <li key={g.linkId} className="flex items-center gap-2.5">
                  <Avatar name={g.name} size="xs" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{g.name}</p>
                    <p className="text-xs text-slate-500 dark:text-white/45">
                      {[g.relationship, g.documentId && `Cédula ${g.documentId}`].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {child.authorizedPickupNotes && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-1">
                Otras personas autorizadas
              </p>
              <p className="text-sm text-slate-700 dark:text-white/70 whitespace-pre-wrap">{child.authorizedPickupNotes}</p>
            </div>
          )}
        </Card>
      </div>

      {adding && (
        <AddGuardianModal
          childId={child.id}
          initialMode={adding}
          existingIds={guardians.map((g) => g.guardianId)}
          onClose={() => setAdding(null)}
          onSaved={(creds) => {
            setAdding(null)
            onChanged()
            if (creds?.tempPassword) setCredentials([creds])
          }}
        />
      )}

      <ConfirmDialog
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        loading={removing}
        variant="warning"
        icon={UserMinus}
        title={`¿Quitar a ${toRemove?.name}?`}
        message={`Dejará de recibir el reporte de ${child.firstName} y no lo verá en el portal. Su cuenta no se borra.`}
        confirmText="Quitar"
        onConfirm={remove}
      />

      {credentials && (
        <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
      )}
    </>
  )
}

const EXISTING_ACCOUNT_MSG =
  'Este representante ya tiene acceso al portal. Si no recuerda su contraseña, usa «Restablecer acceso».'

function AddGuardianModal({ childId, existingIds = [], initialMode = 'new', onClose, onSaved }) {
  const { pushToast } = useToasts()
  const { canManage } = useAuth()
  const [mode, setMode] = useState(initialMode)
  const [picked, setPicked] = useState(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    documentId: '',
    relationship: '',
    isPrimary: false,
    canPickup: true,
    receivesReport: true,
    createAccount: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  const linking = mode === 'existing'

  const submit = async (e) => {
    e?.preventDefault()
    if (linking && !picked) {
      setError('Elige un representante de la lista.')
      return
    }
    if (!linking && form.name.trim().length < 3) {
      setError('Escribe el nombre del representante (mínimo 3 letras).')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = linking
        ? {
            guardianId: picked.id,
            relationship: form.relationship,
            isPrimary: form.isPrimary,
            canPickup: form.canPickup,
            receivesReport: form.receivesReport,
          }
        : { ...form, email: form.email || undefined }
      const res = await api.post(`/children/${childId}/guardians`, payload)
      const creds = res.data?.credentials || null
      const existing = !!(res.data?.existingAccount || creds?.existingAccount)
      pushToast({ type: 'success', message: 'Representante enlazado' })
      if (existing) pushToast({ type: 'info', message: EXISTING_ACCOUNT_MSG, duration: 8000 })
      onSaved(creds)
    } catch (err) {
      setError(apiError(err, 'No se pudo enlazar'))
    } finally {
      setSaving(false)
    }
  }

  const flags = [
    ['isPrimary', 'Contacto principal'],
    ['canPickup', 'Puede retirar'],
    ['receivesReport', 'Recibe reporte'],
    ...(linking ? [] : [['createAccount', 'Crear acceso al portal']]),
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title={linking ? 'Vincular representante existente' : 'Añadir representante'}
      subtitle={linking ? 'Para hermanos: usa la misma cuenta del portal.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} icon={linking ? Link2 : Plus}>
            {linking ? 'Vincular' : 'Añadir'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        {canManage && (
          <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-white/5" role="tablist">
            {[
              ['new', 'Nuevo representante', UserPlus],
              ['existing', 'Vincular existente', Link2],
            ].map(([value, label, Icon]) => (
              <button
                type="button"
                key={value}
                role="tab"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value)
                  setError('')
                }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 min-h-10 rounded-lg text-xs font-semibold transition ${
                  mode === value
                    ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        )}

        {linking ? (
          <>
            <p className="text-xs text-slate-500 dark:text-white/40">
              Úsalo para hermanos: el representante conserva su misma cuenta del portal y verá a
              todos sus niños.
            </p>
            <GuardianPicker value={picked} onChange={setPicked} excludeIds={existingIds} />
            <Field label="Parentesco con este niño">
              <input className={inputClass} value={form.relationship} onChange={set('relationship')} placeholder="Madre, padre, abuela…" />
            </Field>
          </>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Nombre" required>
                <input className={inputClass} value={form.name} onChange={set('name')} required autoFocus />
              </Field>
              <Field label="Parentesco">
                <input className={inputClass} value={form.relationship} onChange={set('relationship')} placeholder="Madre, padre, abuela…" />
              </Field>
              <Field label="WhatsApp" hint="Sin número no recibe el reporte.">
                <input className={inputClass} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="0987654321" />
              </Field>
              <Field label="Cédula">
                <input className={inputClass} value={form.documentId} onChange={set('documentId')} />
              </Field>
            </div>
            <Field label="Correo" hint="Necesario para entrar al portal familiar.">
              <input className={inputClass} type="email" value={form.email} onChange={set('email')} />
            </Field>
          </>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {flags.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 min-h-9 text-sm text-slate-600 dark:text-white/60">
              <input type="checkbox" className="w-4 h-4 accent-accent" checked={form[key]} onChange={set(key)} />
              {label}
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

function ChildHistoryTab({ childId }) {
  const { pushToast } = useToasts()
  const [from, setFrom] = useState(addDays(todayKey(), -30))
  const [to, setTo] = useState(todayKey())
  const [records, setRecords] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const [a, r] = await Promise.all([
        api.get(`/attendance/children/${childId}`, { params: { from, to } }),
        api.get('/reports/daily', { params: { childId } }),
      ])
      setRecords(a.data || [])
      setReports(r.data || [])
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el historial') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [childId, from, to, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['attendance', 'report', 'justification'], childId }, { debounceMs: 1500 })

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <SectionTitle>Entradas y salidas</SectionTitle>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-white/40">
            <input type="date" aria-label="Desde" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-auto!`} />
            <span>a</span>
            <input type="date" aria-label="Hasta" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-auto!`} />
          </div>
        </div>
        {loading ? (
          <Loading />
        ) : records.length === 0 ? (
          <EmptyState icon={Baby} title="Sin registros en ese rango" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {records.map((r) => (
              <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0 ${
                      r.type === 'in'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                    }`}
                  >
                    {r.type === 'in' ? <LogIn className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">
                      {r.type === 'in' ? 'Llegada' : 'Retiro'} · <span className="tabular-nums">{timeOf(r.createdAt)}</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-white/40">
                      {shortDate(r.date)}
                      {r.personName ? ` · ${r.personName}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {r.scheduleStatus === 'late_arrival' && <Badge tone="amber">Tarde</Badge>}
                  {r.scheduleStatus === 'late_pickup' && <Badge tone="amber">Retiro tardío</Badge>}
                  {r.flagged && <Badge tone="red">Señalado</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle hint={`${reports.length} reporte(s)`}>Reportes a la familia</SectionTitle>
        {reports.length === 0 ? (
          <EmptyState icon={MessageCircleHeart} title="Todavía no se ha enviado ningún reporte" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {reports.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{shortDate(r.date)}</p>
                  <Badge tone={r.status === 'sent' ? 'green' : r.status === 'ready' ? 'amber' : 'slate'}>
                    {r.status === 'sent' ? 'Enviado' : r.status === 'ready' ? 'Listo para enviar' : 'Borrador'}
                  </Badge>
                </div>
                {r.sentTo && <p className="text-xs text-slate-400 dark:text-white/30">Enviado a {r.sentTo}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
