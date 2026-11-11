import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, KeyRound, Pencil, Power, Trash2, UserCheck, Users } from '../components/icons'
import { api, apiError, shortDate, timeOf } from '../api/client'
import { useToasts } from '../context/ToastsContext'
import { useLiveReload } from '../realtime'
import SmartTable, { RowMenu } from '../components/SmartTable'
import { useAuth } from '../context/AuthContext'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import CredentialsModal from '../components/CredentialsModal'
import { Badge, Button, Field, inputClass, PageHeader } from '../components/ui'

const ACCESS = {
  active: { label: 'Ha entrado al portal', tone: 'green' },
  pending: {
    label: 'Aún no entra',
    hint: 'Usa «Restablecer acceso» si no tiene clave',
    tone: 'amber',
  },
  none: { label: 'Sin acceso', hint: 'Sin correo o desactivado', tone: 'slate' },
}

// Filtros de la tabla (contadores automáticos; se recuerdan por navegador).
const TABLE_FILTERS = [
  {
    key: 'access',
    label: 'Portal',
    value: (g) => accessOf(g),
    options: [
      { value: 'active', label: 'Ha entrado al portal' },
      { value: 'pending', label: 'Aún no entra' },
      { value: 'none', label: 'Sin acceso' },
    ],
  },
  {
    key: 'state',
    label: 'Estado',
    value: (g) => (g.active ? 'on' : 'off'),
    options: [
      { value: 'on', label: 'Activos' },
      { value: 'off', label: 'Inactivos' },
    ],
  },
  {
    key: 'room',
    label: 'Sala',
    multiple: true,
    value: (g) => (g.children || []).map((c) => c.classroomName).filter(Boolean),
    emptyLabel: 'Sin sala / sin niños',
  },
]

// Búsqueda: nombre, cédula, teléfono, correo y nombre de sus niños.
const SEARCH_KEYS = ['name', 'documentId', 'phone', 'email', (g) => (g.children || []).map((c) => c.name)]

function accessOf(g) {
  if (g.accessStatus && ACCESS[g.accessStatus]) return g.accessStatus
  if (!g.hasPortalAccess) return 'none'
  return g.lastLoginAt ? 'active' : 'pending'
}

function lastLogin(iso) {
  if (!iso) return 'Nunca'
  return `${shortDate(String(iso).slice(0, 10))} · ${timeOf(iso)}`
}

/**
 * Directorio de representantes (dirección y coordinación): quién tiene acceso al portal
 * familiar, a qué niños está vinculado y cuándo entró por última vez.
 */
