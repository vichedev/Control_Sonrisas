import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Baby,
  Camera,
  CircleDashed,
  Eye,
  HeartPulse,
  IdentificationCard,
  KeyRound,
  Pencil,
  Phone,
  Plus,
  UserCheck,
  Users,
} from '../components/icons'
import { api, apiError, timeOf, todayKey } from '../api/client'
import { useToasts } from '../context/ToastsContext'
import { useLiveReload } from '../realtime'
import { useAuth } from '../context/AuthContext'
import ChildForm from '../components/ChildForm'
import CredentialsModal from '../components/CredentialsModal'
import SmartTable, { RowMenu } from '../components/SmartTable'
import { Avatar, Badge, Button, PageHeader } from '../components/ui'
import ConsentBadge, { ConsentBadges } from '../components/consent/ConsentBadge'
import { statusOf } from '../components/consent/consentModel'
import { readTableStore, writeTableStore } from '../components/dataView'
import { formatDocumentId } from '../components/childSearch'

/** Estado de hoy según el tablero de asistencia. Siempre icono/color + texto. */
const TODAY = {
  present: { label: 'Presente', tone: 'green' },
  checked_out: { label: 'Retirado', tone: 'sky' },
  justified: { label: 'Ausencia avisada', tone: 'accent' },
  absent: { label: 'Aún no llega', tone: 'slate' },
}

const TABLE_KEY = 'children'
const EMPTY = '__empty__'

/**
 * `?sala=<id>` (desde Salas) y `?fotos=no` mandan sobre los filtros recordados: se escriben en
 * la configuración guardada de la tabla ANTES de montarla (SmartTable la lee al iniciar).
 */
function applyUrlFilters(params) {
  const sala = params.get('sala')
  const fotos = params.get('fotos')
  if (sala == null && fotos == null) return
  const next = { ...(readTableStore(TABLE_KEY).filters || {}) }
  if (sala != null) next.room = sala ? [sala] : []
  if (fotos === 'no') next.photos = 'no'
  writeTableStore(TABLE_KEY, { filters: next })
}

const sectionLabel = 'text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-1.5'

