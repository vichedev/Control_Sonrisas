import { useEffect, useState } from 'react'
import { Bell, BellOff } from './icons'
import { pushStatus, subscribeToPush, unsubscribeFromPush } from '../utils/push'
import { useToasts } from '../context/ToastsContext'

/**
 * Botón compacto para suscribirse / desuscribirse a notificaciones push.
 * Se oculta si el navegador no soporta push o si el permiso está bloqueado.
 */
export default function PushToggle({ size = 'sm' }) {
  const { pushToast } = useToasts()
  const [status, setStatus] = useState('default')
  const [busy, setBusy] = useState(false)

  useEffect(() => { (async () => setStatus(await pushStatus()))() }, [])

  if (status === 'unsupported' || status === 'denied') return null

  const subscribed = status === 'granted-subscribed'
  const small = size === 'sm'

  const toggle = async () => {
    setBusy(true)
    try {
      if (subscribed) {
        await unsubscribeFromPush()
        pushToast({ type: 'success', title: 'Notificaciones desactivadas' })
      } else {
        await subscribeToPush()
        pushToast({ type: 'success', title: 'Notificaciones activadas', subtitle: 'Recibirás avisos de nuevas tareas y justificaciones.' })
      }
      setStatus(await pushStatus())
    } catch (e) {
      pushToast({ type: 'error', title: 'No se pudo cambiar', subtitle: e?.message || String(e) })
    } finally { setBusy(false) }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={subscribed ? 'Desactivar notificaciones' : 'Activar notificaciones'}
      title={subscribed ? 'Notificaciones activas' : 'Activar notificaciones'}
      className={`inline-flex items-center justify-center ${small ? 'w-9 h-9' : 'w-10 h-10'} rounded-lg ${subscribed ? 'bg-accent-soft text-accent-text hover:bg-accent-soft-strong' : 'bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:text-slate-900 dark:hover:text-white'} transition disabled:opacity-60`}
    >
      {subscribed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
    </button>
  )
}
