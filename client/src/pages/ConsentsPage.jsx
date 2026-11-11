import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ClipboardList, FileText, History, Pencil, ShieldCheck, Users } from '../components/icons'
import { api, apiError } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useAuth } from '../context/AuthContext'
import { useToasts } from '../context/ToastsContext'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import SmartTable, { RowMenu } from '../components/SmartTable'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
  Loading,
  PageHeader,
  SectionTitle,
  SegmentedControl,
} from '../components/ui'
import ConsentBadge, { ConsentBadges } from '../components/consent/ConsentBadge'
import PolicyText from '../components/consent/PolicyText'
import { CONSENT_LABEL, CONSENT_TYPES, STATUS_LABEL, formatDateTime } from '../components/consent/consentModel'

/** Consentimientos LOPDP: resumen, estado por niño, formularios en papel y textos (dirección). */
export default function ConsentsPage() {
  const { isAdmin } = useAuth()
  // Enlace directo desde la ficha: ?child=<id> (historial) o ?child=<id>&accion=papel (formulario en papel).
  const [params] = useSearchParams()
  const deepChild = params.get('child') || ''
  const deepAction = params.get('accion') === 'papel' ? 'paper' : 'history'
  // ?tab=textos abre directamente los textos legales (enlace desde Ajustes).
  const [tab, setTab] = useState(
    deepChild ? 'children' : params.get('tab') === 'textos' && isAdmin ? 'policies' : 'summary',
  )
  const tabs = [
    { value: 'summary', label: 'Resumen' },
    { value: 'children', label: 'Por niño' },
    ...(isAdmin ? [{ value: 'policies', label: 'Textos' }] : []),
  ]
  return (
    <div>
      <PageHeader
        icon={ShieldCheck}
        title="Consentimientos"
        subtitle="Autorizaciones de los representantes: datos, fotos y WhatsApp (LOPDP)"
      />
      <SegmentedControl ariaLabel="Sección" options={tabs} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'summary' && <SummaryTab onGoChildren={() => setTab('children')} />}
      {tab === 'children' && <ChildrenTab deepChild={deepChild} deepAction={deepAction} />}
      {tab === 'policies' && isAdmin && <PoliciesTab />}
    </div>
  )
}

// ------------------------------------------------------------------ resumen