/** Detalle rápido al desplegar la fila: representantes, salud y autorizaciones. */
function ChildQuickInfo({ child: c, guardians, canManage, onOpen }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 text-sm">
      <div className="min-w-0">
        <p className={sectionLabel}>Representantes</p>
        {!canManage ? (
          <p className="text-xs text-slate-500 dark:text-white/45">Consúltalos en la ficha.</p>
        ) : guardians?.length ? (
          <ul className="space-y-2">
            {guardians.map((g) => (
              <li key={g.id} className="min-w-0">
                <p className="font-medium text-slate-800 dark:text-white/90 truncate">
                  {g.name}
                  {g.relationship ? (
                    <span className="font-normal text-slate-500 dark:text-white/45"> · {g.relationship}</span>
                  ) : null}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-white/45">
                  {g.phone && (
                    <a href={`tel:${g.phone}`} className="inline-flex items-center gap-1 hover:text-accent-text">
                      <Phone className="w-3 h-3" aria-hidden="true" />
                      {g.phone}
                    </a>
                  )}
                  {g.canPickup && (
                    <span className="inline-flex items-center gap-1">
                      <UserCheck className="w-3 h-3" aria-hidden="true" />
                      Puede retirar
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 ${
                      g.hasPortalAccess ? 'text-emerald-700 dark:text-emerald-300' : ''
                    }`}
                  >
                    <KeyRound className="w-3 h-3" aria-hidden="true" />
                    {g.hasPortalAccess ? 'Con portal' : 'Sin portal'}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Badge tone="amber">Sin representantes</Badge>
        )}
      </div>
      <div className="min-w-0">
        <p className={sectionLabel}>Salud</p>
        {c.allergies || c.medicalConditions ? (
          <dl className="space-y-1 text-xs">
            {c.allergies && (
              <div>
                <dt className="inline font-semibold text-red-700 dark:text-red-300">Alergias: </dt>
                <dd className="inline text-slate-700 dark:text-white/75">{c.allergies}</dd>
              </div>
            )}
            {c.medicalConditions && (
              <div>
                <dt className="inline font-semibold text-amber-800 dark:text-amber-200">Condición médica: </dt>
                <dd className="inline text-slate-700 dark:text-white/75">{c.medicalConditions}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-xs text-slate-500 dark:text-white/45">Sin alergias ni condiciones registradas.</p>
        )}
      </div>
      <div className="min-w-0">
        <p className={sectionLabel}>Autorizaciones</p>
        {c.consents ? <ConsentBadges consents={c.consents} /> : <p className="text-xs text-slate-500">—</p>}
        <p className="mt-2 text-xs text-slate-500 dark:text-white/45 inline-flex items-center gap-1">
          <IdentificationCard className="w-3.5 h-3.5" aria-hidden="true" />
          {c.documentId ? (
            <span className="tabular-nums">Cédula {formatDocumentId(c.documentId)}</span>
          ) : (
            'Sin cédula registrada'
          )}
        </p>
        <div className="mt-3">
          <Button size="sm" variant="secondary" icon={Eye} onClick={onOpen}>
            Abrir ficha
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function ChildrenPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { pushToast } = useToasts()
  const { canManage } = useAuth()

  const [children, setChildren] = useState([])
  const [classrooms, setClassrooms] = useState([])
  const [board, setBoard] = useState({})
  const [guardiansByChild, setGuardiansByChild] = useState({})
  const [loading, setLoading] = useState(true)
  // Aplica `?sala=` / `?fotos=no` una sola vez, antes de montar la tabla.
  useState(() => applyUrlFilters(params))
  const [visible, setVisible] = useState([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [credentials, setCredentials] = useState(null)

  // Quita los parámetros ya aplicados para que no se impongan otra vez.
  useEffect(() => {
    if (params.has('sala') || params.has('fotos')) {
      const next = new URLSearchParams(params)
      next.delete('sala')
      next.delete('fotos')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Todos (también los dados de baja): sala y estado se filtran en la tabla.
      const res = await api.get('/children', { params: { includeInactive: 'true' } })
      setChildren(res.data || [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la lista') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  // Estado de hoy: complementario, si falla la lista sigue funcionando.
  const loadBoard = useCallback(
    () =>
      api
        .get('/attendance/board')
        .then((r) => {
          const map = {}
          for (const row of r.data?.children || []) map[row.childId] = row
          setBoard(map)
        })
        .catch(() => {}),
    [],
  )
  useEffect(() => {
    api.get('/classrooms').then((r) => setClassrooms(r.data || [])).catch(() => {})
    const t = setTimeout(loadBoard, 0)
    return () => clearTimeout(t)
  }, [loadBoard])

  // En vivo: fichas (alta/edición/baja) y llegadas/salidas de hoy. El spinner sólo sale
  // con la lista vacía, así que recargar no parpadea; el formulario abierto no se toca.
  useLiveReload(load, { entities: ['child'] })
  useLiveReload(loadBoard, { entities: ['attendance'], date: todayKey() })

  useEffect(() => {
    // El directorio de representantes sólo lo puede consultar dirección/coordinación.
    if (!canManage) return
    api
      .get('/children/guardians')
      .then((r) => {
        const map = {}
        for (const g of r.data || []) {
          for (const c of g.children || []) {
            const entry = (map[c.id] = map[c.id] || { total: 0, withAccess: 0, list: [] })
            entry.total += 1
            if (g.hasPortalAccess) entry.withAccess += 1
            entry.list.push({
              id: g.id,
              name: g.name,
              phone: g.phone,
              relationship: c.relationship,
              canPickup: c.canPickup,
              hasPortalAccess: g.hasPortalAccess,
            })
          }
        }
        setGuardiansByChild(map)
      })
      .catch(() => {})
  }, [canManage])

  const filters = useMemo(
    () => [
      {
        key: 'room',
        label: 'Sala',
        multiple: true,
        allLabel: 'Todas',
        value: (c) => c.classroomId,
        options: () => [
          ...classrooms.map((r) => ({ value: r.id, label: r.name })),
          { value: EMPTY, label: 'Sin sala' },
        ],
      },
      {
        key: 'status',
        label: 'Estado',
        defaultValue: 'active',
        value: (c) => (c.active ? 'active' : 'inactive'),
        options: [
          { value: 'active', label: 'Activos' },
          { value: 'inactive', label: 'Dados de baja' },
        ],
      },
      {
        key: 'doc',
        label: 'Cédula',
        icon: IdentificationCard,
        value: (c) => (c.documentId ? 'yes' : 'no'),
        options: [
          { value: 'yes', label: 'Con cédula' },
          { value: 'no', label: 'Sin cédula' },
        ],
      },
      {
        key: 'photos',
        label: 'Fotos',
        icon: Camera,
        value: (c) => (statusOf(c.consents?.images) === 'granted' ? 'granted' : 'no'),
        options: [
          { value: 'granted', label: 'Fotos autorizadas' },
          { value: 'no', label: 'Sin autorización de fotos' },
        ],
      },
      {
        key: 'today',
        label: 'Hoy',
        icon: CircleDashed,
        value: (c) => (c.active ? board[c.id]?.status || 'absent' : ''),
        options: Object.entries(TODAY).map(([value, t]) => ({ value, label: t.label })),
      },
    ],
    [classrooms, board],
  )

  const presentCount = visible.filter((c) => board[c.id]?.status === 'present').length

  const columns = [
    {
      key: 'fullName',
      label: 'Niño',
      primary: true,
      sortValue: (c) => c.fullName,
      render: (c) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={c.photoUrl} name={c.fullName} size="md" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-white truncate">{c.fullName}</p>
            <p className="text-xs text-slate-500 dark:text-white/45">
              {c.age}
              {c.documentId ? (
                <span className="tabular-nums whitespace-nowrap">
                  {' · '}
                  <span className="sr-only">Cédula </span>
                  {formatDocumentId(c.documentId)}
                </span>
              ) : null}
              {c.code ? ` · #${c.code}` : ''}
            </p>
          </div>
          {/* Autorización de imagen: con texto sólo cuando NO se pueden tomar fotos. */}
          {c.consents &&
            (statusOf(c.consents.images) === 'granted' ? (
              <ConsentBadge type="images" status={c.consents.images} iconOnly className="shrink-0" />
            ) : (
              <ConsentBadge type="images" status={c.consents.images} showType className="shrink-0 whitespace-nowrap" />
            ))}
          {!c.active && <Badge tone="red">Baja</Badge>}
        </div>
      ),
    },
    {
      key: 'classroomName',
      label: 'Sala',
      sortValue: (c) => c.classroomName || 'zzz',
      render: (c) =>
        c.classroomName ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-white/80">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white dark:ring-white/10"
              style={{ backgroundColor: c.classroomColor || '#94a3b8' }}
            />
            {c.classroomName}
          </span>
        ) : (
          <Badge tone="amber">Sin sala</Badge>
        ),
    },
    {
      key: 'health',
      label: 'Salud',
      sortValue: (c) => (c.allergies ? 0 : c.medicalConditions ? 1 : 2),
      render: (c) =>
        c.allergies || c.medicalConditions ? (
          <div className="flex flex-col items-start gap-1 max-w-56">
            {c.allergies && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium leading-4 bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20 max-w-full"
                title={c.allergies}
              >
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="truncate">Alergia: {c.allergies}</span>
              </span>
            )}
            {c.medicalConditions && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium leading-4 bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20 max-w-full"
                title={c.medicalConditions}
              >
                <HeartPulse className="w-3 h-3 shrink-0" />
                <span className="truncate">Condición médica</span>
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400 dark:text-white/30">Sin alertas</span>
        ),
    },
    ...(canManage
      ? [
          {
            key: 'guardians',
            label: 'Representantes',
            mobileLabel: 'Familia',
            sortValue: (c) => guardiansByChild[c.id]?.total || 0,
            render: (c) => {
              const g = guardiansByChild[c.id]
              if (!g?.total) return <Badge tone="amber">Sin representantes</Badge>
              return (
                <div className="text-xs">
                  <p className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-white/80">
                    <Users className="w-3.5 h-3.5 opacity-60" />
                    {g.total} {g.total === 1 ? 'representante' : 'representantes'}
                  </p>
                  <p
                    className={`inline-flex items-center gap-1 mt-0.5 ${
                      g.withAccess ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-white/35'
                    }`}
                  >
                    <KeyRound className="w-3 h-3" />
                    {g.withAccess ? `${g.withAccess} con portal` : 'Sin acceso al portal'}
                  </p>
                </div>
              )
            },
          },
        ]
      : []),
    {
      key: 'today',
      label: 'Hoy',
      sortValue: (c) => ['present', 'checked_out', 'justified', 'absent'].indexOf(board[c.id]?.status ?? 'zz'),
      render: (c) => {
        const b = board[c.id]
        if (!c.active || !b) return <span className="text-xs text-slate-400 dark:text-white/30">—</span>
        const st = TODAY[b.status] || TODAY.absent
        const time =
          b.status === 'present' && b.arrival
            ? ` · ${timeOf(b.arrival.createdAt)}`
            : b.status === 'checked_out' && b.departure
              ? ` · ${timeOf(b.departure.createdAt)}`
              : ''
        return (
          <Badge tone={st.tone} className="whitespace-nowrap">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                b.status === 'present' ? 'bg-emerald-500' : b.status === 'checked_out' ? 'bg-sky-500' : b.status === 'justified' ? 'bg-accent' : 'bg-slate-400'
              }`}
            />
            {st.label}
            {time}
          </Badge>
        )
      },
    },
    {
      key: 'actions',
      label: '',
      className: 'text-right w-12',
      render: (c) => (
        <RowMenu
          label={`Acciones para ${c.fullName}`}
          items={[
            { label: 'Ver ficha', icon: Eye, onClick: () => navigate(`/panel/ninos/${c.id}`) },
            { label: 'Editar ficha', icon: Pencil, onClick: () => setEditing(c), hidden: !canManage },
          ]}
        />
      ),
    },
  ]

  const subtitle = loading && !children.length
    ? 'Cargando…'
    : [
        `${visible.length} ${visible.length === 1 ? 'niño' : 'niños'}`,
        Object.keys(board).length && presentCount ? `${presentCount} presentes ahora` : null,
      ]
        .filter(Boolean)
        .join(' · ')

  return (
    <>
      <PageHeader
        title="Niños"
        subtitle={subtitle}
        icon={Baby}
        actions={
          canManage && (
            <Button icon={Plus} size="lg" onClick={() => setCreating(true)}>
              Inscribir niño
            </Button>
          )
        }
      />

      <SmartTable
        rows={children}
        columns={columns}
        loading={loading && children.length === 0}
        searchKeys={SEARCH_KEYS}
        searchPlaceholder="Buscar por nombre, cédula o matrícula…"
        filters={filters}
        storageKey={TABLE_KEY}
        columnToggle
        itemLabel={['niño', 'niños']}
        onFiltered={setVisible}
        onRowClick={(c) => navigate(`/panel/ninos/${c.id}`)}
        renderExpanded={(c) => (
          <ChildQuickInfo
            child={c}
            guardians={guardiansByChild[c.id]?.list}
            canManage={canManage}
            onOpen={() => navigate(`/panel/ninos/${c.id}`)}
          />
        )}
        rowClassName={(c) => (!c.active ? 'opacity-60' : '')}
        initialPageSize={25}
        maxHeight={null}
        emptyIcon={Baby}
        emptyMessage="Aún no hay niños inscritos."
        emptyAction={
          canManage && (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Inscribir niño
            </Button>
          )
        }
      />

      {creating && (
        <ChildForm
          onClose={() => setCreating(false)}
          onSaved={(child) => {
            setCreating(false)
            load()
            if (child?.credentials?.length) setCredentials(child.credentials)
            else navigate(`/panel/ninos/${child.id}`)
          }}
        />
      )}

      {editing && (
        <ChildForm
          child={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {/* La contraseña temporal se muestra UNA vez: no queda almacenada en claro. */}
      {credentials && (
        <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
      )}
    </>
  )
}

/** Nombre, cédula (con y sin guion), matrícula y sala. Constante: no rehace la búsqueda en cada render. */
const SEARCH_KEYS = [
  'fullName',
  'documentId',
  (c) => (c.documentId ? formatDocumentId(c.documentId) : ''),
  'code',
  'classroomName',
]
