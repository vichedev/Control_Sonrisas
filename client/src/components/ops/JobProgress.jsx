import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { api } from '../../api/client'
import { Badge, Button } from '../ui'
import { CheckCircle2, Loader2, RefreshCw, WifiOff, XCircle } from '../icons'
import { JOB_ACTION_LABEL, JOB_STATE_META, fmtDateTime } from './opsFormat'

const FINAL = new Set(['success', 'failed', 'rejected'])

/**
 * Seguimiento de una tarea del actualizador (actualizar / volver atrás / restaurar).
 * Mientras la api se reinicia las peticiones fallan: se muestra "reiniciando" y se
 * consulta /api/health hasta que vuelva, sin cerrar la sesión.
 */
export default function JobProgress({ jobId, onDone, compact = false }) {
  const [job, setJob] = useState(null)
  const [offline, setOffline] = useState(false)
  const preRef = useRef(null)
  const doneRef = useRef(false)

  useEffect(() => {
    if (!jobId) return undefined
    doneRef.current = false
    let stop = false
    let timer = null
    const tick = async () => {
      try {
        const r = await api.get(`/system/jobs/${jobId}`, { timeout: 8000 })
        if (stop) return
        setJob(r.data)
        setOffline(false)
        if (FINAL.has(r.data.state)) {
          if (!doneRef.current) {
            doneRef.current = true
            onDone?.(r.data)
          }
          return
        }
      } catch (e) {
        if (stop) return
        // Sin respuesta o 502/503: la api se está reiniciando.
        const s = e?.response?.status
        if (!e?.response || s === 502 || s === 503 || s === 504) {
          setOffline(true)
          try {
            await axios.get('/api/health', { timeout: 4000 })
          } catch {
            /* sigue reiniciando */
          }
        }
      }
      if (!stop) timer = setTimeout(tick, 3000)
    }
    tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [jobId, onDone])

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [job?.log])

  const state = job?.state || 'queued'
  const meta = JOB_STATE_META[state] || JOB_STATE_META.queued
  const running = !FINAL.has(state)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {running ? (
          <Loader2 className="w-4 h-4 animate-spin text-accent-text" />
        ) : state === 'success' ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
        )}
        <span className="font-medium text-slate-900 dark:text-white">
          {JOB_ACTION_LABEL[job?.action] || 'Tarea'}
          {job?.version ? ` a ${job.version}` : ''}
          {job?.file ? ` · ${job.file}` : ''}
        </span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {job?.startedAt && (
          <span className="text-xs text-slate-500 dark:text-white/45 tabular-nums">desde {fmtDateTime(job.startedAt)}</span>
        )}
      </div>
      {offline && running && (
        <p className="flex items-center gap-2 text-sm text-sky-700 dark:text-sky-300">
          <WifiOff className="w-4 h-4" /> El sistema se está reiniciando. Esta pantalla se actualizará sola.
        </p>
      )}
      {job?.message && !running && (
        <p className={`text-sm ${state === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
          {job.message}
        </p>
      )}
      {!compact && (
        <pre
          ref={preRef}
          className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-black/30 p-3 text-[11px] leading-relaxed text-slate-700 dark:text-white/70 whitespace-pre-wrap break-words font-mono"
        >
          {job?.log || 'Esperando a que el actualizador tome la tarea…'}
        </pre>
      )}
      {!running && state === 'success' && (job?.action === 'update' || job?.action === 'rollback') && (
        <Button variant="secondary" icon={RefreshCw} onClick={() => window.location.reload()}>
          Recargar para usar la nueva versión
        </Button>
      )}
    </div>
  )
}
