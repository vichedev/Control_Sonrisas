import { useRef, useState } from 'react'
import { CheckCircle2, Image as ImageIcon, Info, Palette, Trash2, Upload } from '../components/icons'
import { api, brandingLogoUrl } from '../api/client'
import { useBranding } from '../context/BrandingContext'
import { useToasts } from '../context/ToastsContext'
import Logo from '../components/Logo'
import { Badge, Button, Card, PageHeader, inputClass } from '../components/ui'

// '#4f46e5' es el valor por defecto del servidor = "sin color propio" → la app usa su azul.
const DEFAULT_COLOR = '#4f46e5'
const DEFAULT_ACCENT = '#2563eb'
const PRESETS = [
  { name: 'Predeterminado (azul)', color: DEFAULT_COLOR, swatch: DEFAULT_ACCENT },
  { name: 'Verde azulado', color: '#0f766e' },
  { name: 'Esmeralda', color: '#047857' },
  { name: 'Cian', color: '#0e7490' },
  { name: 'Violeta', color: '#6d28d9' },
  { name: 'Frambuesa', color: '#be123c' },
  { name: 'Ámbar oscuro', color: '#b45309' },
  { name: 'Pizarra', color: '#334155' },
]

/** Contraste del texto blanco sobre el color (WCAG). Igual que BrandingContext. */
function whiteContrast(hex) {
  const n = String(hex || '').replace('#', '').slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(n)) return 0
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)
}

/** Color que realmente se verá como acento con el valor elegido. */
function effectiveAccent(color) {
  const c = String(color || '').toLowerCase()
  if (c.slice(0, 7) === DEFAULT_COLOR || whiteContrast(c) < 4.5) return DEFAULT_ACCENT
  return c.slice(0, 7)
}

export default function BrandingPage() {
  const { branding, reload } = useBranding()
  // El formulario se re-monta (key) cuando cambia la marca guardada: así su estado
  // inicial sale de las props sin sincronizarlo con un efecto.
  const key = `${branding.companyName}|${branding.tagline}|${branding.primaryColor}`
  return <BrandingForm key={key} branding={branding} reload={reload} />
}

