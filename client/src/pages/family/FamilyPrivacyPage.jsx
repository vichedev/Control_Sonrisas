import { useCallback, useState } from 'react'
import { ChevronDown, History, Mail, ShieldCheck } from '../../components/icons'
import { api, apiError } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { useToasts } from '../../context/ToastsContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Avatar, Badge, Card, EmptyState, Loading, PageHeader, SectionTitle, SegmentedControl } from '../../components/ui'
import ConsentBadge from '../../components/consent/ConsentBadge'
import PolicyText from '../../components/consent/PolicyText'
import { CONSENT_LABEL, CONSENT_TYPES, formatDateTime } from '../../components/consent/consentModel'

const CHANGE_TEXT = {
  data_processing: {
    true: 'Aceptará el tratamiento de los datos descrito en el texto vigente.',
    false:
      'Retirará la aceptación del tratamiento de datos. La dirección del centro se pondrá en contacto con usted, porque sin estos datos no es posible el cuidado diario con normalidad.',
  },
  images: {
    true: 'El personal podrá tomar fotos de su hijo o hija para el portal y el reporte diario.',
    false: 'Desde ahora no se tomarán fotos nuevas de su hijo o hija. Las fotos ya tomadas siguen visibles sólo para su familia y el personal.',
  },
  whatsapp: {
    true: 'Recibirá avisos de su hijo o hija por WhatsApp.',
    false: 'Dejará de recibir avisos por WhatsApp. Seguirá viendo todo en este portal.',
  },
}

