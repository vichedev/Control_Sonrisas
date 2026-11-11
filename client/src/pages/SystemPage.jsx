import { useCallback, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useToasts } from '../context/ToastsContext'
import { Badge, Button, Card, EmptyState, Loading, PageHeader, SectionTitle } from '../components/ui'
import ReauthModal from '../components/ops/ReauthModal'
import JobProgress from '../components/ops/JobProgress'
import { JOB_ACTION_LABEL, JOB_STATE_META, errMsg, fmtDateTime, fmtRelative } from '../components/ops/opsFormat'
import { ArrowsClockwise, CloudArrowDown, History, Info, RefreshCw, Rocket, RotateCcw, Wrench } from '../components/icons'

/**
 * Sistema (sólo dirección): versión instalada, versiones publicadas, actualizar con un
 * clic (respaldo previo + vuelta atrás automática si falla) y volver a la versión anterior.
 * Diseñada para vivir dentro de Ajustes.
 */
export default function SystemPage() {
  const { pushToast } = useToasts()
  const [info, setInfo] = useState(null)
  const [versions, setVersions] = useState(null)
  const [history, setHistory] = useState([])
  const [target, setTarget] = useState(null) // tag a instalar
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [restoreDb, setRestoreDb] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [openNotes, setOpenNotes] = useState(null)

  const load = useCallback(async () => {
    const [v, vs, h] = await Promise.allSettled([
      api.get('/system/version'),
      api.get('/system/versions'),
      api.get('/system/history'),
    ])
    if (v.status === 'fulfilled') {
      setInfo(v.value.data)
      const active = (v.value.data.jobs || []).find((j) => j.state === 'running' || j.state === 'queued')
      if (active) setJobId((cur) => cur || active.id)
    } else setInfo((cur) => cur || { error: errMsg(v.reason) })
    if (vs.status === 'fulfilled') setVersions(vs.value.data)
    if (h.status === 'fulfilled') setHistory(h.value.data || [])
  }, [])
  useLoadEffect(load)

  const onJobDone = useCallback(
    (job) => {
      pushToast(
        job.state === 'success'
          ? { type: 'success', title: `${JOB_ACTION_LABEL[job.action] || 'Tarea'} completada` }
          : { type: 'error', title: `${JOB_ACTION_LABEL[job.action] || 'Tarea'} sin éxito`, subtitle: job.message },
      )
      load()
    },
    [load, pushToast],
  )

  const newer = useMemo(() => (versions?.tags || []).filter((t) => t.newer), [versions])
  const latest = newer[0]
  const updater = info?.updater
  const lastSuccess = history.find((h) => h.status === 'success' && (h.action === 'update' || h.action === 'rollback'))

  if (!info) return <Loading label="Cargando información del sistema…" />

  const doUpdate = async (creds) => {
    const r = await api.post('/system/update', { ...creds, version: target.tag })
    setTarget(null)
    setJobId(r.data.jobId)
  }
  const doRollback = async (creds) => {
    const r = await api.post('/system/rollback', { ...creds, restoreDb })
    setRollbackOpen(false)
    setRestoreDb(false)
    setJobId(r.data.jobId)
  }

  const canAct = updater?.online && !jobId

  return (
    <div className="space-y-6">
      <PageHeader
        title="Actualizaciones"
        subtitle="Versión del sistema, actualizaciones y vuelta atrás"
        icon={Rocket}
        actions={<Button variant="secondary" icon={RefreshCw} onClick={load}>Actualizar datos</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Versión instalada</SectionTitle>
          <p className="text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">v{info.version}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500 dark:text-white/45">Commit</dt>
            <dd className="font-mono text-xs text-slate-700 dark:text-white/75">{info.commit || '—'}</dd>
            <dt className="text-slate-500 dark:text-white/45">Compilada</dt>
            <dd className="text-slate-700 dark:text-white/75">{fmtDateTime(info.builtAt)}</dd>
            <dt className="text-slate-500 dark:text-white/45">Base de datos</dt>
            <dd className="text-slate-700 dark:text-white/75">
              {info.schemaMode === 'migrations' ? `${info.migrations?.executed ?? 0} migraciones aplicadas` : 'Modo desarrollo (sincronización automática)'}
            </dd>
          </dl>
        </Card>

        <Card>
          <SectionTitle>Actualizador</SectionTitle>
          <div className="flex items-center gap-2">
            <Badge tone={updater?.online ? 'green' : 'amber'}>{updater?.online ? 'En línea' : 'No disponible'}</Badge>
            {updater?.busy && <Badge tone="sky">Trabajando</Badge>}
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-white/65">
            {updater?.online
              ? `Último contacto ${fmtRelative(updater.lastSeen)}. Versiones consultadas ${fmtRelative(versions?.fetchedAt) || '—'}.`
              : 'El servicio sonrisas_updater no responde. Las actualizaciones se pueden hacer desde el servidor con ./deploy.sh update.'}
          </p>
          {versions?.error && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">No se pudo consultar el repositorio: {versions.error}</p>}
        </Card>
      </div>

      {jobId && (
        <Card>
          <SectionTitle>Tarea en curso</SectionTitle>
          <JobProgress jobId={jobId} onDone={onJobDone} />
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={() => setJobId(null)}>Ocultar</Button>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 pb-2 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Versiones publicadas</SectionTitle>
          {latest && (
            <Button icon={CloudArrowDown} disabled={!canAct} onClick={() => setTarget(latest)}>
              Actualizar a {latest.tag}
            </Button>
          )}
        </div>
        {(versions?.tags || []).length ? (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {versions.tags.map((t) => (
              <li key={t.tag} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums text-slate-900 dark:text-white">{t.tag}</span>
                  {t.current && <Badge tone="green">Instalada</Badge>}
                  {t.newer && <Badge tone="accent">Nueva</Badge>}
                  <span className="text-xs text-slate-500 dark:text-white/45">{fmtDateTime(t.date)}</span>
                  <span className="flex-1" />
                  {(t.notes || t.subject) && (
                    <Button size="sm" variant="ghost" icon={Info} onClick={() => setOpenNotes(openNotes === t.tag ? null : t.tag)}>
                      Notas
                    </Button>
                  )}
                  {t.newer && (
                    <Button size="sm" variant="secondary" disabled={!canAct} onClick={() => setTarget(t)}>
                      Instalar
                    </Button>
                  )}
                </div>
                {t.subject && <p className="mt-1 text-sm text-slate-600 dark:text-white/65">{t.subject}</p>}
                {openNotes === t.tag && t.notes && (
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 dark:bg-white/4 p-3 text-xs text-slate-600 dark:text-white/65 font-sans">{t.notes}</pre>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ArrowsClockwise} title="No hay versiones publicadas" message="Cuando se publique una versión nueva (tag vX.Y.Z en GitHub) aparecerá aquí." />
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-prose">
            <SectionTitle>Volver a la versión anterior</SectionTitle>
            <p className="text-sm text-slate-600 dark:text-white/65">
              Si algo no funciona bien después de actualizar, vuelve a la versión anterior que funcionaba
              {lastSuccess?.from ? ` (${lastSuccess.from})` : ''}. Se conserva todo lo registrado; si la
              actualización cambió la base de datos, esos cambios se deshacen de forma segura.
            </p>
          </div>
          <Button variant="warning" icon={RotateCcw} disabled={!canAct || !lastSuccess} onClick={() => setRollbackOpen(true)}>
            Volver a la versión anterior
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <div className="p-4 pb-2">
          <SectionTitle>Historial</SectionTitle>
        </div>
        {history.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {history.slice(0, 20).map((h, i) => {
              const m = JOB_STATE_META[h.status] || { label: h.status, tone: 'slate' }
              return (
                <li key={`${h.at}-${i}`} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="tabular-nums text-xs text-slate-500 dark:text-white/45 w-36 shrink-0">{fmtDateTime(h.at)}</span>
                  <span className="font-medium text-slate-800 dark:text-white/85">{JOB_ACTION_LABEL[h.action] || h.action}</span>
                  <Badge tone={m.tone}>{m.label}</Badge>
                  {(h.from || h.to) && <span className="tabular-nums text-slate-600 dark:text-white/60">{h.from || '—'} → {h.to || '—'}</span>}
                  {h.message && <span className="text-xs text-slate-500 dark:text-white/45 basis-full sm:basis-auto">{h.message}</span>}
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState icon={History} title="Sin historial todavía" />
        )}
      </Card>

      <ReauthModal
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Actualizar a ${target?.tag || ''}`}
        subtitle={`Versión actual: v${info.version}`}
        confirmLabel="Actualizar"
        onSubmit={doUpdate}
        description={
          <>
            <p>Antes de actualizar se hace un respaldo completo. El sistema estará detenido unos minutos.</p>
            <p>Si la nueva versión no arranca bien, se vuelve sola a la versión actual sin perder datos.</p>
          </>
        }
      />

      <ReauthModal
        open={rollbackOpen}
        onClose={() => {
          setRollbackOpen(false)
          setRestoreDb(false)
        }}
        title="Volver a la versión anterior"
        subtitle={lastSuccess ? `${lastSuccess.to} → ${lastSuccess.from}` : undefined}
        confirmLabel="Volver atrás"
        variant="warning"
        confirmWord={restoreDb ? 'RESTAURAR' : undefined}
        onSubmit={doRollback}
        description={<p>Antes se guarda un respaldo de seguridad del estado actual. El sistema estará detenido unos minutos.</p>}
      >
        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-white/80">
          <input type="checkbox" className="mt-1 accent-accent" checked={restoreDb} onChange={(e) => setRestoreDb(e.target.checked)} />
          <span>
            Restaurar también la base de datos al momento previo a la actualización.
            <span className="block text-xs text-red-600 dark:text-red-400">Se pierde todo lo registrado desde la actualización. Úsalo sólo si los datos quedaron dañados.</span>
          </span>
        </label>
      </ReauthModal>

      {!updater?.online && (
        <Card>
          <div className="flex gap-3 text-sm text-slate-600 dark:text-white/65">
            <Wrench className="w-5 h-5 shrink-0 text-slate-400" />
            <p>
              Desde el servidor: <code className="font-mono text-xs">./deploy.sh update</code>,{' '}
              <code className="font-mono text-xs">./deploy.sh rollback</code> y{' '}
              <code className="font-mono text-xs">./deploy.sh status</code>.
            </p>
          </div>
        </Card>
      )}
    </div>
  )
}
