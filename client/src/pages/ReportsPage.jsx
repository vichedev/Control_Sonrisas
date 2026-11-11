import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  WhatsappLogo,
  WifiOff,
  MessageCircleHeart,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from '../components/icons'
import { api, apiError, longDate, mediaUrl, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import DayFilters from '../components/DayFilters'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { Avatar, Badge, Button, Card, EmptyState, inputClass, Loading, PageHeader } from '../components/ui'

const STATUS = {
  draft: { label: 'Borrador', tone: 'slate' },
  ready: { label: 'Listo para enviar', tone: 'sky' },
  sent: { label: 'Enviado', tone: 'green' },
  error: { label: 'Error al enviar', tone: 'rose' },
}

/** A dónde ir para completar cada grupo del checklist. */
const GROUP_LINK = {
  attendance: { to: '/panel/dia', label: 'Entradas' },
  meals: { to: '/panel/comidas', label: 'Alimentación' },
  rest: { to: '/panel/bitacora', label: 'Bitácora' },
  care: { to: '/panel/bitacora', label: 'Bitácora' },
  health: { to: '/panel/bitacora', label: 'Bitácora' },
  activities: { to: '/panel/actividades', label: 'Actividades' },
}
const isMissing = (item) => item.status === 'pending' || item.status === 'not_recorded'

/** Texto de WhatsApp con *negritas* como en el teléfono. */
function WaText({ text }) {
  const parts = String(text || '').split(/(\*[^*\n]+\*)/g)
  return parts.map((p, i) =>
    p.startsWith('*') && p.endsWith('*') && p.length > 2 ? (
      <strong key={i}>{p.slice(1, -1)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

/**
 * Reportes diarios a las familias, como un cierre del día en 4 pasos:
 * revisar pendientes → generar → revisar el texto → enviar.
 *
 * El envío sale SIEMPRE por el WhatsApp vinculado del centro (o la Cloud API): nunca se
 * abren pestañas ni enlaces wa.me. Si no está conectado, se avisa y los reportes quedan
 * listos para enviarlos cuando se conecte.
 */
export default function ReportsPage() {
  const { pushToast } = useToasts()
  const { isAdmin } = useAuth()

  const [date, setDate] = useState(todayKey())
  const [classroomId, setClassroomId] = useState('')
  const [reports, setReports] = useState([])
  const [kids, setKids] = useState([])
  // GET /whatsapp/provider → { provider, configured, canSend, connected, linked }
  const [wa, setWa] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // 'generate' | 'send' | null
  const [openId, setOpenId] = useState(null)
  const [confirmForce, setConfirmForce] = useState(false)
  const [failures, setFailures] = useState({}) // reportId → mensaje
  const [sendingIds, setSendingIds] = useState([])
  const [delivery, setDelivery] = useState({}) // reportId → [{ name, phone, status, error }]
  const [summary, setSummary] = useState(null)
  const [showPending, setShowPending] = useState(null) // null = automático

  // `silent`: recarga en vivo, sin spinner ni toasts. Las tarjetas en edición conservan
  // su texto (estado local de ReportCard, con key = id), así que nunca se pisa lo escrito.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const params = { date, classroomId: classroomId || undefined }
      const [rep, chk] = await Promise.all([
        api.get('/reports/daily', { params }),
        api.get('/reports/checklists', { params }).catch(() => ({ data: { children: [] } })),
      ])
      setReports(rep.data || [])
      setKids(chk.data?.children || [])
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar los reportes') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [date, classroomId, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, {
    entities: ['report', 'attendance', 'meal', 'daily_log', 'activity'],
    date,
    classroomId: classroomId || undefined,
  })

  // Estado del WhatsApp del centro: al entrar, al volver a la pestaña y cada 30 s.
  const loadWa = useCallback(() => {
    api.get('/whatsapp/provider').then((r) => setWa(r.data || {})).catch(() => setWa((w) => w || { canSend: false }))
  }, [])
  useEffect(() => {
    loadWa()
    const timer = setInterval(() => !document.hidden && loadWa(), 30000)
    document.addEventListener('visibilitychange', loadWa)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', loadWa)
    }
  }, [loadWa])

  const provider = wa?.provider || 'linked'
  // Compatibilidad: un backend sin `canSend` se considera listo salvo en manual.
  const canSend = wa ? (wa.canSend ?? provider !== 'manual') : true
  const linkedPhone = wa?.linked?.phone ? `+${String(wa.linked.phone).replace(/^\+/, '')}` : ''

  const generateAll = async (force = false) => {
    setBusy('generate')
    try {
      const res = await api.post('/reports/generate', {
        date,
        classroomId: classroomId || undefined,
        force: force === true ? true : undefined,
      })
      const skipped = res.data?.skipped || 0
      pushToast({
        type: 'success',
        title: `${res.data?.generated ?? 0} reporte(s) generados`,
        message: skipped
          ? `${skipped} no se regeneraron porque ya se enviaron o se editaron a mano.`
          : 'Revisa el texto de cada uno y envíalos.',
      })
      load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron generar') })
    } finally {
      setBusy(null)
    }
  }

  const clearFailure = (id) =>
    setFailures((f) => {
      if (!f[id]) return f
      const next = { ...f }
      delete next[id]
      return next
    })

  const sendOne = async (report) => {
    setSendingIds((l) => [...l, report.id])
    try {
      // Con el WhatsApp vinculado cada mensaje tarda unos segundos: más margen que los 60 s por defecto.
      const path = report.status === 'sent' ? 'resend-failed' : 'send'
      const res = await api.post(`/reports/daily/${report.id}/${path}`, undefined, { timeout: 120000 })
      clearFailure(report.id)
      const results = res.data?.results || []
      setDelivery((d) => ({ ...d, [report.id]: results }))
      const failed = results.filter((r) => r.status === 'failed')
      pushToast({
        type: failed.length ? 'warning' : 'success',
        title: `Reporte de ${report.childName} enviado`,
        message: failed.length
          ? `No llegó a: ${failed.map((r) => `${r.name || r.phone} (${r.error || 'falló'})`).join('; ')}`
          : undefined,
        duration: failed.length ? 8000 : undefined,
      })
      load()
    } catch (err) {
      const msg = apiError(err, 'No se pudo enviar')
      const results = err?.response?.data?.results
      if (Array.isArray(results)) setDelivery((d) => ({ ...d, [report.id]: results }))
      setFailures((f) => ({ ...f, [report.id]: msg }))
      loadWa()
      pushToast({ type: 'error', message: msg, duration: 8000 })
      // "Ya se envió" u otro estado cambiado por otra persona: refrescar la lista.
      if (err?.response?.status === 400) load()
    } finally {
      setSendingIds((l) => l.filter((x) => x !== report.id))
    }
  }

  const sendAll = async () => {
    setBusy('send')
    setSummary(null)
    try {
      // Puede tardar minutos (unos segundos por mensaje con el WhatsApp vinculado).
      const res = await api.post(
        '/reports/send-day',
        { date, classroomId: classroomId || undefined },
        { timeout: 10 * 60 * 1000 },
      )
      const results = res.data?.results || []
      const ok = results.filter((r) => r.report)
      const failedItems = results.filter((r) => !r.report && r.error)
      setDelivery((d) => {
        const next = { ...d }
        ok.forEach((r) => (next[r.report.id] = r.results || []))
        failedItems.forEach((r) => r.reportId && (next[r.reportId] = r.results || []))
        return next
      })
      setFailures((f) => {
        const next = { ...f }
        ok.forEach((r) => delete next[r.report.id])
        failedItems.forEach((r) => {
          if (r.reportId) next[r.reportId] = r.error
        })
        return next
      })
      const total = res.data?.total ?? results.length
      const sent = res.data?.sent ?? ok.length
      const failed = res.data?.failed ?? failedItems.length
      setSummary({ total, sent, failed, failedItems })
      pushToast({
        type: failed ? 'warning' : 'success',
        title: `${sent} de ${total} reporte(s) enviados${failed ? ` · ${failed} con error` : ''}`,
        duration: failed ? 9000 : undefined,
      })
      load()
      loadWa()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo enviar en bloque') })
    } finally {
      setBusy(null)
    }
  }

  // ----- Estado del cierre del día
  const presentKids = kids.filter((k) => k.attendance?.status !== 'absent')
  const absentKids = kids.filter((k) => k.attendance?.status === 'absent')
  const kidsWithMissing = presentKids
    .map((k) => ({ ...k, missing: (k.checklist?.items || []).filter(isMissing) }))
    .filter((k) => k.missing.length)
  const reportByChild = useMemo(() => new Map(reports.map((r) => [r.childId, r])), [reports])
  const notGenerated = presentKids.filter((k) => !reportByChild.has(k.child.id))
  const counts = {
    total: reports.length,
    draft: reports.filter((r) => r.status === 'draft').length,
    ready: reports.filter((r) => r.status === 'ready').length,
    sent: reports.filter((r) => r.status === 'sent').length,
  }

  const steps = [
    {
      title: 'Revisar pendientes',
      done: presentKids.length > 0 && kidsWithMissing.length === 0,
      status:
        presentKids.length === 0
          ? 'Nadie con llegada registrada'
          : kidsWithMissing.length
            ? `${kidsWithMissing.length} ${kidsWithMissing.length === 1 ? 'niño' : 'niños'} con datos por registrar`
            : 'Todo registrado',
      warn: kidsWithMissing.length > 0,
    },
    {
      title: 'Generar',
      done: presentKids.length > 0 && notGenerated.length === 0,
      status: `${presentKids.length - notGenerated.length} de ${presentKids.length} generados`,
    },
    {
      title: 'Revisar texto',
      done: counts.total > 0 && counts.ready + counts.draft === 0,
      status: counts.ready + counts.draft ? `${counts.ready + counts.draft} por revisar` : 'Nada por revisar',
    },
    {
      title: 'Enviar',
      done: counts.total > 0 && counts.sent === counts.total,
      status: `${counts.sent} de ${counts.total} enviados`,
    },
  ]
  // Paso actual. El 1 es orientativo (no bloquea); 3 y 4 se hacen juntos en cada tarjeta.
  const unsent = counts.total - counts.sent
  const current = notGenerated.length
    ? kidsWithMissing.length
      ? 0
      : 1
    : unsent > 0
      ? 2
      : -1
  const pendingOpen = showPending ?? (kidsWithMissing.length > 0 && counts.total === 0)

  const nextAction =
    notGenerated.length > 0
      ? { label: `Generar reportes (${notGenerated.length})`, icon: Sparkles, onClick: () => generateAll(), loading: busy === 'generate' }
      : counts.ready > 0
        ? canSend
          ? { label: `Enviar los ${counts.ready} listos`, icon: Send, onClick: sendAll, loading: busy === 'send' }
          : null
        : null

  return (
    <>
      <PageHeader
        title="Reportes a las familias"
        subtitle={longDate(date)}
        icon={MessageCircleHeart}
        actions={
          <>
            <DayFilters
              date={date}
              onDateChange={setDate}
              classroomId={classroomId}
              onClassroomChange={setClassroomId}
            />
            <Button variant="ghost" icon={RefreshCw} onClick={load} aria-label="Actualizar" />
          </>
        }
      />

      {/* Pasos del cierre del día */}
      <ol className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-5" aria-label="Cierre del día">
        {steps.map((s, i) => {
          const isCurrent = i === current || (current === 2 && i === 3)
          return (
            <li
              key={s.title}
              aria-current={isCurrent ? 'step' : undefined}
              className={`rounded-xl border p-3 flex items-start gap-3 transition ${
                isCurrent
                  ? 'border-accent/40 bg-accent-soft ring-1 ring-accent/30'
                  : s.done
                    ? 'border-slate-200 dark:border-white/8 bg-white dark:bg-surface'
                    : 'border-slate-200 dark:border-white/8 bg-white dark:bg-surface'
              }`}
            >
              <span
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  s.done
                    ? 'bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : isCurrent
                      ? 'bg-accent text-accent-fg'
                      : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60'
                }`}
              >
                {s.done ? <Check className="w-4 h-4" aria-label="Hecho" /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-white">{s.title}</p>
                <p
                  className={`text-xs ${
                    s.warn ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-white/50'
                  }`}
                >
                  {s.status}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      {loading && !reports.length && !kids.length ? (
        <Card>
          <Loading />
        </Card>
      ) : (
        <div className="space-y-5">
          {/* 1. Pendientes por niño */}
          <Card padded={false}>
            <button
              type="button"
              onClick={() => setShowPending(!pendingOpen)}
              aria-expanded={pendingOpen}
              className="w-full flex items-center gap-3 p-4 text-left"
            >
              <StepDot>1</StepDot>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-white">
                  Revisar lo que falta registrar
                </p>
                <p className="text-xs text-slate-500 dark:text-white/50">
                  {kidsWithMissing.length
                    ? `${kidsWithMissing.length} de ${presentKids.length} niños presentes tienen algo sin registrar. Puedes generar igual.`
                    : presentKids.length
                      ? `Los ${presentKids.length} niños presentes tienen su día completo.`
                      : 'Todavía no hay niños con llegada registrada este día.'}
                </p>
              </div>
              {kidsWithMissing.length > 0 ? (
                <Badge tone="amber">
                  <AlertTriangle className="w-3 h-3" /> {kidsWithMissing.length} pendientes
                </Badge>
              ) : (
                presentKids.length > 0 && (
                  <Badge tone="green">
                    <CheckCircle2 className="w-3 h-3" /> Completo
                  </Badge>
                )
              )}
              <ChevronDown
                className={`w-4 h-4 text-slate-400 transition ${pendingOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {pendingOpen && (
              <div className="border-t border-slate-100 dark:border-white/5 px-4 pb-4">
                {kidsWithMissing.length > 0 && (
                  <ul className="divide-y divide-slate-100 dark:divide-white/5">
                    {kidsWithMissing.map((k) => {
                      const links = [
                        ...new Map(
                          k.missing.map((m) => GROUP_LINK[m.group]).filter(Boolean).map((l) => [l.to, l]),
                        ).values(),
                      ]
                      return (
                        <li key={k.child.id} className="py-3 flex flex-wrap items-start gap-3">
                          <Avatar src={k.child.photoUrl} name={k.child.name} size="sm" />
                          <div className="flex-1 min-w-48">
                            <p className="text-sm font-semibold text-slate-800 dark:text-white">{k.child.name}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {k.missing.map((m) => (
                                <Badge key={m.key} tone="amber">
                                  Falta: {m.label}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {links.map((l) => (
                              <Link
                                key={l.to}
                                to={l.to}
                                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/10"
                              >
                                Ir a {l.label}
                              </Link>
                            ))}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {absentKids.length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-white/40 mt-3">
                    Sin llegada (no reciben reporte):{' '}
                    {absentKids.map((k) => k.child.name).join(', ')}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* 2. Generar */}
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <StepDot>2</StepDot>
              <div className="flex-1 min-w-56">
                <p className="text-sm font-semibold text-slate-800 dark:text-white">Generar los reportes</p>
                <p className="text-xs text-slate-500 dark:text-white/50">
                  Se arman con la asistencia, las comidas, las actividades y la bitácora.{' '}
                  {notGenerated.length > 0
                    ? `Faltan ${notGenerated.length} por generar.`
                    : presentKids.length
                      ? 'Todos generados.'
                      : ''}
                </p>
              </div>
              <Button
                variant={notGenerated.length ? 'primary' : 'secondary'}
                icon={Sparkles}
                onClick={() => generateAll()}
                loading={busy === 'generate'}
                disabled={busy === 'send'}
                className="min-h-11"
              >
                {counts.total ? 'Actualizar reportes' : 'Generar reportes del día'}
              </Button>
              {reports.length > 0 && (
                <Button variant="ghost" onClick={() => setConfirmForce(true)} disabled={!!busy}>
                  Regenerar igualmente
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-400 dark:text-white/30 mt-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>
                {provider === 'cloud'
                  ? 'Envío automático por WhatsApp (Cloud API).'
                  : canSend
                    ? `Se envían desde el WhatsApp del centro${linkedPhone ? ` (${linkedPhone})` : ''}.`
                    : 'El WhatsApp del centro no está conectado: puedes generar y revisar, y enviar cuando se conecte.'}{' '}
                «Actualizar» no pisa los textos editados a mano ni los ya enviados.
              </span>
            </p>
          </Card>

          {/* 3 y 4. Revisar y enviar */}
          <section>
            {!canSend && <WhatsappOffBanner isAdmin={isAdmin} pending={counts.ready} />}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <StepDot>3</StepDot>
              <StepDot>4</StepDot>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-white flex-1">
                Revisar y enviar{' '}
                <span className="font-normal text-slate-500 dark:text-white/40">
                  · {counts.ready} listos · {counts.sent} enviados
                </span>
              </h2>
              {counts.ready > 0 && (
                <Button icon={Send} onClick={sendAll} loading={busy === 'send'} disabled={busy === 'generate' || !canSend} className="min-h-11">
                  Enviar todos los listos ({counts.ready})
                </Button>
              )}
            </div>

            {busy === 'send' && (
              <div className="mb-3 rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-surface p-3">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Enviando {counts.ready} reportes… no cierres esta pantalla.
                </p>
                <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
                  Puede tardar unos minutos: cada mensaje sale con unos segundos de pausa.
                </p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-accent animate-pulse" />
                </div>
              </div>
            )}

            {summary && (
              <div
                className={`mb-3 rounded-xl border p-3 ${
                  summary.failed
                    ? 'border-amber-200 dark:border-amber-400/25 bg-amber-50 dark:bg-amber-500/10'
                    : 'border-emerald-200 dark:border-emerald-400/20 bg-emerald-50 dark:bg-emerald-500/10'
                }`}
                role="status"
              >
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm font-semibold text-slate-800 dark:text-white">
                    {summary.sent} de {summary.total} enviados
                    {summary.failed ? ` · ${summary.failed} con error` : ' · ¡listo!'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSummary(null)}
                    aria-label="Cerrar resumen"
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {summary.failedItems.length > 0 && (
                  <ul className="mt-1 text-sm text-amber-900 dark:text-amber-100 list-disc pl-5">
                    {summary.failedItems.map((f) => (
                      <li key={f.reportId || f.childName}>
                        <strong>{f.childName}</strong>: {f.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {reports.length === 0 ? (
              <Card>
                <EmptyState
                  icon={MessageCircleHeart}
                  title="Todavía no hay reportes de este día"
                  message="Genéralos cuando el día esté registrado (paso 2)."
                  action={
                    <Button icon={Sparkles} onClick={() => generateAll()} loading={busy === 'generate'}>
                      Generar ahora
                    </Button>
                  }
                />
              </Card>
            ) : (
              <div className="grid lg:grid-cols-2 gap-4">
                {reports.map((r) => (
                  <ReportCard
                    key={r.id}
                    report={r}
                    error={failures[r.id]}
                    sending={sendingIds.includes(r.id) || busy === 'send'}
                    canSend={canSend}
                    delivery={delivery[r.id]}
                    onSend={() => sendOne(r)}
                    onOpen={() => setOpenId(r.id)}
                    onSaved={load}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Siguiente paso al alcance del pulgar en móvil */}
      {nextAction && (
        <>
          <div className="h-20 sm:hidden" aria-hidden />
          <div className="sm:hidden fixed bottom-(--bottom-nav-h) inset-x-0 z-30 p-3 bg-white/95 dark:bg-elevated/95 backdrop-blur-md border-t border-slate-200 dark:border-white/10">
            <Button
              icon={nextAction.icon}
              onClick={nextAction.onClick}
              loading={nextAction.loading}
              disabled={!!busy}
              className="w-full min-h-12"
            >
              {nextAction.label}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmForce}
        onClose={() => setConfirmForce(false)}
        variant="warning"
        title="¿Regenerar todos los reportes del día?"
        message="Se volverán a armar también los reportes editados a mano: los cambios manuales en el texto se perderán. Los reportes ya enviados no se tocan."
        confirmText="Regenerar igualmente"
        loading={busy === 'generate'}
        onConfirm={async () => {
          setConfirmForce(false)
          await generateAll(true)
        }}
      />

      {openId && (
        <ReportDetail
          id={openId}
          onClose={() => setOpenId(null)}
          canSend={canSend}
          onSend={(report) => {
            setOpenId(null)
            sendOne(report)
          }}
        />
      )}
    </>
  )
}

/** Aviso cuando el WhatsApp del centro no puede enviar (nunca se abren enlaces). */
function WhatsappOffBanner({ isAdmin, pending }) {
  return (
    <div role="status" className="mb-3 flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
      <span className="shrink-0 w-9 h-9 rounded-lg bg-white/70 dark:bg-white/10 text-amber-700 dark:text-amber-300 flex items-center justify-center">
        <WifiOff className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-56">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {isAdmin ? 'Conecta el WhatsApp del centro para enviar' : 'El WhatsApp del centro no está conectado'}
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-200/80 mt-0.5">
          {isAdmin
            ? 'Los reportes se envían desde el número vinculado del centro. '
            : 'Pide a dirección que conecte el WhatsApp del centro. '}
          {pending > 0
            ? `Los ${pending} reportes listos quedan guardados y se envían cuando se conecte.`
            : 'Puedes generar y revisar los reportes mientras tanto.'}
        </p>
      </div>
      {isAdmin && (
        <Link
          to="/panel/ajustes/whatsapp"
          className="inline-flex items-center gap-2 min-h-10 px-3.5 rounded-lg bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          <WhatsappLogo className="w-4 h-4" /> Conectar WhatsApp
        </Link>
      )}
    </div>
  )
}

const DELIVERY = {
  sent: { label: 'Enviado', tone: 'green' },
  queued: { label: 'En cola', tone: 'sky' },
  failed: { label: 'No llegó', tone: 'red' },
  manual_pending: { label: 'Pendiente', tone: 'amber' },
}

/** Resultado por familia del último envío (en esta sesión). */
function DeliveryList({ results }) {
  if (!results?.length) return null
  return (
    <ul className="mt-2 space-y-1" aria-label="Resultado por familia">
      {results.map((r) => {
        const st = DELIVERY[r.status] || DELIVERY.failed
        return (
          <li key={r.guardianId || r.phone} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="text-slate-700 dark:text-white/75">{r.name || r.phone}</span>
            {r.status === 'failed' && r.error && <span className="text-red-600 dark:text-red-400">· {r.error}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function StepDot({ children }) {
  return (
    <span className="shrink-0 w-6 h-6 rounded-full bg-slate-800 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold flex items-center justify-center">
      {children}
    </span>
  )
}

/** Tarjeta de un reporte: estado, vista previa del WhatsApp, edición en línea y envío. */
function ReportCard({ report, error, sending, canSend, delivery, onSend, onOpen, onSaved }) {
  const { pushToast } = useToasts()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState(report.messageText || '')
  const [note, setNote] = useState(report.teacherNote || '')
  const [saving, setSaving] = useState(false)

  const sent = report.status === 'sent'
  const someFailed = sent && (delivery || []).some((r) => r.status === 'failed')
  const status = error && !sent ? STATUS.error : STATUS[report.status] || STATUS.draft
  const textChanged = text !== (report.messageText || '')
  const noteChanged = note !== (report.teacherNote || '')
  const dirty = textChanged || noteChanged

  const startEdit = () => {
    setText(report.messageText || '')
    setNote(report.teacherNote || '')
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      // Sólo lo que cambió: si sólo cambia la nota, el backend rehace el texto con ella.
      const body = {}
      if (textChanged) body.messageText = text
      if (noteChanged) body.teacherNote = note
      await api.patch(`/reports/daily/${report.id}`, body)
      pushToast({ type: 'success', message: `Reporte de ${report.childName} guardado` })
      setEditing(false)
      onSaved()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padded={false} className="flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-4">
        <Avatar src={report.child?.photoUrl} name={report.childName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{report.childName}</p>
          <p className="text-xs text-slate-500 dark:text-white/40">
            {sent
              ? `Enviado ${report.sentAt ? `a las ${timeOf(report.sentAt)}` : ''}${report.sentTo ? ` · ${report.sentTo}` : ''}`
              : `${report.photoUrls?.length || 0} foto(s)${report.edited ? ' · editado a mano' : ''}`}
          </p>
        </div>
        <Badge tone={status.tone}>
          {sent && <CheckCircle2 className="w-3 h-3" />}
          {error && !sent && <AlertTriangle className="w-3 h-3" />}
          {status.label}
        </Badge>
      </div>

      <div className="px-4 py-3 flex-1">
        {editing ? (
          <div className="space-y-2">
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-1">
                Mensaje
              </span>
              <textarea
                className={`${inputClass} text-sm leading-relaxed`}
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-1">
                Nota personal (va al final)
              </span>
              <textarea
                className={inputClass}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Hoy dio sus primeros pasos sin apoyo, ¡felicidades!"
              />
            </label>
          </div>
        ) : (
          <div className="rounded-lg rounded-tl-sm bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 px-3 py-2">
            <p
              className={`text-sm text-slate-700 dark:text-white/80 whitespace-pre-wrap wrap-break-word ${
                expanded ? '' : 'line-clamp-8'
              }`}
            >
              {report.messageText ? <WaText text={report.messageText} /> : 'Sin texto: vuelve a generar.'}
            </p>
            {(report.messageText || '').split('\n').length > 8 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs font-medium text-accent-text hover:underline"
              >
                {expanded ? 'Ver menos' : 'Ver mensaje completo'}
              </button>
            )}
          </div>
        )}
        <DeliveryList results={delivery} />
        {error && !sent && (
          <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-100 dark:border-white/5">
        {editing ? (
          <>
            {dirty && <Badge tone="amber">Sin guardar</Badge>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty} className="min-h-10">
              Guardar texto
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={onOpen}>
              Destinatarios e historial
            </Button>
            {!sent && (
              <>
                <Button size="sm" variant="secondary" icon={Pencil} className="ml-auto min-h-10" onClick={startEdit}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  icon={Send}
                  className="min-h-10"
                  loading={sending}
                  onClick={onSend}
                  disabled={!canSend}
                  title={canSend ? undefined : 'El WhatsApp del centro no está conectado'}
                >
                  {error ? 'Reintentar' : 'Enviar'}
                </Button>
              </>
            )}
            {someFailed && (
              <Button size="sm" variant="secondary" icon={RefreshCw} className="ml-auto min-h-10" loading={sending} onClick={onSend} disabled={!canSend}>
                Reintentar a los que fallaron
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

/** Destinatarios, fotos e historial de envío de un reporte. */
function ReportDetail({ id, onClose, onSend, canSend }) {
  const { pushToast } = useToasts()
  const [report, setReport] = useState(null)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(({ silent = false } = {}) => {
    api
      .get(`/reports/daily/${id}`)
      .then((r) => {
        setLoadError('')
        setReport(r.data)
      })
      .catch((err) => {
        const msg = apiError(err, 'No se pudo cargar el reporte')
        setLoadError(msg)
        if (!silent) pushToast({ type: 'error', message: msg })
      })
  }, [id, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['report'] })

  const sent = report?.status === 'sent'
  // Familias cuyo último intento falló (y nunca les llegó).
  const failedRecipients = useMemo(() => {
    if (!report?.messages?.length) return []
    const ok = new Set(report.messages.filter((m) => m.status === 'sent' || m.status === 'queued').map((m) => m.guardianId))
    return (report.recipients || []).filter(
      (r) => !ok.has(r.guardianId) && report.messages.some((m) => m.guardianId === r.guardianId && m.status === 'failed'),
    )
  }, [report])

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={report?.childName || 'Reporte diario'}
      subtitle={report ? longDate(report.date) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          {report && !sent && (
            <Button icon={Send} onClick={() => onSend(report)} disabled={!report.recipients?.length || !canSend}>
              Enviar por WhatsApp
            </Button>
          )}
          {report && sent && failedRecipients.length > 0 && (
            <Button icon={RefreshCw} onClick={() => onSend(report)} disabled={!canSend}>
              Reintentar a {failedRecipients.length === 1 ? failedRecipients[0].name : `${failedRecipients.length} familias`}
            </Button>
          )}
        </>
      }
    >
      {loadError && !report ? (
        <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
          {loadError}
        </p>
      ) : !report ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/30 mb-1.5">
              Destinatarios
            </p>
            {report.recipients?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {report.recipients.map((r) => (
                  <Badge key={r.guardianId} tone="sky">
                    {r.name} · {r.phone}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-red-600 dark:text-red-400">
                Ningún representante con teléfono y recepción de reportes activada. Añádelo en la
                ficha del niño.
              </p>
            )}
          </div>

          {report.photoUrls?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/30 mb-1.5">
                Fotos del día ({report.photoUrls.length})
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {report.photoUrls.map((url) => (
                  <img key={url} src={mediaUrl(url)} alt="" className="aspect-square object-cover rounded-lg" />
                ))}
              </div>
              <p className="text-xs text-slate-400 dark:text-white/30 mt-1.5">
                Las fotos no viajan en el mensaje: la familia las ve en su portal.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/30 mb-1.5">
              Historial de envío
            </p>
            {report.messages?.length ? (
              <ul className="space-y-1.5">
                {report.messages.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2"
                  >
                    <span className="min-w-0 text-slate-700 dark:text-white/70">
                      {m.toName || m.toPhone}
                      {m.status === 'failed' && m.errorMessage && (
                        <span className="block text-xs text-red-600 dark:text-red-400">{m.errorMessage}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={m.status === 'sent' ? 'green' : m.status === 'failed' ? 'rose' : 'amber'}>
                        {m.status === 'sent'
                          ? 'Enviado'
                          : m.status === 'failed'
                            ? 'Falló'
                            : m.status === 'queued'
                              ? 'En cola de envío'
                              : 'Pendiente (modo manual)'}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 dark:text-white/40">Aún no se ha enviado.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
