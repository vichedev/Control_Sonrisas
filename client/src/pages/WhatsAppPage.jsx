import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, ShieldAlert } from '../components/icons'
import { api, apiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToasts } from '../context/ToastsContext'
import { Card, Loading, PageHeader } from '../components/ui'
import LinkedStatusCard from '../components/whatsapp/LinkedStatusCard'
import NotificationSettings from '../components/whatsapp/NotificationSettings'
import MessageLog from '../components/whatsapp/MessageLog'

/** Estados en los que el QR rota o la conexión cambia: se consulta cada 3 s. */
const FAST_STATES = ['connecting', 'qr']

/**
 * WhatsApp del centro: vincular el número por QR, avisos automáticos y bitácora.
 * Dirección edita; coordinación sólo consulta.
 */
export default function WhatsAppPage() {
  const { isAdmin } = useAuth()
  const { pushToast } = useToasts()
  const [status, setStatus] = useState(null)
  const [settings, setSettings] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)

  // Los fetchers sólo actualizan estado en el callback (nunca de forma síncrona en un efecto).
  const loadStatus = useCallback(
    () =>
      api
        .get('/whatsapp/linked/status')
        .then((r) => setStatus(r.data))
        .catch(() => {}), // se reintenta en el siguiente ciclo
    [],
  )

  const loadMessages = useCallback(
    () =>
      api
        .get('/whatsapp/messages', { params: { limit: 50 } })
        .then((r) => setMessages(Array.isArray(r.data) ? r.data : []))
        .catch((err) => pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la bitácora') }))
        .finally(() => setLoadingMsgs(false)),
    [pushToast],
  )

  const refreshMessages = () => {
    setLoadingMsgs(true)
    loadMessages()
  }

  // Carga inicial.
  useEffect(() => {
    loadStatus()
    loadMessages()
    api
      .get('/whatsapp/settings')
      .then((r) => setSettings(r.data))
      .catch((err) => pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar los ajustes') }))
  }, [loadStatus, loadMessages, pushToast])

  // Sondeo: rápido mientras se conecta o espera el escaneo, lento el resto del tiempo.
  const state = status?.state
  useEffect(() => {
    if (!state) return
    const fast = FAST_STATES.includes(state)
    const t = setInterval(() => {
      loadStatus()
      if (!fast) loadMessages()
    }, fast ? 3000 : 20000)
    return () => clearInterval(t)
  }, [state, loadStatus, loadMessages])

  // Al terminar de vincular, avisa y refresca la bitácora.
  const prevState = useRef(state)
  useEffect(() => {
    if (state === 'connected' && FAST_STATES.includes(prevState.current)) {
      pushToast({ type: 'success', message: '¡WhatsApp del centro conectado!' })
      loadMessages()
    }
    prevState.current = state
  }, [state, pushToast, loadMessages])

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="WhatsApp del centro"
        subtitle="Un solo número para enviar reportes y avisos de cualquier novedad a las familias"
        icon={MessageCircle}
      />

      <div className="space-y-5">
        {status ? (
          <LinkedStatusCard status={status} canEdit={isAdmin} onChange={setStatus} />
        ) : (
          <Card><Loading label="Consultando WhatsApp…" /></Card>
        )}

        <Card className="border-amber-200! dark:border-amber-500/25! bg-amber-50! dark:bg-amber-500/8!">
          <div className="flex gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900 dark:text-amber-100/90 space-y-1">
              <p className="font-medium">Conexión no oficial de WhatsApp: úsala con cuidado</p>
              <p>
                Funciona como WhatsApp Web. Usa un <b>número dedicado al centro</b> (no el personal de
                nadie), mantén el teléfono con batería e internet, y evita envíos masivos a números que
                no tienen guardado el contacto del centro. El sistema ya espacia los mensajes (unos
                segundos entre cada uno, máximo 20 por minuto) para reducir el riesgo de bloqueo.
              </p>
            </div>
          </div>
        </Card>

        {settings ? (
          <NotificationSettings
            key={settings.updatedAt}
            settings={settings}
            linkedConnected={state === 'connected'}
            canEdit={isAdmin}
            onSaved={setSettings}
          />
        ) : (
          <Card><Loading label="Cargando ajustes…" /></Card>
        )}

        <MessageLog messages={messages} loading={loadingMsgs} onRefresh={refreshMessages} />
      </div>
    </div>
  )
}
