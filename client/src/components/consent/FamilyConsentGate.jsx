import { useCallback, useMemo, useState } from 'react'
import { api, apiError } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { Camera, ChevronDown, FileText, Info, ShieldCheck, WhatsappLogo } from '../icons'
import { Avatar, Button, Loading, SegmentedControl } from '../ui'
import PolicyText from './PolicyText'
import { CONSENT_TYPES } from './consentModel'

/** "Ahora no": oculta el flujo hasta cerrar la pestaña (no se guarda ninguna decisión). */
const LATER_KEY = 'sonrisas_consent_later'

const SECTION = {
  data_processing: {
    icon: FileText,
    question: (n) => `¿Acepta el tratamiento de los datos de ${n}?`,
    yes: 'Acepto',
    no: 'No acepto',
    noHint:
      'Sin esta aceptación el centro no puede registrar con normalidad el cuidado diario. La dirección se pondrá en contacto con usted para resolverlo.',
  },
  images: {
    icon: Camera,
    question: (n) => `¿Autoriza fotos de ${n}?`,
    yes: 'Sí, autorizo',
    no: 'No autorizo',
    noHint: 'No se tomarán fotos individuales. En las fotos de grupo se evitará que aparezca.',
  },
  whatsapp: {
    icon: WhatsappLogo,
    question: (n) => `¿Desea recibir avisos de ${n} por WhatsApp?`,
    yes: 'Sí',
    no: 'No',
    noHint: 'Seguirá viendo toda la información en este portal.',
  },
}

function readLater() {
  try {
    return sessionStorage.getItem(LATER_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Envuelve el portal familiar. Si hay consentimientos pendientes (primer ingreso o texto
 * actualizado), muestra a pantalla completa el flujo para decidir por cada niño; luego
 * deja pasar al contenido. Si la consulta falla, no bloquea el portal.
 *
 * Uso (FamilyLayout): <FamilyConsentGate><Outlet /></FamilyConsentGate>
 */
export default function FamilyConsentGate({ children }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [later, setLater] = useState(readLater)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/family/consents')
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])
  useLoadEffect(load)

  if (loading) return <Loading label="Cargando…" />
  if (!data?.hasPending || later) return children

  return (
    <ConsentFlow
      data={data}
      onDone={(next) => setData(next)}
      onLater={() => {
        try {
          sessionStorage.setItem(LATER_KEY, '1')
        } catch {
          // sin sessionStorage: sólo se oculta en esta vista
        }
        setLater(true)
      }}
    />
  )
}

function ConsentFlow({ data, onDone, onLater }) {
  const [choices, setChoices] = useState({})
  const [legalRep, setLegalRep] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const kids = useMemo(() => new Map(data.children.map((c) => [c.id, c])), [data.children])
  const byType = useMemo(() => {
    const m = {}
    for (const p of data.pending) (m[p.type] ||= []).push(p)
    return m
  }, [data.pending])
  const names = data.children.map((c) => c.firstName || c.name)
  const namesText = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || 'su hijo o hija'
  const total = data.pending.length
  const answered = data.pending.filter((p) => typeof choices[`${p.childId}:${p.type}`] === 'boolean').length
  const ready = answered === total && legalRep

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const decisions = data.pending.map((p) => ({
        childId: p.childId,
        type: p.type,
        granted: choices[`${p.childId}:${p.type}`],
      }))
      const res = await api.post('/family/consents/batch', { legalRepresentative: true, decisions })
      onDone(res.data)
    } catch (err) {
      setError(apiError(err, 'No se pudieron guardar sus respuestas. Intente de nuevo.'))
    } finally {
      setSaving(false)
    }
  }

  const anyOutdated = data.pending.some((p) => p.outdated)

  return (
    <div>
      <div className="max-w-2xl mx-auto py-2 sm:py-6">
        <header className="mb-6">
          <span className="inline-flex w-10 h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 items-center justify-center text-accent-text mb-4">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Privacidad de {namesText}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-white/60 leading-relaxed">
            {anyOutdated
              ? `${data.centerName} actualizó sus textos de privacidad. Antes de continuar, revise y confirme sus decisiones.`
              : `Antes de usar el portal, ${data.centerName} necesita su autorización como representante legal, según la Ley Orgánica de Protección de Datos Personales (LOPDP).`}{' '}
            Puede cambiar estas decisiones cuando quiera desde “Privacidad”.
          </p>
        </header>

        <div className="space-y-4">
          {CONSENT_TYPES.filter((t) => byType[t]?.length).map((type) => (
            <PolicySection
              key={type}
              type={type}
              policy={data.policies[type]}
              items={byType[type]}
              kids={kids}
              choices={choices}
              setChoice={(key, v) => setChoices((c) => ({ ...c, [key]: v }))}
            />
          ))}

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-surface p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={legalRep}
              onChange={(e) => setLegalRep(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
            />
            <span className="text-sm text-slate-700 dark:text-white/80">
              Soy el representante legal de {namesText}, he leído la información anterior y tengo la facultad de
              dar o negar estas autorizaciones.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <Button variant="ghost" onClick={onLater} disabled={saving}>
              Ahora no
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 dark:text-white/45 tabular-nums">
                {answered} de {total} respondidas
              </span>
              <Button onClick={submit} loading={saving} disabled={!ready} size="lg">
                Guardar y continuar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PolicySection({ type, policy, items, kids, choices, setChoice }) {
  const [open, setOpen] = useState(type === 'data_processing')
  const meta = SECTION[type]
  const Icon = meta.icon
  if (!policy) return null
  return (
    <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-surface shadow-xs">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Icon className="w-5 h-5 mt-0.5 text-slate-500 dark:text-white/50 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900 dark:text-white">{policy.title}</h2>
            <p className="text-xs text-slate-500 dark:text-white/45 mt-0.5">
              {policy.required ? 'Obligatorio leer' : 'Voluntario'} · versión {policy.version}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
        >
          {open ? 'Ocultar el texto' : 'Leer el texto completo'}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open && (
          <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/3 p-4">
            <PolicyText body={policy.body} />
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
        {items.map((p) => {
          const child = kids.get(p.childId)
          const key = `${p.childId}:${type}`
          const value = choices[key]
          return (
            <div key={key} className="p-4 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={child?.photoUrl} name={child?.name || ''} size="sm" />
                  <p className="text-sm font-medium text-slate-800 dark:text-white/85">
                    {meta.question(child?.firstName || child?.name || 'su hijo o hija')}
                  </p>
                </div>
                <SegmentedControl
                  ariaLabel={meta.question(child?.firstName || '')}
                  value={value === true ? 'yes' : value === false ? 'no' : null}
                  onChange={(v) => setChoice(key, v === 'yes')}
                  options={[
                    { value: 'yes', label: meta.yes },
                    { value: 'no', label: meta.no },
                  ]}
                />
              </div>
              {value === false && (
                <p className="mt-2 flex gap-2 text-xs text-slate-600 dark:text-white/55">
                  <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {meta.noHint}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
