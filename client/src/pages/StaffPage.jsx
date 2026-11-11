import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Pencil, Plus, Trash2, Unlock, UserCog } from '../components/icons'
import { api, apiError, shortDate } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useToasts } from '../context/ToastsContext'
import { ROLE_LABEL, useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import CredentialsModal from '../components/CredentialsModal'
import ConfirmDialog from '../components/ConfirmDialog'
import PhotoCapture from '../components/PhotoCapture'
import SmartTable, { RowMenu } from '../components/SmartTable'
import { Avatar, Badge, Button, Field, inputClass, PageHeader } from '../components/ui'

const ROLES = [
  { value: 'teacher', label: 'Educadora' },
  { value: 'coordinator', label: 'Coordinación' },
  { value: 'admin', label: 'Dirección' },
]

const ROLE_TONE = { admin: 'accent', coordinator: 'sky', teacher: 'slate' }

const isLocked = (p) => p.lockedUntil && new Date(p.lockedUntil) > new Date()

export default function StaffPage() {
  const { pushToast } = useToasts()
  const { isAdmin, user } = useAuth()

  const [staff, setStaff] = useState([])
  const [rooms, setRooms] = useState({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [tempPassword, setTempPassword] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/staff')
      setStaff(res.data || [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el personal') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useLoadEffect(load)

  // Nombre y color de la sala asignada (la lista de personal sólo trae el id).
  useEffect(() => {
    api
      .get('/classrooms')
      .then((r) => setRooms(Object.fromEntries((r.data || []).map((c) => [c.id, c]))))
      .catch(() => {})
  }, [])

  const reset = async (person) => {
    try {
      const res = await api.post(`/staff/${person.id}/reset-password`)
      setTempPassword({ name: person.name, email: person.email, password: res.data.tempPassword })
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    }
  }

  const unlock = async (person) => {
    try {
      await api.post(`/staff/${person.id}/unlock`)
      pushToast({ type: 'success', message: 'Cuenta desbloqueada' })
      load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    }
  }

  const counts = useMemo(() => {
    const c = { all: staff.length, inactive: staff.filter((p) => !p.active).length }
    for (const p of staff) c[p.role] = (c[p.role] || 0) + 1
    return c
  }, [staff])

  // Filtros de la tabla: rol, sala y estado (con contadores; se recuerdan en este navegador).
  const filters = useMemo(
    () => [
      { key: 'role', label: 'Rol', options: ROLES },
      {
        key: 'room',
        label: 'Sala',
        multiple: true,
        value: (p) => p.classroomId,
        optionLabel: (id) => rooms[id]?.name || 'Sala',
        emptyLabel: 'Sin sala asignada',
      },
      {
        key: 'status',
        label: 'Estado',
        value: (p) =>
          [
            p.active ? 'active' : 'inactive',
            isLocked(p) && 'locked',
            p.mustChangePassword && 'temp',
            p.totpEnabled && '2fa',
          ].filter(Boolean),
        options: [
          { value: 'active', label: 'Activas' },
          { value: 'inactive', label: 'Inactivas' },
          { value: 'locked', label: 'Bloqueadas' },
          { value: 'temp', label: 'Con clave temporal' },
          { value: '2fa', label: 'Con 2FA' },
        ],
      },
    ],
    [rooms],
  )

  const columns = [
    {
      key: 'name',
      label: 'Persona',
      primary: true,
      sortValue: (p) => p.name,
      render: (p) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={p.photoUrl} name={p.name} size="md" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-white truncate">
              {p.name}
              {p.id === user?.id && <span className="ml-1.5 text-xs font-normal text-slate-400">(tú)</span>}
            </p>
            <p className="text-xs text-slate-500 dark:text-white/45 truncate">
              {[p.position, p.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Rol',
      sortValue: (p) => ROLE_LABEL[p.role],
      render: (p) => <Badge tone={ROLE_TONE[p.role]}>{ROLE_LABEL[p.role]}</Badge>,
    },
    {
      key: 'classroom',
      label: 'Sala asignada',
      mobileLabel: 'Sala',
      sortValue: (p) => rooms[p.classroomId]?.name || 'zzz',
      render: (p) => {
        const room = rooms[p.classroomId]
        if (room)
          return (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-white/80">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: room.color || '#94a3b8' }} />
              {room.name}
            </span>
          )
        return p.role === 'teacher' ? (
          <Badge tone="amber">Sin sala</Badge>
        ) : (
          <span className="text-xs text-slate-400 dark:text-white/35">Todas las salas</span>
        )
      },
    },
    {
      key: 'status',
      label: 'Estado',
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.active ? <Badge tone="green">Activa</Badge> : <Badge tone="slate">Inactiva</Badge>}
          {isLocked(p) && <Badge tone="red">Bloqueada</Badge>}
          {p.mustChangePassword && <Badge tone="amber">Clave temporal</Badge>}
          {p.totpEnabled && <Badge tone="sky">Con 2FA</Badge>}
        </div>
      ),
    },
    {
      key: 'lastLoginAt',
      label: 'Último acceso',
      hideOnMobile: true,
      sortValue: (p) => p.lastLoginAt || '',
      render: (p) => (
        <span className="text-xs text-slate-500 dark:text-white/50 whitespace-nowrap">
          {p.lastLoginAt ? shortDate(p.lastLoginAt) : 'Nunca entró'}
        </span>
      ),
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            label: '',
            className: 'text-right',
            render: (p) => (
              <div className="flex items-center justify-end gap-1">
                {isLocked(p) && (
                  <Button size="sm" variant="secondary" icon={Unlock} onClick={(e) => { e.stopPropagation(); unlock(p) }}>
                    Desbloquear
                  </Button>
                )}
                <RowMenu
                  label={`Acciones para ${p.name}`}
                  items={[
                    { label: 'Editar', icon: Pencil, onClick: () => setEditing(p) },
                    { label: 'Restablecer contraseña', icon: KeyRound, onClick: () => reset(p) },
                    {
                      label: 'Eliminar cuenta',
                      icon: Trash2,
                      danger: true,
                      onClick: () => setToDelete(p),
                      hidden: p.id === user?.id,
                    },
                  ]}
                />
              </div>
            ),
          },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Personal"
        subtitle={loading ? 'Cargando…' : `${counts.all} cuenta(s) · ${counts.teacher || 0} educadora(s)`}
        icon={UserCog}
        actions={
          isAdmin && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              Nueva cuenta
            </Button>
          )
        }
      />

      <SmartTable
        rows={staff}
        columns={columns}
        loading={loading && staff.length === 0}
        searchKeys={['name', 'email', 'position', 'phone', 'code', (p) => rooms[p.classroomId]?.name]}
        searchPlaceholder="Nombre, cédula, correo o sala…"
        filters={filters}
        storageKey="staff"
        columnToggle
        itemLabel={['persona', 'personas']}
        onRowClick={isAdmin ? (p) => setEditing(p) : undefined}
        rowClassName={(p) => (!p.active ? 'opacity-60' : '')}
        maxHeight={null}
        emptyIcon={UserCog}
        emptyMessage="Aún no hay cuentas de personal."
        emptyAfterSearch="Nadie coincide con la búsqueda o los filtros."
        emptyAction={
          isAdmin && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              Crear la primera cuenta
            </Button>
          )
        }
      />

      {editing && (
        <StaffForm
          person={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        variant="danger"
        loading={deleting}
        title={`¿Eliminar la cuenta de ${toDelete?.name}?`}
        message="Se perderá su historial de marcajes. Si sólo dejó el puesto, desactiva la cuenta en su lugar."
        confirmText="Eliminar"
        onConfirm={async () => {
          setDeleting(true)
          try {
            await api.delete(`/staff/${toDelete.id}`)
            pushToast({ type: 'success', message: 'Cuenta eliminada' })
            setToDelete(null)
            load()
          } catch (err) {
            pushToast({ type: 'error', message: apiError(err) })
          } finally {
            setDeleting(false)
          }
        }}
      />

      {/* Se muestra una sola vez: la contraseña temporal no se guarda en claro. */}
      {tempPassword && (
        <CredentialsModal
          audience="staff"
          credentials={[{ name: tempPassword.name, email: tempPassword.email, tempPassword: tempPassword.password }]}
          onClose={() => setTempPassword(null)}
        />
      )}
    </>
  )
}

function StaffForm({ person, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [classrooms, setClassrooms] = useState([])
  const [form, setForm] = useState({
    email: person?.email || '',
    password: '',
    name: person?.name || '',
    role: person?.role || 'teacher',
    position: person?.position || '',
    classroomId: person?.classroomId || '',
    phone: person?.phone || '',
    code: person?.code || '',
    active: person?.active ?? true,
  })
  const [photo, setPhoto] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/classrooms', { params: { includeInactive: 'false' } })
      .then((r) => setClassrooms(r.data || []))
      .catch(() => {})
  }, [])

  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      // Al editar, un campo vaciado se envía explícito (null / '') para que el backend
      // lo borre; `undefined` lo dejaría con el valor anterior.
      const cleared = (v) => (person ? v : undefined)
      const payload = {
        name: form.name,
        role: form.role,
        position: form.position || cleared(''),
        classroomId: form.classroomId || cleared(null),
        phone: form.phone || cleared(''),
        code: form.code || cleared(''),
        photo: photo || undefined,
      }
      if (person) {
        await api.patch(`/staff/${person.id}`, { ...payload, active: form.active })
      } else {
        await api.post('/staff', { ...payload, email: form.email, password: form.password })
      }
      pushToast({ type: 'success', message: person ? 'Cuenta actualizada' : 'Cuenta creada' })
      onSaved()
    } catch (err) {
      setError(apiError(err, 'No se pudo guardar'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={person ? `Editar a ${person.name}` : 'Nueva cuenta de personal'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-[160px_1fr] gap-4">
          <PhotoCapture value={photo} onChange={setPhoto} label="Foto" compact />
          <div className="space-y-3">
            <Field label="Nombre completo" required>
              <input className={inputClass} value={form.name} onChange={set('name')} required />
            </Field>
            {!person && (
              <>
                <Field label="Correo" required>
                  <input className={inputClass} type="email" value={form.email} onChange={set('email')} required />
                </Field>
                <Field
                  label="Contraseña inicial"
                  hint="Mínimo 10 caracteres con letras y números. Deberá cambiarla al entrar."
                  required
                >
                  <input className={inputClass} type="text" value={form.password} onChange={set('password')} required />
                </Field>
              </>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Rol" hint="La dirección tiene acceso total; la coordinación no toca configuración.">
            <select className={inputClass} value={form.role} onChange={set('role')}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cargo">
            <input className={inputClass} value={form.position} onChange={set('position')} placeholder="Educadora de maternal" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Sala asignada">
            <select className={inputClass} value={form.classroomId} onChange={set('classroomId')}>
              <option value="">Sin asignar</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Teléfono">
            <input className={inputClass} value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Cédula">
            <input className={inputClass} value={form.code} onChange={set('code')} />
          </Field>
        </div>

        {person && (
          <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-white/10 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 mt-0.5 accent-emerald-600" checked={form.active} onChange={set('active')} />
            <span className="text-sm">
              <strong className="block text-slate-800 dark:text-white">{form.active ? 'Cuenta activa' : 'Cuenta desactivada'}</strong>
              <span className="text-slate-500 dark:text-white/50">Una cuenta desactivada no puede entrar, pero conserva su historial.</span>
            </span>
          </label>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