export default function GuardiansPage() {
  const { pushToast } = useToasts()
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [toggling, setToggling] = useState(null)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [credentials, setCredentials] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Se carga el directorio entero y se busca/filtra en el navegador (cientos de filas).
      const res = await api.get('/children/guardians')
      setRows(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el directorio') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])
  // En vivo: altas/bajas de niños cambian a quién representa cada uno (sin parpadeo: el
  // spinner sólo sale con la tabla vacía).
  useLiveReload(load, { entities: ['child'] }, { debounceMs: 1000 })

  const replaceRow = (row) => {
    if (!row?.id) return load()
    setRows((list) => list.map((g) => (g.id === row.id ? { ...g, ...row } : g)))
  }

  const stats = useMemo(
    () => ({
      total: rows.length,
      withAccess: rows.filter((g) => accessOf(g) !== 'none').length,
      neverLogged: rows.filter((g) => accessOf(g) === 'pending').length,
    }),
    [rows],
  )

  const applyToggle = async () => {
    if (!toggling) return
    setToggleBusy(true)
    try {
      const res = await api.patch(`/children/guardians/${toggling.id}`, { active: !toggling.active })
      replaceRow(res.data?.id ? res.data : { ...toggling, active: !toggling.active })
      pushToast({
        type: 'success',
        message: toggling.active ? 'Cuenta desactivada y sesiones cerradas' : 'Cuenta reactivada',
      })
      setToggling(null)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    } finally {
      setToggleBusy(false)
    }
  }

  const resetAccess = async (g) => {
    try {
      const res = await api.post(`/children/guardians/${g.id}/reset-access`)
      setCredentials(res.data)
      load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'Representante',
      primary: true,
      render: (g) => (
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
            {g.name}
            {!g.active && <Badge tone="red">Inactivo</Badge>}
          </p>
          {g.documentId && (
            <p className="text-xs text-slate-400 dark:text-white/30">Cédula {g.documentId}</p>
          )}
        </div>
      ),
    },
    {
      key: 'contact',
      label: 'Contacto',
      mobileLabel: 'Contacto',
      render: (g) => (
        <div className="text-sm min-w-0">
          <p className="text-slate-700 dark:text-white/70">{g.phone || '—'}</p>
          <p className="text-xs text-slate-400 dark:text-white/40 truncate max-w-56" title={g.email || ''}>
            {g.email || 'Sin correo'}
          </p>
        </div>
      ),
    },
    {
      key: 'children',
      label: 'Niños',
      render: (g) =>
        g.children?.length ? (
          <ul className="space-y-0.5">
            {g.children.map((c) => (
              <li key={c.id} className="text-sm">
                <Link
                  to={`/panel/ninos/${c.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-accent-text hover:underline"
                >
                  {c.name}
                </Link>
                {c.classroomName && (
                  <span className="text-xs text-slate-400 dark:text-white/30"> · {c.classroomName}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-slate-400 dark:text-white/30">Sin niños vinculados</span>
        ),
    },
    {
      key: 'access',
      label: 'Portal',
      render: (g) => {
        const a = ACCESS[accessOf(g)]
        return (
          <div>
            <Badge tone={a.tone}>{a.label}</Badge>
            {a.hint && (
              <p className="text-[11px] text-slate-400 dark:text-white/30 mt-0.5">{a.hint}</p>
            )}
          </div>
        )
      },
    },
    {
      key: 'lastLoginAt',
      label: 'Último acceso',
      hideOnMobile: true,
      render: (g) => (
        <span className="text-sm text-slate-600 dark:text-white/60 whitespace-nowrap">
          {lastLogin(g.lastLoginAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (g) => (
        <div className="flex items-center justify-end gap-1">
          {accessOf(g) === 'pending' && g.active && (
            <Button
              size="sm"
              variant="secondary"
              icon={KeyRound}
              className="whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation()
                resetAccess(g)
              }}
            >
              Nueva clave
            </Button>
          )}
          <RowMenu
            label={`Acciones para ${g.name}`}
            items={[
              { label: 'Editar datos', icon: Pencil, onClick: () => setEditing(g) },
              { label: 'Restablecer acceso', icon: KeyRound, onClick: () => resetAccess(g) },
              g.active
                ? { label: 'Desactivar cuenta', icon: Power, danger: true, onClick: () => setToggling(g) }
                : { label: 'Reactivar cuenta', icon: UserCheck, onClick: () => setToggling(g) },
              { label: 'Eliminar representante', icon: Trash2, danger: true, hidden: !isAdmin, onClick: () => setDeleting(g) },
            ]}
          />
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Representantes"
        subtitle={`${stats.total} cuenta(s) · ${stats.withAccess} con acceso al portal${
          stats.neverLogged ? ` · ${stats.neverLogged} sin estrenar` : ''
        }`}
        icon={Users}
      />

      <SmartTable
        rows={rows}
        columns={columns}
        loading={loading && rows.length === 0}
        onRowClick={(g) => setEditing(g)}
        rowClassName={(g) => (!g.active ? 'opacity-60' : '')}
        maxHeight={null}
        searchKeys={SEARCH_KEYS}
        searchPlaceholder="Buscar por nombre, cédula, teléfono, correo o niño…"
        filters={TABLE_FILTERS}
        storageKey="guardians"
        columnToggle
        itemLabel={['representante', 'representantes']}
        emptyIcon={Users}
        emptyMessage="No hay representantes registrados."
        emptyAfterSearch="Ningún representante coincide con la búsqueda o los filtros."
      />

      {editing && (
        <EditGuardianModal
          guardian={editing}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setEditing(null)
            replaceRow(row)
          }}
        />
      )}

      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        loading={toggleBusy}
        variant={toggling?.active ? 'danger' : 'success'}
        icon={Power}
        title={
          toggling?.active
            ? `¿Desactivar la cuenta de ${toggling?.name}?`
            : `¿Reactivar la cuenta de ${toggling?.name}?`
        }
        message={
          toggling?.active
            ? 'No podrá entrar al portal familiar y se cerrarán sus sesiones abiertas al instante. Sigue vinculado a sus niños.'
            : 'Podrá volver a entrar al portal familiar con su contraseña actual.'
        }
        confirmText={toggling?.active ? 'Desactivar' : 'Reactivar'}
        onConfirm={applyToggle}
      />

      {deleting && (
        <DeleteGuardianModal
          guardian={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setDeleting(null)
            setRows((list) => list.filter((g) => g.id !== id))
          }}
        />
      )}

      {credentials && (
        <CredentialsModal credentials={[credentials]} onClose={() => setCredentials(null)} />
      )}
    </>
  )
}

function EditGuardianModal({ guardian, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [form, setForm] = useState({
    name: guardian.name || '',
    phone: guardian.phone || '',
    email: guardian.email || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e?.preventDefault()
    setSaving(true)
    setError('')
    try {
      // Sólo se envía lo que cambió: tocar el correo cierra sus sesiones.
      const payload = {}
      if (form.name.trim() !== (guardian.name || '')) payload.name = form.name.trim()
      if (form.phone.trim() !== (guardian.phone || '')) payload.phone = form.phone.trim()
      if (form.email.trim().toLowerCase() !== (guardian.email || '').toLowerCase()) {
        payload.email = form.email.trim()
      }
      if (!Object.keys(payload).length) {
        onClose()
        return
      }
      const res = await api.patch(`/children/guardians/${guardian.id}`, payload)
      pushToast({ type: 'success', message: 'Representante actualizado' })
      onSaved(res.data?.id ? res.data : { ...guardian, ...payload })
    } catch (err) {
      setError(apiError(err, 'No se pudo guardar'))
    } finally {
      setSaving(false)
    }
  }

  const emailChanged = form.email.trim().toLowerCase() !== (guardian.email || '').toLowerCase()

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar a ${guardian.name}`}
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
        <Field label="Nombre" required>
          <input className={inputClass} value={form.name} onChange={set('name')} required minLength={3} />
        </Field>
        <Field label="WhatsApp" hint="Sin número no recibe el reporte diario.">
          <input className={inputClass} value={form.phone} onChange={set('phone')} />
        </Field>
        <Field
          label="Correo"
          hint="Es su usuario para entrar al portal. Si lo vacías, pierde el acceso."
        >
          <input className={inputClass} type="email" value={form.email} onChange={set('email')} />
        </Field>
        {emailChanged && (
          <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
            Al cambiar el correo se cerrarán sus sesiones abiertas y tendrá que entrar con el nuevo.
          </p>
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

const foldName = (s) =>
  String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ')

/**
 * Eliminación definitiva de un representante (sólo dirección). Pide escribir su nombre.
 * Si es el único representante de algún niño activo, el servidor responde 409 con la lista
 * y aquí se avisa antes de permitir "Eliminar igualmente" (?force=true).
 */
function DeleteGuardianModal({ guardian, onClose, onDeleted }) {
  const { pushToast } = useToasts()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [orphans, setOrphans] = useState(null)
  const [error, setError] = useState('')
  const matches = foldName(typed) === foldName(guardian.name)

  const run = async (force) => {
    setBusy(true)
    setError('')
    try {
      await api.delete(`/children/guardians/${guardian.id}`, { params: force ? { force: 'true' } : {} })
      pushToast({ type: 'success', message: `Se eliminó a ${guardian.name}` })
      onDeleted(guardian.id)
    } catch (err) {
      const data = err?.response?.data
      if (err?.response?.status === 409 && data?.code === 'ONLY_GUARDIAN') setOrphans(data.children || [])
      else setError(apiError(err, 'No se pudo eliminar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={`¿Eliminar a ${guardian.name}?`}
      subtitle="Esta acción no se puede deshacer."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" icon={Trash2} disabled={!matches} loading={busy} onClick={() => run(!!orphans)}>
            {orphans ? 'Eliminar igualmente' : 'Eliminar definitivamente'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600 dark:text-white/65">
        <p>
          Se borrará su cuenta del portal familiar, se cerrarán sus sesiones al instante y se quitará de la ficha de:
        </p>
        {guardian.children?.length ? (
          <ul className="rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
            {guardian.children.map((c) => (
              <li key={c.id} className="px-3 py-2 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-white/85">{c.name}</span>
                <span className="text-xs text-slate-400 dark:text-white/35">{c.classroomName || 'Sin sala'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500 dark:text-white/45">No está vinculado a ningún niño.</p>
        )}
        <p className="text-xs text-slate-500 dark:text-white/45">
          El historial de los niños no se toca. Si sólo quieres que deje de entrar, usa «Desactivar cuenta».
        </p>
        {orphans?.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5 text-amber-800 dark:text-amber-200"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Es el único representante de {orphans.length === 1 ? 'este niño' : 'estos niños'}:
            </p>
            <p className="mt-1 text-xs">{orphans.map((c) => c.name).join(', ')}</p>
            <p className="mt-1 text-xs">
              Quedarán sin nadie a quien avisar ni que pueda retirarlos hasta que añadas otro representante.
            </p>
          </div>
        )}
        <Field label={`Para confirmar, escribe su nombre: ${guardian.name}`}>
          <input
            className={inputClass}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            aria-label="Nombre del representante para confirmar"
          />
        </Field>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>
    </Modal>
  )
}
