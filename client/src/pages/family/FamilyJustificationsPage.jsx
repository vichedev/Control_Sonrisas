import { useCallback, useState } from 'react'
import { MessageCircleHeart, Send } from '../../components/icons'
import { api, apiError, shortDate } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { useLiveReload } from '../../realtime'
import { useToasts } from '../../context/ToastsContext'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
  Loading,
  PageHeader,
  SectionTitle,
} from '../../components/ui'

const TYPES = [
  { value: 'enfermedad', label: 'Enfermedad' },
  { value: 'cita_medica', label: 'Cita médica' },
  { value: 'viaje', label: 'Viaje' },
  { value: 'familiar', label: 'Motivo familiar' },
  { value: 'tardanza', label: 'Llegará tarde' },
  { value: 'otro', label: 'Otro' },
]

const STATUS = {
  pending: ['En revisión', 'amber'],
  approved: ['Aprobada', 'green'],
  rejected: ['Rechazada', 'rose'],
}

/** El representante avisa de una ausencia sin tener que llamar por teléfono. */
export default function FamilyJustificationsPage() {
  const { pushToast } = useToasts()
  const [children, setChildren] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    childId: '',
    dateFrom: '',
    dateTo: '',
    type: 'enfermedad',
    reason: '',
  })

  // `silent`: recarga en vivo sin spinner ni toasts (el formulario no se toca).
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const [c, j] = await Promise.all([
        api.get('/family/children'),
        api.get('/family/justifications'),
      ])
      setChildren(c.data || [])
      setItems(j.data || [])
      if (c.data?.[0]) setForm((f) => ({ ...f, childId: f.childId || c.data[0].id }))
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['justification'] })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/family/justifications', {
        ...form,
        dateTo: form.dateTo || form.dateFrom,
      })
      pushToast({ type: 'success', message: 'Aviso enviado a la guardería' })
      setForm((f) => ({ ...f, dateFrom: '', dateTo: '', reason: '' }))
      load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo enviar el aviso') })
    } finally {
      setSaving(false)
    }
  }

  if (loading && !items.length && !children.length) return <Loading />

  return (
    <>
      <PageHeader
        title="Avisar una ausencia"
        subtitle="La coordinación la revisará y quedará registrada."
        icon={MessageCircleHeart}
      />

      <Card className="mb-5">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Niño" required>
              <select className={inputClass} value={form.childId} onChange={set('childId')} required>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motivo">
              <select className={inputClass} value={form.type} onChange={set('type')}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Desde" required>
              <input className={inputClass} type="date" value={form.dateFrom} onChange={set('dateFrom')} required />
            </Field>
            <Field label="Hasta" hint="Déjalo vacío si es un solo día.">
              <input className={inputClass} type="date" value={form.dateTo} onChange={set('dateTo')} />
            </Field>
          </div>
          <Field label="Cuéntanos qué pasó" required>
            <textarea
              className={inputClass}
              rows={3}
              value={form.reason}
              onChange={set('reason')}
              required
              placeholder="Amaneció con fiebre, lo llevamos al pediatra."
            />
          </Field>
          <Button type="submit" icon={Send} loading={saving}>
            Enviar aviso
          </Button>
        </form>
      </Card>

      <Card>
        <SectionTitle hint={`${items.length} aviso(s)`}>Avisos enviados</SectionTitle>
        {items.length === 0 ? (
          <EmptyState icon={MessageCircleHeart} title="Todavía no has enviado ningún aviso" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {items.map((j) => {
              const st = STATUS[j.status] || STATUS.pending
              return (
                <li key={j.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">
                      {j.child ? `${j.child.firstName} ${j.child.lastName}` : 'Niño'} ·{' '}
                      {shortDate(j.dateFrom)}
                      {j.dateTo !== j.dateFrom ? ` – ${shortDate(j.dateTo)}` : ''}
                    </p>
                    <Badge tone={st[1]}>{st[0]}</Badge>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-white/60">{j.reason}</p>
                  {j.adminNote && (
                    <p className="text-xs text-slate-400 dark:text-white/30 mt-0.5">
                      Respuesta de la guardería: {j.adminNote}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