function SummaryTab({ onGoChildren }) {
  const { pushToast } = useToasts()
  const [data, setData] = useState(null)
  const load = useCallback(async () => {
    try {
      const res = await api.get('/consents/summary')
      setData(res.data)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el resumen') })
      setData({ totalChildren: 0, byType: {}, pending: [], denied: [] })
    }
  }, [pushToast])
  useLoadEffect(load)
  if (!data) return <Loading />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {CONSENT_TYPES.map((t) => {
          const c = data.byType[t] || { granted: 0, denied: 0, pending: 0, outdated: 0 }
          return (
            <Card key={t}>
              <p className="text-xs font-medium text-slate-500 dark:text-white/50">{CONSENT_LABEL[t]}</p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white mt-1">
                {c.granted}
                <span className="text-sm font-normal text-slate-500 dark:text-white/45"> / {data.totalChildren} autorizados</span>
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge tone="amber">{c.pending} pendientes</Badge>
                <Badge tone="red">{c.denied} no autorizados</Badge>
                {c.outdated > 0 && <Badge tone="sky">{c.outdated} por renovar</Badge>}
              </div>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PeopleList
          title="Pendientes de respuesta"
          icon={ClipboardList}
          rows={data.pending}
          empty="Todas las familias respondieron."
          tone="amber"
          onMore={onGoChildren}
        />
        <PeopleList
          title="No autorizados"
          icon={AlertTriangle}
          rows={data.denied}
          empty="Ninguna familia rechazó una autorización."
          tone="red"
          onMore={onGoChildren}
        />
      </div>
    </div>
  )
}

function PeopleList({ title, icon, rows, empty, tone, onMore }) {
  const shown = rows.slice(0, 12)
  return (
    <section>
      <SectionTitle hint={`${rows.length}`}>{title}</SectionTitle>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon={icon} title={empty} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {shown.map((r) => (
              <li key={r.childId} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800 dark:text-white/85 truncate">{r.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-white/45">{r.classroomName || 'Sin sala'}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {r.types.map((t) => (
                    <Badge key={t} tone={tone}>
                      {CONSENT_LABEL[t]}
                    </Badge>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {rows.length > shown.length && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-white/5">
            <Button variant="ghost" size="sm" onClick={onMore}>
              Ver los {rows.length}
            </Button>
          </div>
        )}
      </Card>
    </section>
  )
}

// ------------------------------------------------------------------ por niño

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Con pendientes' },
  { value: 'denied', label: 'Con negativas' },
  { value: 'no_images', label: 'Sin fotos' },
]

function ChildrenTab({ deepChild = '', deepAction = 'history' }) {
  const { pushToast } = useToasts()
  const deepDone = useRef(false)
  const [rows, setRows] = useState([])
  const [classrooms, setClassrooms] = useState([])
  const [classroomId, setClassroomId] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [historyFor, setHistoryFor] = useState(null)
  const [paperFor, setPaperFor] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, r] = await Promise.all([
        api.get('/consents/children', { params: classroomId ? { classroomId } : {} }),
        api.get('/classrooms').catch(() => ({ data: [] })),
      ])
      setRows(c.data || [])
      setClassrooms(r.data || [])
      // Abre una sola vez el niño del enlace directo.
      if (deepChild && !deepDone.current) {
        deepDone.current = true
        const row = (c.data || []).find((x) => x.id === deepChild)
        if (row) (deepAction === 'paper' ? setPaperFor : setHistoryFor)(row)
      }
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la lista') })
    } finally {
      setLoading(false)
    }
  }, [classroomId, pushToast, deepChild, deepAction])
  useLoadEffect(load)

  const filtered = useMemo(() => {
    const has = (r, s) => CONSENT_TYPES.some((t) => r.consents[t].status === s)
    if (filter === 'pending') return rows.filter((r) => has(r, 'pending'))
    if (filter === 'denied') return rows.filter((r) => has(r, 'denied'))
    if (filter === 'no_images') return rows.filter((r) => r.consents.images.status !== 'granted')
    return rows
  }, [rows, filter])

  const statusCol = (t) => ({
    key: t,
    label: CONSENT_LABEL[t],
    mobileLabel: CONSENT_LABEL[t],
    sortValue: (r) => r.consents[t].status,
    render: (r) => <ConsentBadge type={t} status={r.consents[t]} />,
  })

  const columns = [
    {
      key: 'name',
      label: 'Niño',
      primary: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-2.5 min-w-0">
          <Avatar src={r.photoUrl} name={r.name} size="xs" />
          <span className="min-w-0">
            <span className="block font-medium text-slate-800 dark:text-white/85 truncate">{r.name}</span>
            <span className="block text-xs text-slate-500 dark:text-white/45">{r.classroomName || 'Sin sala'}</span>
          </span>
        </span>
      ),
    },
    statusCol('images'),
    statusCol('whatsapp'),
    statusCol('data_processing'),
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (r) => (
        <RowMenu
          items={[
            { label: 'Ver historial', icon: History, onClick: () => setHistoryFor(r) },
            { label: 'Registrar formulario en papel', icon: Pencil, onClick: () => setPaperFor(r) },
          ]}
        />
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Sala"
          className={`${inputClass} !w-auto min-w-48`}
          value={classroomId}
          onChange={(e) => setClassroomId(e.target.value)}
        >
          <option value="">Todas las salas</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <SegmentedControl size="sm" ariaLabel="Filtro" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      <SmartTable
        rows={filtered}
        columns={columns}
        loading={loading}
        searchKeys={['name', 'classroomName']}
        searchPlaceholder="Buscar niño o sala…"
        emptyMessage="No hay niños con ese filtro."
        emptyIcon={Users}
      />
      <HistoryModal child={historyFor} onClose={() => setHistoryFor(null)} />
      <PaperConsentModal
        child={paperFor}
        onClose={() => setPaperFor(null)}
        onSaved={() => {
          setPaperFor(null)
          load()
        }}
      />
    </div>
  )
}

function useChildDetail(childId) {
  const [state, setState] = useState({ forId: null, data: null })
  const load = useCallback(async () => {
    if (!childId) return
    try {
      const res = await api.get(`/consents/children/${childId}`)
      setState({ forId: childId, data: res.data })
    } catch {
      setState({ forId: childId, data: null })
    }
  }, [childId])
  useLoadEffect(load)
  return state.forId === childId ? state.data : null
}

function HistoryModal({ child, onClose }) {
  const detail = useChildDetail(child?.id)
  return (
    <Modal open={!!child} onClose={onClose} title={child ? `Consentimientos de ${child.name}` : ''} width="lg">
      {!detail ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <ConsentBadges consents={detail.consents} />
          {detail.history.length === 0 ? (
            <EmptyState icon={History} title="Sin registros" message="La familia aún no ha respondido." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-lg border border-slate-200 dark:border-white/10">
              {detail.history.map((h) => (
                <li key={h.id} className="px-3.5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-800 dark:text-white/85">
                      {CONSENT_LABEL[h.type]} · <span className={h.granted ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>{h.granted ? 'Autorizó' : 'No autorizó'}</span>
                    </span>
                    <span className="text-xs text-slate-500 dark:text-white/45 tabular-nums">{formatDateTime(h.createdAt)}</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-white/45 mt-0.5">
                    {h.method === 'presencial'
                      ? `Formulario en papel${h.guardianName ? ` de ${h.guardianName}` : ''}, registrado por ${h.recordedByName || 'personal'}`
                      : `Portal familiar · ${h.guardianName || 'representante'}`}
                    {` · texto v${h.policyVersion}`}
                    {h.ip ? ` · IP ${h.ip}` : ''}
                  </p>
                  {h.note && <p className="text-xs text-slate-600 dark:text-white/60 mt-1">Nota: {h.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}

function PaperConsentModal({ child, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const detail = useChildDetail(child?.id)
  const [form, setForm] = useState({ type: 'images', granted: null, guardianId: '', guardianName: '', note: '' })
  const [saving, setSaving] = useState(false)
  // Al abrir para otro niño, el formulario vuelve a su estado inicial (ajuste durante el render).
  const [prevId, setPrevId] = useState(child?.id)
  if (prevId !== child?.id) {
    setPrevId(child?.id)
    setForm({ type: 'images', granted: null, guardianId: '', guardianName: '', note: '' })
  }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const guardians = detail?.guardians || []
  const other = form.guardianId === '__other'
  const valid = form.granted !== null && (other ? form.guardianName.trim().length >= 3 : !!form.guardianId)

  const save = async () => {
    setSaving(true)
    try {
      await api.post(`/consents/children/${child.id}`, {
        type: form.type,
        granted: form.granted,
        method: 'presencial',
        ...(other ? { guardianName: form.guardianName.trim() } : { guardianId: form.guardianId }),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      })
      pushToast({ type: 'success', message: 'Consentimiento registrado' })
      onSaved()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo registrar') })
    } finally {
      setSaving(false)
    }
  }

  const current = detail?.consents?.[form.type]

  return (
    <Modal
      open={!!child}
      onClose={() => !saving && onClose()}
      title="Registrar formulario en papel"
      subtitle={child?.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!valid}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-white/60">
          Use esta opción cuando el representante firmó la autorización en el centro. Guarde el papel firmado: es el
          respaldo legal.
        </p>
        <Field label="Autorización">
          <select className={inputClass} value={form.type} onChange={(e) => set('type', e.target.value)}>
            {CONSENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONSENT_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        {current && (
          <p className="text-xs text-slate-500 dark:text-white/45 -mt-2">
            Estado actual: {STATUS_LABEL[current.status]}
            {current.at ? ` (${formatDateTime(current.at)})` : ''}
          </p>
        )}
        <Field label="Decisión del representante" required>
          <SegmentedControl
            ariaLabel="Decisión"
            value={form.granted === true ? 'yes' : form.granted === false ? 'no' : null}
            onChange={(v) => set('granted', v === 'yes')}
            options={[
              { value: 'yes', label: 'Autoriza' },
              { value: 'no', label: 'No autoriza' },
            ]}
          />
        </Field>
        <Field label="Quién firmó" required>
          <select className={inputClass} value={form.guardianId} onChange={(e) => set('guardianId', e.target.value)}>
            <option value="">Seleccione…</option>
            {guardians.map((g) => (
              <option key={g.guardianId} value={g.guardianId}>
                {g.name}
                {g.relationship ? ` (${g.relationship})` : ''}
              </option>
            ))}
            <option value="__other">Otra persona (sin cuenta)</option>
          </select>
        </Field>
        {other && (
          <Field label="Nombre de quien firmó" required>
            <input className={inputClass} value={form.guardianName} onChange={(e) => set('guardianName', e.target.value)} maxLength={160} />
          </Field>
        )}
        <Field label="Nota" hint="Opcional. Por ejemplo: número de formulario o dónde se archivó.">
          <textarea className={inputClass} rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ textos (dirección)

function PoliciesTab() {
  const { pushToast } = useToasts()
  const [versions, setVersions] = useState(null)
  const [editing, setEditing] = useState(null) // { type, title, body, requireReconsent }
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/consents/policies', { params: { history: 'true' } })
      setVersions(res.data || [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar los textos') })
      setVersions([])
    }
  }, [pushToast])
  useLoadEffect(load)

  const publish = async () => {
    setSaving(true)
    try {
      await api.put(`/consents/policies/${editing.type}`, {
        title: editing.title,
        body: editing.body,
        requireReconsent: editing.requireReconsent,
      })
      pushToast({ type: 'success', message: 'Nueva versión publicada' })
      setConfirming(false)
      setEditing(null)
      await load()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo publicar') })
    } finally {
      setSaving(false)
    }
  }

  if (!versions) return <Loading />

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-white/60 max-w-3xl">
        Cada cambio crea una versión nueva; las anteriores se conservan como prueba de lo que aceptó cada familia.
        Escriba <code className="px-1 rounded bg-slate-100 dark:bg-white/10">{'{centro}'}</code> para insertar el
        nombre del centro.
      </p>
      {CONSENT_TYPES.map((type) => {
        const list = versions.filter((v) => v.type === type)
        const active = list.find((v) => v.active)
        if (!active) return null
        return (
          <section key={type}>
            <SectionTitle hint={`Versión vigente ${active.version}`}>{CONSENT_LABEL[type]}</SectionTitle>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white">{active.title}</p>
                  <p className="text-xs text-slate-500 dark:text-white/45 mt-0.5">
                    Publicada el {formatDateTime(active.publishedAt)}
                    {active.createdByName ? ` por ${active.createdByName}` : ''}
                    {active.required ? ' · acuse obligatorio' : ' · voluntario'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Pencil}
                  onClick={() =>
                    setEditing({ type, title: active.title, body: active.rawBody, requireReconsent: true })
                  }
                >
                  Editar texto
                </Button>
              </div>
              <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/3 p-4">
                <PolicyText body={active.body} />
              </div>
              {list.length > 1 && (
                <p className="mt-3 text-xs text-slate-500 dark:text-white/45">
                  Versiones anteriores:{' '}
                  {list
                    .filter((v) => !v.active)
                    .map((v) => `v${v.version} (${formatDateTime(v.publishedAt)})`)
                    .join(' · ')}
                </p>
              )}
            </Card>
          </section>
        )
      })}

      <Modal
        open={!!editing}
        onClose={() => !saving && setEditing(null)}
        title={editing ? `Editar: ${CONSENT_LABEL[editing.type]}` : ''}
        width="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              icon={FileText}
              disabled={!editing || editing.title.trim().length < 3 || editing.body.trim().length < 20}
              onClick={() => setConfirming(true)}
            >
              Publicar versión nueva
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Título" required>
              <input
                className={inputClass}
                value={editing.title}
                maxLength={200}
                onChange={(e) => setEditing((s) => ({ ...s, title: e.target.value }))}
              />
            </Field>
            <Field label="Texto" required hint="Texto plano. Línea en blanco = párrafo nuevo; '- ' al inicio = punto de lista.">
              <textarea
                className={`${inputClass} font-mono text-[13px]`}
                rows={16}
                value={editing.body}
                onChange={(e) => setEditing((s) => ({ ...s, body: e.target.value }))}
              />
            </Field>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-white/10 p-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
                checked={editing.requireReconsent}
                onChange={(e) => setEditing((s) => ({ ...s, requireReconsent: e.target.checked }))}
              />
              <span className="text-sm text-slate-700 dark:text-white/80">
                <span className="font-medium">Exigir que las familias vuelvan a confirmar</span>
                <span className="block text-xs text-slate-500 dark:text-white/45 mt-0.5">
                  Márquelo si cambia qué datos se usan, para qué o con quién se comparten. Desmárquelo sólo para
                  correcciones de redacción.
                </span>
              </span>
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirming}
        onClose={() => !saving && setConfirming(false)}
        onConfirm={publish}
        loading={saving}
        variant="warning"
        title="Publicar versión nueva"
        message={
          editing?.requireReconsent
            ? 'Todas las autorizaciones dadas con el texto anterior pasarán a "Pendiente". Las familias verán el nuevo texto al entrar al portal y, mientras no respondan, no se podrán tomar fotos individuales de sus niños.'
            : 'Se publicará como corrección menor: las autorizaciones actuales siguen vigentes.'
        }
        confirmText="Publicar"
      />
    </div>
  )
}
