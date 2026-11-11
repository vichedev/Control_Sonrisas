import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useToasts } from '../context/ToastsContext'
import { Badge, Button, Card, EmptyState, Field, Loading, PageHeader, ProgressBar, SectionTitle, StatTile, inputClass } from '../components/ui'
import SmartTable from '../components/SmartTable'
import Modal from '../components/Modal'
import ReauthModal from '../components/ops/ReauthModal'
import JobProgress from '../components/ops/JobProgress'
import { KIND_META, errMsg, fmtBytes, fmtDateTime, fmtRelative, olderThanHours } from '../components/ops/opsFormat'
import {
  CheckCircle2,
  Clock,
  Database,
  Download,
  HardDrives,
  Lock,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
  Plus,
} from '../components/icons'

/**
 * Respaldos (sólo dirección): lista de nocturnos, manuales y de seguridad; crear, subir,
 * descargar, verificar, borrar y restaurar. Diseñada para vivir dentro de Ajustes.
 */
export default function BackupsPage() {
  const { pushToast } = useToasts()
  const [data, setData] = useState(null)
  const [note, setNote] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [action, setAction] = useState(null) // { type: 'download'|'delete'|'restore', item }
  const [jobId, setJobId] = useState(null)
  const [upload, setUpload] = useState(null) // { name, pct }
  const [verifying, setVerifying] = useState(null)
  const fileRef = useRef(null)
  const lastOp = useRef(null)

  const load = useCallback(
    () =>
      api
        .get('/system/backups')
        .then((r) => setData(r.data))
        .catch((e) => setData((d) => ({ ...(d || { items: [] }), error: errMsg(e) }))),
    [],
  )
  useLoadEffect(load)

  // Mientras hay una operación en curso, refrescar.
  const running = data?.operation?.state === 'running'
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [running, load])

  // Avisar cuando termina una operación.
  useEffect(() => {
    const op = data?.operation
    if (!op) return
    const prev = lastOp.current
    lastOp.current = op
    if (prev && prev.id === op.id && prev.state === 'running' && op.state !== 'running') {
      pushToast(
        op.state === 'success'
          ? { type: 'success', title: op.type === 'restore' ? 'Restauración completada' : 'Respaldo creado', subtitle: op.file || op.message }
          : { type: 'error', title: 'La operación falló', subtitle: op.message },
      )
    }
  }, [data?.operation, pushToast])

  const createBackup = async () => {
    try {
      await api.post('/system/backups', note.trim() ? { note: note.trim() } : {})
      setCreateOpen(false)
      setNote('')
      pushToast({ type: 'info', title: 'Creando respaldo…', subtitle: 'Puede tardar unos minutos según la cantidad de fotos.' })
      load()
    } catch (e) {
      pushToast({ type: 'error', title: 'No se pudo iniciar el respaldo', subtitle: errMsg(e) })
    }
  }

  const onPickFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const max = (data?.settings?.uploadMaxMb || 2048) * 1024 * 1024
    if (!/\.tar(\.enc)?$/i.test(f.name)) {
      pushToast({ type: 'error', title: 'Archivo no válido', subtitle: 'Sólo respaldos .tar o .tar.enc de Sonrisas' })
      return
    }
    if (f.size > max) {
      pushToast({ type: 'error', title: 'Archivo muy grande', subtitle: `Máximo ${fmtBytes(max)}` })
      return
    }
    const fd = new FormData()
    fd.append('file', f)
    setUpload({ name: f.name, pct: 0 })
    try {
      const r = await api.post('/system/backups/upload', fd, {
        timeout: 0,
        onUploadProgress: (p) => p.total && setUpload({ name: f.name, pct: Math.round((p.loaded / p.total) * 100) }),
      })
      pushToast({ type: 'success', title: 'Respaldo subido y verificado', subtitle: r.data?.file })
      load()
    } catch (err) {
      pushToast({ type: 'error', title: 'No se pudo subir el respaldo', subtitle: errMsg(err) })
    } finally {
      setUpload(null)
    }
  }

  const verify = async (item) => {
    setVerifying(item.file)
    try {
      const r = await api.post(`/system/backups/${encodeURIComponent(item.file)}/verify`, {}, { timeout: 0 })
      const m = r.data?.manifest
      pushToast({ type: 'success', title: 'Respaldo íntegro', subtitle: `${m?.uploads?.files ?? 0} fotos · versión ${m?.app?.version || '—'}` })
    } catch (e) {
      pushToast({ type: 'error', title: 'El respaldo no pasó la verificación', subtitle: errMsg(e) })
    } finally {
      setVerifying(null)
    }
  }

  const submitAction = async (creds) => {
    const { type, item } = action
    const base = `/system/backups/${encodeURIComponent(item.file)}`
    if (type === 'download') {
      const r = await api.post(`${base}/download-link`, creds)
      const a = document.createElement('a')
      a.href = r.data.url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      pushToast({ type: 'info', title: 'Descarga iniciada', subtitle: 'Guárdalo en un lugar seguro: contiene datos de menores.' })
    } else if (type === 'delete') {
      await api.post(`${base}/delete`, creds)
      pushToast({ type: 'success', title: 'Respaldo eliminado' })
      load()
    } else if (type === 'restore') {
      const r = await api.post(`${base}/restore`, creds)
      if (r.data?.mode === 'updater') setJobId(r.data.jobId)
      else pushToast({ type: 'info', title: 'Restaurando…', subtitle: 'Se hizo antes un respaldo de seguridad.' })
      load()
    }
    setAction(null)
  }

  if (!data) return <Loading label="Cargando respaldos…" />

  const items = data.items || []
  const last = items.find((b) => !b.legacy)
  const lastNightly = items.find((b) => b.kind === 'nightly')
  const total = items.reduce((s, b) => s + (b.size || 0), 0)
  const stale = olderThanHours(last?.createdAt, 36)
  const busy = running || data.busy

  const columns = [
    {
      key: 'createdAt',
      label: 'Fecha',
      primary: true,
      sortValue: (b) => b.createdAt,
      render: (b) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-900 dark:text-white tabular-nums">{fmtDateTime(b.createdAt)}</div>
          <div className="text-xs text-slate-500 dark:text-white/45">{fmtRelative(b.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'kind',
      label: 'Tipo',
      render: (b) => {
        const k = KIND_META[b.kind] || KIND_META.manual
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={k.tone}>{k.label}</Badge>
            {b.encrypted ? (
              <span title="Cifrado" className="text-emerald-600 dark:text-emerald-400"><Lock className="w-3.5 h-3.5" /></span>
            ) : !b.legacy ? (
              <span title="Sin cifrar" className="text-amber-600 dark:text-amber-400"><Unlock className="w-3.5 h-3.5" /></span>
            ) : null}
          </div>
        )
      },
    },
    {
      key: 'content',
      label: 'Contenido',
      hideOnMobile: true,
      render: (b) =>
        b.legacy ? (
          <span className="text-xs text-slate-500 dark:text-white/45">{b.note}</span>
        ) : (
          <div className="text-xs text-slate-600 dark:text-white/60 tabular-nums">
            BD {fmtBytes(b.db?.size)} · {b.uploads?.files ?? '—'} fotos
            {b.app?.version && <span className="text-slate-400 dark:text-white/35"> · v{b.app.version}</span>}
            {b.note && <div className="text-slate-400 dark:text-white/35 truncate max-w-xs" title={b.note}>{b.note}</div>}
          </div>
        ),
    },
    {
      key: 'size',
      label: 'Tamaño',
      className: 'text-right',
      sortValue: (b) => b.size,
      render: (b) => <span className="tabular-nums">{fmtBytes(b.size)}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (b) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="ghost" icon={Download} onClick={() => setAction({ type: 'download', item: b })} aria-label={`Descargar ${b.file}`}>
            <span className="hidden xl:inline">Descargar</span>
          </Button>
          {b.restorable && (
            <>
              <Button size="sm" variant="ghost" icon={ShieldCheck} loading={verifying === b.file} disabled={!!verifying} onClick={() => verify(b)} aria-label="Verificar">
                <span className="hidden xl:inline">Verificar</span>
              </Button>
              <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => setAction({ type: 'restore', item: b })} aria-label="Restaurar">
                <span className="hidden xl:inline">Restaurar</span>
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={() => setAction({ type: 'delete', item: b })} aria-label="Eliminar" className="text-red-600 dark:text-red-400" />
        </div>
      ),
    },
  ]

  const modalCopy = {
    download: {
      title: 'Descargar respaldo',
      confirmLabel: 'Descargar',
      variant: 'primary',
      description: <p>El archivo contiene datos personales y fotos de menores. Guárdalo sólo en un lugar seguro. La descarga queda registrada en la auditoría.</p>,
    },
    delete: {
      title: 'Eliminar respaldo',
      confirmLabel: 'Eliminar',
      variant: 'danger',
      description: <p>Se borra de forma permanente. Si es el único respaldo de esa fecha, ya no se podrá volver a ese momento.</p>,
    },
    restore: {
      title: 'Restaurar respaldo',
      confirmLabel: 'Restaurar',
      variant: 'danger',
      confirmWord: 'RESTAURAR',
      description: (
        <>
          <p className="font-medium">La base de datos volverá al {fmtDateTime(action?.item?.createdAt)}.</p>
          <p>Se perderá lo registrado después de esa hora. Antes se hace un respaldo de seguridad automático del estado actual, y las fotos se fusionan (no se borra ninguna).</p>
          <p>El sistema se detiene unos minutos y es posible que debas volver a iniciar sesión.</p>
        </>
      ),
    },
  }[action?.type] || {}

  return (
    <div className="space-y-6">
      <PageHeader
        title="Respaldos"
        subtitle="Copias de la base de datos y de las fotos"
        icon={Database}
        actions={
          <>
            <input ref={fileRef} type="file" accept=".tar,.enc" className="hidden" onChange={onPickFile} />
            <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()} disabled={!!upload || busy}>
              Subir respaldo
            </Button>
            <Button icon={Plus} onClick={() => setCreateOpen(true)} loading={running && data.operation?.type === 'create'} disabled={busy}>
              Crear respaldo ahora
            </Button>
          </>
        }
      />

      {data.error && (
        <Card className="border-red-200 dark:border-red-400/20">
          <p className="text-sm text-red-600 dark:text-red-400">{data.error}</p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Último respaldo"
          value={last ? fmtRelative(last.createdAt).replace('hace ', '') : 'Ninguno'}
          hint={last ? fmtDateTime(last.createdAt) : 'Crea uno ahora'}
          icon={stale ? Clock : CheckCircle2}
          tone={stale ? 'amber' : 'green'}
        />
        <StatTile label="Respaldos guardados" value={items.length} hint={`${fmtBytes(total)} en total`} icon={HardDrives} />
        <StatTile
          label="Nocturno"
          value={lastNightly ? fmtRelative(lastNightly.createdAt).replace('hace ', '') : '—'}
          hint={`Programación: ${data.settings?.schedule || '—'}`}
          icon={Clock}
          tone="sky"
        />
        <StatTile
          label="Espacio libre"
          value={data.freeBytes != null ? fmtBytes(data.freeBytes) : '—'}
          hint={data.settings?.encrypted ? 'Respaldos cifrados' : 'Respaldos SIN cifrar'}
          icon={data.settings?.encrypted ? Lock : Unlock}
          tone={data.settings?.encrypted ? 'green' : 'amber'}
        />
      </div>

      {(running || upload) && (
        <Card>
          {upload ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-700 dark:text-white/80">Subiendo {upload.name}… {upload.pct}%</p>
              <ProgressBar value={upload.pct} tone="sky" label="Progreso de la subida" />
              {upload.pct === 100 && <p className="text-xs text-slate-500 dark:text-white/45">Verificando integridad…</p>}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/80">
              <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              {data.operation?.type === 'restore' ? 'Restaurando respaldo…' : 'Creando respaldo…'} iniciado {fmtRelative(data.operation?.startedAt)}
            </p>
          )}
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 pb-0">
          <SectionTitle hint={`${data.settings?.retention?.keepNightly ?? 14} nocturnos · ${data.settings?.retention?.keepSafety ?? 10} de seguridad · hasta ${data.settings?.retention?.maxManual ?? 30} manuales`}>
            Respaldos disponibles
          </SectionTitle>
        </div>
        {items.length ? (
          <SmartTable rows={items} columns={columns} rowKey="file" initialPageSize={10} stickyHeader={false} maxHeight={null} />
        ) : (
          <EmptyState
            icon={Database}
            title="Todavía no hay respaldos"
            message="El respaldo nocturno se crea solo. También puedes crear uno ahora."
            action={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Crear respaldo ahora</Button>}
          />
        )}
      </Card>

      <Card>
        <SectionTitle>Cómo se protegen los datos</SectionTitle>
        <ul className="text-sm text-slate-600 dark:text-white/65 space-y-1.5 list-disc pl-5">
          <li>Cada noche se guarda automáticamente la base de datos y todas las fotos.</li>
          <li>Antes de cada actualización, restauración o vuelta atrás se crea un respaldo de seguridad.</li>
          <li>Restaurar exige tu contraseña{' '}y, si la tienes activada, la verificación en dos pasos.</li>
          <li>Descarga un respaldo de vez en cuando y guárdalo fuera del servidor (o configura la copia externa, ver DEPLOY.md).</li>
          {!data.updater?.online && !data.settings?.inProcessRestore && (
            <li className="text-amber-700 dark:text-amber-300">El actualizador no está en línea: las restauraciones deben hacerse desde el servidor (./deploy.sh restore).</li>
          )}
        </ul>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Crear respaldo ahora"
        subtitle="Base de datos + fotos"
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button icon={Database} onClick={createBackup}>Crear respaldo</Button>
          </div>
        }
      >
        <Field label="Nota (opcional)" hint="Por ejemplo: «Antes de cerrar el año lectivo».">
          <input className={inputClass} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>

      <ReauthModal
        open={!!action}
        onClose={() => setAction(null)}
        subtitle={action?.item?.file}
        onSubmit={submitAction}
        {...modalCopy}
      />

      <Modal
        open={!!jobId}
        onClose={() => setJobId(null)}
        title="Restauración en curso"
        subtitle="No cierres el navegador hasta que termine"
        width="lg"
      >
        {jobId && <JobProgress jobId={jobId} onDone={load} />}
      </Modal>
    </div>
  )
}