/** Portal familiar: decisiones vigentes, cambio en cualquier momento, historial y derechos. */
export default function FamilyPrivacyPage() {
  const { pushToast } = useToasts()
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(null) // { child, type, granted }
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([api.get('/family/consents'), api.get('/family/consents/history')])
      setData(c.data)
      setHistory(h.data || [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la privacidad') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])
  useLoadEffect(load)

  const confirm = async () => {
    if (!pending) return
    setSaving(true)
    try {
      await api.post('/family/consents', {
        childId: pending.child.id,
        type: pending.type,
        granted: pending.granted,
        legalRepresentative: true,
      })
      pushToast({ type: 'success', message: 'Decisión guardada' })
      setPending(null)
      await load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo guardar') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading />
  if (!data) return <EmptyState icon={ShieldCheck} title="No disponible" message="Intente de nuevo más tarde." />

  const childName = (id) => data.children.find((c) => c.id === id)?.firstName || ''

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Privacidad y consentimientos"
        subtitle="Usted decide qué datos e imágenes de su hijo o hija se usan. Puede cambiarlo cuando quiera."
      />

      {data.children.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="Sin niños vinculados" message="Cuando el centro vincule a su hijo o hija, verá aquí sus autorizaciones." />
        </Card>
      ) : (
        data.children.map((child) => (
          <Card key={child.id} padded={false}>
            <div className="flex items-center gap-3 p-4 sm:p-5 border-b border-slate-200 dark:border-white/10">
              <Avatar src={child.photoUrl} name={child.name} />
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-white truncate">{child.name}</p>
                {child.classroomName && <p className="text-xs text-slate-500 dark:text-white/45">{child.classroomName}</p>}
              </div>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {CONSENT_TYPES.map((type) => {
                const s = child.consents[type]
                const value = s.status === 'granted' ? 'yes' : s.status === 'denied' ? 'no' : null
                return (
                  <div key={type} className="p-4 sm:px-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-800 dark:text-white/85">{CONSENT_LABEL[type]}</p>
                        <ConsentBadge type={type} status={s} />
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/45 mt-0.5">
                        {s.at
                          ? `${s.status === 'denied' ? 'No autorizado' : 'Decidido'} el ${formatDateTime(s.at)}${s.by ? ` por ${s.by}` : ''}${s.method === 'presencial' ? ' (formulario en el centro)' : ''}`
                          : 'Aún sin respuesta'}
                        {s.outdated && ' · el texto cambió, confirme de nuevo'}
                      </p>
                      {type === 'data_processing' && s.status === 'denied' && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          La dirección del centro se pondrá en contacto con usted.
                        </p>
                      )}
                    </div>
                    <SegmentedControl
                      size="sm"
                      ariaLabel={`${CONSENT_LABEL[type]} de ${child.firstName}`}
                      value={value}
                      onChange={(v) => {
                        const granted = v === 'yes'
                        if (granted && s.status === 'granted') return
                        if (!granted && s.status === 'denied') return
                        setPending({ child, type, granted })
                      }}
                      options={[
                        { value: 'yes', label: 'Autorizar' },
                        { value: 'no', label: 'No autorizar' },
                      ]}
                    />
                  </div>
                )
              })}
            </div>
          </Card>
        ))
      )}

      <section>
        <SectionTitle>Textos vigentes</SectionTitle>
        <div className="space-y-2">
          {CONSENT_TYPES.filter((t) => data.policies[t]).map((t) => (
            <PolicyDisclosure key={t} policy={data.policies[t]} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Sus derechos</SectionTitle>
        <Card>
          <div className="space-y-2 text-sm text-slate-700 dark:text-white/75 leading-relaxed">
            <p>
              Según la Ley Orgánica de Protección de Datos Personales (LOPDP), como representante legal puede en
              cualquier momento:
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>Acceder a los datos de su hijo o hija que guarda el centro.</li>
              <li>Pedir que se corrijan si son inexactos.</li>
              <li>Pedir que se eliminen cuando ya no sean necesarios.</li>
              <li>Oponerse a un uso concreto o revocar una autorización (arriba, en esta página).</li>
            </ul>
            <p className="flex items-start gap-2 pt-1">
              <Mail className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
              Para acceso, corrección o eliminación, diríjase a la dirección de {data.centerName}.
            </p>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle hint={history.length ? `${history.length} registros` : undefined}>Historial de decisiones</SectionTitle>
        <Card padded={false}>
          {history.length === 0 ? (
            <EmptyState icon={History} title="Sin decisiones registradas" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {history.map((h) => (
                <li key={h.id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700 dark:text-white/80">
                    <span className="font-medium">{childName(h.childId)}</span> · {CONSENT_LABEL[h.type]}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-white/45">
                    <Badge tone={h.granted ? 'green' : 'red'}>{h.granted ? 'Autorizó' : 'No autorizó'}</Badge>
                    {formatDateTime(h.createdAt)}
                    {h.by ? ` · ${h.by}` : ''}
                    {h.method === 'presencial' ? ' · en el centro' : ''} · v{h.policyVersion}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <ConfirmDialog
        open={!!pending}
        onClose={() => !saving && setPending(null)}
        onConfirm={confirm}
        loading={saving}
        variant={pending?.granted ? 'info' : 'warning'}
        title={
          pending
            ? `${pending.granted ? 'Autorizar' : 'Retirar'} "${CONSENT_LABEL[pending.type]}" de ${pending.child.firstName}`
            : ''
        }
        message={pending ? CHANGE_TEXT[pending.type][String(pending.granted)] : ''}
        details="Al confirmar declara ser el representante legal del niño o niña. Quedará registrada la fecha y el dispositivo."
        confirmText={pending?.granted ? 'Autorizar' : 'Retirar autorización'}
      />
    </div>
  )
}

function PolicyDisclosure({ policy }) {
  const [open, setOpen] = useState(false)
  return (
    <Card padded={false}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800 dark:text-white/85">{policy.title}</span>
          <span className="block text-xs text-slate-500 dark:text-white/45">
            Versión {policy.version} · publicada el {formatDateTime(policy.publishedAt)}
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-5 border-t border-slate-100 dark:border-white/5 pt-4">
          <PolicyText body={policy.body} />
        </div>
      )}
    </Card>
  )
}
