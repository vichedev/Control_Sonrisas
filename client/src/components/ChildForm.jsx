import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Baby,
  Check,
  HeartPulse,
  Link2,
  Plus,
  Search,
  Trash2,
  Users,
  Utensils,
} from './icons'
import { api, apiError, todayKey } from '../api/client'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import Modal from './Modal'
import PhotoCapture from './PhotoCapture'
import { Avatar, Badge, Button, Field, inputClass } from './ui'
import { compactDoc, documentIdError } from './childSearch'

const emptyGuardian = () => ({
  name: '',
  email: '',
  phone: '',
  documentId: '',
  relationship: '',
  isPrimary: false,
  canPickup: true,
  receivesReport: true,
  createAccount: true,
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Pasos del formulario. Representantes sólo existe en el alta. */
const STEPS = [
  { key: 'child', label: 'Datos del niño', short: 'Datos', icon: Baby },
  { key: 'health', label: 'Salud', short: 'Salud', icon: HeartPulse },
  { key: 'routines', label: 'Rutinas', short: 'Rutinas', icon: Utensils },
  { key: 'guardians', label: 'Representantes', short: 'Familia', icon: Users },
]

/** Validación en el cliente con los mismos límites que el DTO del backend. */
function validate(form, guardians) {
  const e = {}
  if (form.firstName.trim().length < 2) e.firstName = 'Escribe al menos 2 letras.'
  if (form.lastName.trim().length < 2) e.lastName = 'Escribe al menos 2 letras.'
  const docErr = documentIdError(form.documentId)
  if (docErr) e.documentId = docErr
  if (!form.birthDate) e.birthDate = 'La fecha de nacimiento es obligatoria.'
  else if (form.birthDate > todayKey()) e.birthDate = 'La fecha no puede ser futura.'
  if (form.enrolledAt && form.birthDate && form.enrolledAt < form.birthDate) {
    e.enrolledAt = 'No puede ser anterior al nacimiento.'
  }
  guardians.forEach((g, i) => {
    if (g.existing !== undefined) {
      if (!g.existing?.id) e[`g${i}.existing`] = 'Elige un representante de la lista o quita esta fila.'
      return
    }
    const touched = [g.name, g.phone, g.email, g.documentId, g.relationship].some((v) => v.trim())
    if (!touched) return
    if (g.name.trim().length < 3) e[`g${i}.name`] = 'Escribe el nombre (mínimo 3 letras).'
    if (g.email.trim() && !EMAIL_RE.test(g.email.trim())) e[`g${i}.email`] = 'Correo no válido.'
  })
  return e
}

const stepOfError = (key) => {
  if (key.startsWith('g')) return 3
  return 0
}

/** Mensaje de error bajo un campo. */
function FieldError({ children, id }) {
  if (!children) return null
  return (
    <span id={id} role="alert" className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 mt-1">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {children}
    </span>
  )
}

const errClass = (has) => (has ? ' border-red-400! ring-2 ring-red-400/30' : '')

/** Casilla con área táctil cómoda y texto siempre visible. */
function Check2({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 min-h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-700 dark:text-white/75 cursor-pointer has-checked:border-emerald-300 has-checked:bg-emerald-50 dark:has-checked:border-emerald-500/30 dark:has-checked:bg-emerald-500/10">
      <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/**
 * Alta y edición de la ficha de un niño, por pasos: Datos → Salud → Rutinas → Representantes.
 *
 * En el alta permite registrar de una vez a los representantes: si no se hace aquí, en
 * la práctica nadie vuelve después y el niño se queda sin nadie a quien enviarle el
 * reporte, que es justo lo que el sistema existe para hacer.
 */
export default function ChildForm({ child, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const { canManage } = useAuth()
  const editing = !!child
  const steps = editing ? STEPS.slice(0, 3) : STEPS

  const [classrooms, setClassrooms] = useState([])
  // El estado arranca ya con los datos del niño en vez de sincronizarse con un efecto:
  // el modal se monta una vez por edición, así que no hay nada que "re-sincronizar".
  const [form, setForm] = useState(() => ({
    code: child?.code || '',
    documentId: child?.documentId || '',
    firstName: child?.firstName || '',
    lastName: child?.lastName || '',
    birthDate: (child?.birthDate || '').slice(0, 10),
    gender: child?.gender || 'other',
    classroomId: child?.classroomId || '',
    allergies: child?.allergies || '',
    medicalConditions: child?.medicalConditions || '',
    medications: child?.medications || '',
    bloodType: child?.bloodType || '',
    pediatricianName: child?.pediatricianName || '',
    pediatricianPhone: child?.pediatricianPhone || '',
    insurance: child?.insurance || '',
    emergencyContactName: child?.emergencyContactName || '',
    emergencyContactPhone: child?.emergencyContactPhone || '',
    dietaryNotes: child?.dietaryNotes || '',
    napNotes: child?.napNotes || '',
    authorizedPickupNotes: child?.authorizedPickupNotes || '',
    enrolledAt: (child?.enrolledAt || '').slice(0, 10),
    active: child?.active ?? true,
  }))
  const [photo, setPhoto] = useState('')
  const [guardians, setGuardians] = useState([])
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState({})
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/classrooms', { params: { includeInactive: 'false' } })
      .then((r) => setClassrooms(r.data || []))
      .catch(() => {})
  }, [])

  const errors = validate(form, guardians)
  // Un error se muestra si el campo ya se tocó o si se intentó avanzar/guardar.
  const shown = (key) => (showAll || touched[key] ? errors[key] : '')
  const blur = (key) => () => setTouched((t) => ({ ...t, [key]: true }))

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const setGuardian = (i, key, value) =>
    setGuardians((list) => list.map((g, idx) => (idx === i ? { ...g, [key]: value } : g)))

  const stepHasErrors = (idx) => Object.keys(errors).some((k) => stepOfError(k) === idx)
  const isLast = step === steps.length - 1

  const next = () => {
    if (stepHasErrors(step)) {
      setShowAll(true)
      return
    }
    setStep((s) => Math.min(s + 1, steps.length - 1))
  }

  const submit = async (e) => {
    e?.preventDefault()
    // En el alta, Enter en un campo avanza de paso en vez de inscribir a medias.
    if (!editing && !isLast) {
      next()
      return
    }
    const keys = Object.keys(errors)
    if (keys.length) {
      setShowAll(true)
      setStep(stepOfError(keys[0]))
      setError('Revisa los campos marcados.')
      return
    }
    setError('')
    setSaving(true)
    try {
      // En la edición un campo vaciado tiene que viajar como vacío/null: con `undefined`
      // el backend lo interpreta como "sin cambios" y la sala o la matrícula no se borraban.
      const payload = {
        ...form,
        code: editing ? form.code.trim() : form.code || undefined,
        // Vacío = sin cédula (en la edición, null la borra).
        documentId: compactDoc(form.documentId) || (editing ? null : undefined),
        classroomId: form.classroomId || (editing ? null : undefined),
        enrolledAt: form.enrolledAt || (editing ? null : undefined),
        photo: photo || undefined,
      }
      if (!editing) {
        payload.guardians = guardians
          .filter((g) => (g.existing !== undefined ? !!g.existing?.id : g.name.trim()))
          .map(({ existing, ...g }) =>
            existing
              ? {
                  guardianId: existing.id,
                  relationship: g.relationship,
                  isPrimary: g.isPrimary,
                  canPickup: g.canPickup,
                  receivesReport: g.receivesReport,
                }
              : { ...g, email: g.email || undefined },
          )
      }
      const res = editing
        ? await api.patch(`/children/${child.id}`, payload)
        : await api.post('/children', payload)
      pushToast({ type: 'success', message: editing ? 'Ficha actualizada' : 'Niño inscrito' })
      const reused = res.data?.existingAccounts || []
      if (reused.length) {
        pushToast({
          type: 'info',
          duration: 9000,
          message: `${reused.map((g) => g.name).join(', ')}: ya tiene acceso al portal. Si no recuerda su contraseña, usa «Restablecer acceso».`,
        })
      }
      onSaved(res.data)
    } catch (err) {
      setError(apiError(err, 'No se pudo guardar la ficha'))
    } finally {
      setSaving(false)
    }
  }

  const filledGuardians = guardians.filter((g) => (g.existing !== undefined ? g.existing?.id : g.name.trim()))
  const noWhatsapp = !editing && isLast && !filledGuardians.some((g) => g.existing?.phone || g.phone?.trim())

  const footer = (
    <div className="flex w-full items-center gap-2">
      <span className="hidden sm:inline-flex">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </span>
      <span className="flex-1" />
      {editing ? (
        <Button onClick={submit} loading={saving} icon={Check} size="lg" className="w-full sm:w-auto">
          Guardar cambios
        </Button>
      ) : (
        <>
          {step > 0 && (
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep((s) => s - 1)} size="lg">
              Atrás
            </Button>
          )}
          {isLast ? (
            <Button onClick={submit} loading={saving} icon={Check} size="lg" className="flex-1 sm:flex-none">
              Inscribir a {form.firstName.trim() || 'niño'}
            </Button>
          ) : (
            <Button onClick={next} size="lg" className="flex-1 sm:flex-none">
              <span>
                Siguiente<span className="hidden sm:inline">: {steps[step + 1].label}</span>
              </span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </>
      )}
    </div>
  )

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={editing ? `Editar ficha de ${child.firstName}` : 'Inscribir niño'}
      subtitle={editing ? 'Los datos de salud se muestran destacados en el panel del día.' : `Paso ${step + 1} de ${steps.length} · ${steps[step].label}`}
      footer={footer}
    >
      {/* Pasos: en la edición funcionan como pestañas libres */}
      <ol className="grid gap-1.5 mb-5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, idx) => {
          const Icon = s.icon
          const current = idx === step
          const done = !editing && idx < step
          const bad = showAll && stepHasErrors(idx)
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => (editing || idx <= step || !stepHasErrors(step) ? setStep(idx) : next())}
                aria-current={current ? 'step' : undefined}
                className={`w-full flex flex-col sm:flex-row items-center gap-1 sm:gap-2 px-2 py-2 rounded-lg text-xs font-semibold transition border ${
                  current
                    ? 'border-accent/40 bg-accent-soft text-accent-text'
                    : bad
                      ? 'border-red-200 text-red-600 dark:border-red-500/30 dark:text-red-300'
                      : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                <span
                  className={`w-7 h-7 shrink-0 rounded-full inline-flex items-center justify-center ${
                    done
                      ? 'bg-emerald-500 text-white'
                      : current
                        ? 'bg-accent text-accent-fg'
                        : 'bg-slate-100 dark:bg-white/10'
                  }`}
                >
                  {done ? <Check className="w-4 h-4" /> : bad ? <AlertTriangle className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </span>
                <span className="truncate">
                  <span className="sm:hidden">{s.short}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <form onSubmit={submit} noValidate className="space-y-4">
        {steps[step].key === 'child' && (
          <div className="grid sm:grid-cols-[200px_1fr] gap-5">
            <div>
              {editing && child.photoUrl && !photo && (
                <div className="flex items-center gap-2 mb-2 text-xs text-slate-500 dark:text-white/45">
                  <Avatar src={child.photoUrl} name={child.fullName} size="sm" /> Foto actual
                </div>
              )}
              <PhotoCapture value={photo} onChange={setPhoto} label={editing ? 'Cambiar foto' : 'Foto (opcional)'} compact />
            </div>
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Nombres" required>
                  <input
                    className={inputClass + errClass(shown('firstName'))}
                    value={form.firstName}
                    onChange={set('firstName')}
                    onBlur={blur('firstName')}
                    aria-invalid={!!shown('firstName')}
                    autoComplete="off"
                    autoFocus={!editing}
                  />
                  <FieldError>{shown('firstName')}</FieldError>
                </Field>
                <Field label="Apellidos" required>
                  <input
                    className={inputClass + errClass(shown('lastName'))}
                    value={form.lastName}
                    onChange={set('lastName')}
                    onBlur={blur('lastName')}
                    aria-invalid={!!shown('lastName')}
                    autoComplete="off"
                  />
                  <FieldError>{shown('lastName')}</FieldError>
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Fecha de nacimiento" required>
                  <input
                    className={inputClass + errClass(shown('birthDate'))}
                    type="date"
                    max={todayKey()}
                    value={form.birthDate}
                    onChange={set('birthDate')}
                    onBlur={blur('birthDate')}
                    aria-invalid={!!shown('birthDate')}
                  />
                  <FieldError>{shown('birthDate')}</FieldError>
                </Field>
                <Field label="Género">
                  <select className={inputClass} value={form.gender} onChange={set('gender')}>
                    <option value="m">Masculino</option>
                    <option value="f">Femenino</option>
                    <option value="other">Prefiero no decirlo</option>
                  </select>
                </Field>
              </div>
              <Field
                label="Cédula (opcional)"
                hint={shown('documentId') ? undefined : 'Si aún no tiene cédula, déjalo vacío. También vale un pasaporte.'}
              >
                <input
                  className={inputClass + errClass(shown('documentId')) + ' tabular-nums sm:max-w-xs'}
                  value={form.documentId}
                  onChange={set('documentId')}
                  onBlur={blur('documentId')}
                  aria-invalid={!!shown('documentId')}
                  inputMode={/^[\d\s.-]*$/.test(form.documentId) ? 'numeric' : 'text'}
                  maxLength={24}
                  placeholder="Ej. 1712345678"
                  autoComplete="off"
                />
                <FieldError>{shown('documentId')}</FieldError>
              </Field>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Sala" hint={!form.classroomId ? 'Sin sala no aparece en el día de ninguna educadora.' : undefined}>
                  <select className={inputClass} value={form.classroomId} onChange={set('classroomId')}>
                    <option value="">Sin asignar</option>
                    {classrooms.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Fecha de inscripción">
                  <input
                    className={inputClass + errClass(shown('enrolledAt'))}
                    type="date"
                    value={form.enrolledAt}
                    onChange={set('enrolledAt')}
                    onBlur={blur('enrolledAt')}
                  />
                  <FieldError>{shown('enrolledAt')}</FieldError>
                </Field>
                <Field label="Matrícula">
                  <input className={inputClass} value={form.code} onChange={set('code')} placeholder="Opcional" />
                </Field>
              </div>
              {editing && (
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                    form.active
                      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5'
                      : 'border-red-200 bg-red-50/60 dark:border-red-500/20 dark:bg-red-500/5'
                  }`}
                >
                  <input type="checkbox" className="w-4 h-4 mt-0.5 accent-emerald-600" checked={form.active} onChange={set('active')} />
                  <span className="text-sm">
                    <strong className="block text-slate-800 dark:text-white">
                      {form.active ? 'Niño activo' : 'Dado de baja'}
                    </strong>
                    <span className="text-slate-500 dark:text-white/50">
                      Desmarca para darlo de baja: deja de aparecer en el día, pero se conserva su historial.
                    </span>
                  </span>
                </label>
              )}
            </div>
          </div>
        )}

        {steps[step].key === 'health' && (
          <div className="space-y-3">
            <Field label="Alergias" hint="Se muestra en rojo en el panel del día y en cada registro. Vacío = sin alergias conocidas.">
              <textarea
                className={`${inputClass} ${form.allergies ? 'border-red-300 dark:border-red-500/40 bg-red-50/40 dark:bg-red-500/5' : ''}`}
                rows={2}
                value={form.allergies}
                onChange={set('allergies')}
                placeholder="Ej.: maní, lactosa, penicilina"
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Condiciones médicas">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.medicalConditions}
                  onChange={set('medicalConditions')}
                  placeholder="Asma, epilepsia…"
                />
              </Field>
              <Field label="Medicación habitual">
                <textarea className={inputClass} rows={2} value={form.medications} onChange={set('medications')} placeholder="Nombre, dosis y horario" />
              </Field>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Tipo de sangre">
                <input className={inputClass} value={form.bloodType} onChange={set('bloodType')} placeholder="O+" maxLength={8} />
              </Field>
              <Field label="Seguro médico">
                <input className={inputClass} value={form.insurance} onChange={set('insurance')} />
              </Field>
              <Field label="Pediatra">
                <input className={inputClass} value={form.pediatricianName} onChange={set('pediatricianName')} />
              </Field>
              <Field label="Tel. del pediatra">
                <input className={inputClass} type="tel" inputMode="tel" value={form.pediatricianPhone} onChange={set('pediatricianPhone')} />
              </Field>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/40 mb-2">
                Contacto de emergencia
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Nombre">
                  <input className={inputClass} value={form.emergencyContactName} onChange={set('emergencyContactName')} />
                </Field>
                <Field label="Teléfono">
                  <input
                    className={inputClass}
                    type="tel"
                    inputMode="tel"
                    value={form.emergencyContactPhone}
                    onChange={set('emergencyContactPhone')}
                  />
                </Field>
              </div>
            </div>
          </div>
        )}

        {steps[step].key === 'routines' && (
          <div className="space-y-3">
            <Field label="Alimentación" hint="Dieta, texturas, biberón, lo que no come…">
              <textarea className={inputClass} rows={3} value={form.dietaryNotes} onChange={set('dietaryNotes')} />
            </Field>
            <Field label="Siesta" hint="Horario habitual, cómo se duerme, objeto de apego…">
              <textarea className={inputClass} rows={2} value={form.napNotes} onChange={set('napNotes')} />
            </Field>
            <Field label="Otras personas autorizadas a retirarlo" hint="Además de los representantes marcados con «Puede retirar».">
              <textarea
                className={inputClass}
                rows={2}
                value={form.authorizedPickupNotes}
                onChange={set('authorizedPickupNotes')}
                placeholder="Nombre y cédula"
              />
            </Field>
          </div>
        )}

        {steps[step].key === 'guardians' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-white/50">
              Quien recibe el reporte diario por WhatsApp y entra al portal familiar. Puedes añadirlos después desde la ficha.
            </p>
            {guardians.map((g, i) => (
              <div key={i} className="rounded-xl border border-slate-200 dark:border-white/10 p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/40">
                    {g.existing !== undefined ? 'Representante existente' : `Representante ${i + 1}`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setGuardians((l) => l.filter((_, idx) => idx !== i))}
                    className="inline-flex items-center gap-1 min-h-9 px-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Quitar
                  </button>
                </div>
                {g.existing !== undefined ? (
                  <>
                    <GuardianPicker
                      value={g.existing}
                      onChange={(v) => setGuardian(i, 'existing', v)}
                      excludeIds={guardians.filter((o, idx) => idx !== i && o.existing).map((o) => o.existing.id)}
                    />
                    <FieldError>{shown(`g${i}.existing`)}</FieldError>
                    <Field label="Parentesco con este niño">
                      <input
                        className={inputClass}
                        value={g.relationship}
                        onChange={(e) => setGuardian(i, 'relationship', e.target.value)}
                        placeholder="Madre, padre…"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Nombre" required>
                        <input
                          className={inputClass + errClass(shown(`g${i}.name`))}
                          value={g.name}
                          onChange={(e) => setGuardian(i, 'name', e.target.value)}
                          onBlur={blur(`g${i}.name`)}
                        />
                        <FieldError>{shown(`g${i}.name`)}</FieldError>
                      </Field>
                      <Field label="Parentesco">
                        <input
                          className={inputClass}
                          value={g.relationship}
                          onChange={(e) => setGuardian(i, 'relationship', e.target.value)}
                          placeholder="Madre, padre…"
                        />
                      </Field>
                      <Field label="WhatsApp" hint="Sin el número no recibe el reporte.">
                        <input
                          className={inputClass}
                          type="tel"
                          inputMode="tel"
                          value={g.phone}
                          onChange={(e) => setGuardian(i, 'phone', e.target.value)}
                          placeholder="0987654321"
                        />
                      </Field>
                      <Field label="Cédula">
                        <input
                          className={inputClass}
                          value={g.documentId}
                          onChange={(e) => setGuardian(i, 'documentId', e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Correo" hint="Necesario para entrar al portal familiar.">
                      <input
                        className={inputClass + errClass(shown(`g${i}.email`))}
                        type="email"
                        value={g.email}
                        onChange={(e) => setGuardian(i, 'email', e.target.value)}
                        onBlur={blur(`g${i}.email`)}
                      />
                      <FieldError>{shown(`g${i}.email`)}</FieldError>
                    </Field>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  {[
                    ['isPrimary', 'Contacto principal'],
                    ['canPickup', 'Puede retirar'],
                    ['receivesReport', 'Recibe reporte'],
                    ...(g.existing === undefined ? [['createAccount', 'Crear acceso al portal']] : []),
                  ].map(([key, label]) => (
                    <Check2 key={key} label={label} checked={g[key]} onChange={(v) => setGuardian(i, key, v)} />
                  ))}
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                icon={Plus}
                onClick={() => setGuardians((l) => [...l, emptyGuardian()])}
              >
                {guardians.length ? 'Añadir otro representante' : 'Añadir representante'}
              </Button>
              {canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  icon={Link2}
                  onClick={() => setGuardians((l) => [...l, { ...emptyGuardian(), existing: null }])}
                >
                  Vincular existente (hermanos)
                </Button>
              )}
            </div>

            {noWhatsapp && (
              <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                Sin un representante con WhatsApp, nadie recibirá el reporte diario de este niño.
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {/* Permite enviar con Enter */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}

/** Quita tildes y pasa a minúsculas para buscar "maria" y encontrar "María". */
const norm = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Buscador de representantes ya registrados, para enlazar hermanos sin duplicar la
 * cuenta del portal. Usa `GET /children/guardians?q=`, que sólo pueden consultar
 * dirección y coordinación: no mostrarlo a educadoras.
 */
export function GuardianPicker({ value, onChange, excludeIds = [] }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const excludeKey = excludeIds.join(',')

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const term = q.trim()
        const res = await api.get('/children/guardians', { params: term ? { q: term } : {} })
        if (cancelled) return
        const list = Array.isArray(res.data) ? res.data : []
        const excluded = new Set(excludeKey ? excludeKey.split(',') : [])
        // Filtro local además del del servidor, por si este ignorase `q`.
        const nq = norm(term)
        setResults(
          list
            .filter((g) => !excluded.has(g.id))
            .filter(
              (g) => !nq || [g.name, g.email, g.phone, g.documentId].some((f) => norm(f).includes(nq)),
            )
            .slice(0, 30),
        )
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q, excludeKey])

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className={`${inputClass} pl-9`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, cédula, teléfono o correo…"
          aria-label="Buscar representante"
        />
      </div>
      <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
        {loading && results.length === 0 ? (
          <p className="p-3 text-sm text-slate-400 dark:text-white/30">Buscando…</p>
        ) : results.length === 0 ? (
          <p className="p-3 text-sm text-slate-400 dark:text-white/30">Sin coincidencias.</p>
        ) : (
          results.map((g) => {
            const selected = value?.id === g.id
            return (
              <button
                type="button"
                key={g.id}
                onClick={() => onChange(selected ? null : g)}
                aria-pressed={selected}
                className={`w-full text-left px-3 py-2.5 transition ${
                  selected ? 'bg-accent-soft' : 'hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-white flex flex-wrap items-center gap-2">
                  {g.name}
                  {selected && <Badge tone="accent">Seleccionado</Badge>}
                  {g.active === false && <Badge tone="slate">Inactivo</Badge>}
                  {g.hasPortalAccess && <Badge tone="green">Con acceso al portal</Badge>}
                </p>
                <p className="text-xs text-slate-500 dark:text-white/40">
                  {[g.documentId, g.phone, g.email].filter(Boolean).join(' · ') || '—'}
                </p>
                {g.children?.length > 0 && (
                  <p className="text-xs text-slate-400 dark:text-white/30">
                    Representante de: {g.children.map((c) => c.name).join(', ')}
                  </p>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