function BrandingForm({ branding, reload }) {
  const { pushToast } = useToasts()
  const fileRef = useRef(null)

  const [companyName, setCompanyName] = useState(branding.companyName)
  const [tagline, setTagline] = useState(branding.tagline)
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor)
  const [logoBase64, setLogoBase64] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 4 * 1024 * 1024) { pushToast({ type: 'error', title: 'Logo muy grande', subtitle: 'Máximo 4 MB' }); return }
    const reader = new FileReader()
    reader.onload = () => { setLogoBase64(String(reader.result || '')); setLogoPreview(String(reader.result || '')); setRemoveLogo(false) }
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!companyName.trim()) { pushToast({ type: 'error', title: 'Nombre requerido' }); return }
    setSubmitting(true)
    try {
      const body = {
        companyName: companyName.trim(),
        tagline: tagline.trim(),
        primaryColor,
      }
      if (logoBase64) body.logoBase64 = logoBase64
      else if (removeLogo) body.logoBase64 = ''
      await api.patch('/branding', body)
      setLogoBase64(null); setLogoPreview(null); setRemoveLogo(false)
      await reload()
      pushToast({ type: 'success', title: 'Marca actualizada' })
    } catch (err) {
      const m = err?.response?.data?.message
      pushToast({ type: 'error', title: 'No se pudo guardar', subtitle: Array.isArray(m) ? m.join(' · ') : m || '' })
    } finally { setSubmitting(false) }
  }

  const currentLogo = logoPreview || (!removeLogo && branding.logoUrl ? brandingLogoUrl(branding.logoUrl) : null)

  return (
    <div className="space-y-6">
      <PageHeader icon={Palette} title="Marca y logo" subtitle="Personaliza el nombre, logo y color principal del sistema." />

      <div className="grid xl:grid-cols-[1fr_360px] gap-6 items-start">
        <form onSubmit={submit} className="rounded-xl bg-white dark:bg-surface border border-slate-200 dark:border-white/8 shadow-xs p-5 sm:p-6 space-y-5 order-2 xl:order-1">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nombre de la empresa">
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required maxLength={120} className={inputCls} />
          </Field>
          <Field label="Tagline (descripción corta)">
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={200} className={inputCls} placeholder="Control de asistencia con reconocimiento facial" />
          </Field>
        </div>

        <Field label="Logo (cuadrado, JPG/PNG/SVG hasta 4 MB)">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-20 h-20 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 overflow-hidden flex items-center justify-center">
              {currentLogo ? <img src={currentLogo} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-8 h-8 text-slate-300" />}
            </div>
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 shadow-xs dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 text-slate-700 dark:text-white/80 text-xs font-medium transition">
                <Upload className="w-3.5 h-3.5" /> Subir logo
              </button>
              {branding.logoUrl && !branding.logoIsDefault && !logoPreview && (
                <button type="button" onClick={() => setRemoveLogo((r) => !r)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${removeLogo ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20' : 'bg-white border border-slate-200 shadow-xs hover:bg-red-50 hover:text-red-700 dark:bg-white/5 dark:border-white/10 dark:hover:bg-red-500/10 text-slate-700 dark:text-white/80'}`}>
                  <Trash2 className="w-3.5 h-3.5" /> {removeLogo ? 'Logo se quitará al guardar' : 'Quitar logo actual'}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            </div>
          </div>
        </Field>

        <Field label="Color principal" icon={Palette}>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-14 rounded-lg cursor-pointer border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5" />
            <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className={inputCls + ' w-32! font-mono'} placeholder="#4f46e5" />
            <div className="flex items-center gap-1 flex-wrap ml-1">
              {PRESETS.map((p) => (
                <button key={p.color} type="button" onClick={() => setPrimaryColor(p.color)} title={p.name} aria-label={p.name} className={`w-7 h-7 rounded-md ring-offset-2 ring-offset-white dark:ring-offset-surface ${primaryColor.toLowerCase() === p.color ? 'ring-2 ring-slate-900 dark:ring-white' : 'ring-1 ring-slate-900/10 dark:ring-white/15'}`} style={{ background: p.swatch || p.color }} />
              ))}
            </div>
          </div>
        </Field>

        <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-white/50 -mt-2">
          <Info className="w-4 h-4 shrink-0" />
          <span>
            Este color se usa como acento de la app (botones, menú activo, enlaces) sólo si el texto blanco
            encima se lee bien (contraste 4.5:1). Si no, se mantiene el azul predeterminado. Los colores de
            estado (verde, ámbar, rojo) no cambian.
          </span>
        </p>

        <div className="flex justify-end">
          <Button type="submit" icon={CheckCircle2} loading={submitting}>
            {submitting ? 'Guardando…' : 'Guardar marca'}
          </Button>
        </div>
        </form>

        {/* Vista previa — fija arriba en pantallas anchas */}
        <Card className="order-1 xl:order-2 xl:sticky xl:top-20">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-3">Vista previa</p>
          <Logo size="lg" to={null} />
          {branding.tagline && <p className="text-sm text-slate-500 dark:text-white/60 mt-2">{branding.tagline}</p>}
          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/8">
            <p className="text-xs text-slate-500 dark:text-white/45 mb-2">Acento con el color elegido</p>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center min-h-9 px-3.5 rounded-lg text-sm font-medium text-white shadow-xs"
                style={{ backgroundColor: effectiveAccent(primaryColor) }}
              >
                Botón principal
              </span>
              <span
                className="inline-flex items-center min-h-9 px-3 rounded-lg text-sm font-medium"
                style={{
                  color: effectiveAccent(primaryColor),
                  backgroundColor: `color-mix(in oklab, ${effectiveAccent(primaryColor)} 10%, transparent)`,
                }}
              >
                Ítem activo
              </span>
            </div>
            <div className="mt-3">
              {primaryColor.toLowerCase().slice(0, 7) === DEFAULT_COLOR ? (
                <Badge tone="slate">Se usa el azul predeterminado</Badge>
              ) : whiteContrast(primaryColor) < 4.5 ? (
                <Badge tone="amber">Poco contraste: se mantiene el azul</Badge>
              ) : (
                <Badge tone="green">Se usará como acento</Badge>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

const inputCls = inputClass
function Field({ label, icon: Icon, children }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />} {label}
      </label>
      {children}
    </div>
  )
}
