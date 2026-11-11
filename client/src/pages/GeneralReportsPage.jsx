import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, Download, Users, Utensils } from '../components/icons'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { addDays, api, apiError, shortDate, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useToasts } from '../context/ToastsContext'
import DayFilters from '../components/DayFilters'
import SmartTable from '../components/SmartTable'
import {
  Button,
  Card,
  EmptyState,
  inputClass,
  PageHeader,
  SectionTitle,
  StatTile,
} from '../components/ui'

/** Rangos rápidos: lo que se pide casi siempre. */
function monthStart() {
  const t = todayKey()
  return `${t.slice(0, 8)}01`
}
const PRESETS = [
  ['7', 'Últimos 7 días', () => [addDays(todayKey(), -6), todayKey()]],
  ['30', 'Últimos 30 días', () => [addDays(todayKey(), -29), todayKey()]],
  ['month', 'Este mes', () => [monthStart(), todayKey()]],
]

const INTAKE = [
  ['all', 'Comió todo', 'bg-emerald-500'],
  ['most', 'Casi todo', 'bg-emerald-300'],
  ['half', 'La mitad', 'bg-amber-400'],
  ['little', 'Poco', 'bg-amber-600'],
  ['none', 'No comió', 'bg-red-500'],
]

/** Filtros de la tabla "Asistencia por niño". */
const REPORT_FILTERS = [
  { key: 'room', label: 'Sala', multiple: true, value: (r) => r.classroomName, emptyLabel: 'Sin sala' },
  {
    key: 'pct',
    label: 'Asistencia',
    value: (r) => (r.attendancePct >= 85 ? 'good' : r.attendancePct >= 60 ? 'mid' : 'low'),
    options: [
      { value: 'low', label: 'Baja (menos de 60 %)' },
      { value: 'mid', label: 'Regular (60–84 %)' },
      { value: 'good', label: 'Buena (85 % o más)' },
    ],
  },
  {
    key: 'flags',
    label: 'Con…',
    multiple: true,
    value: (r) => [r.absent > 0 && 'absent', r.late > 0 && 'late', r.justified > 0 && 'justified'].filter(Boolean),
    options: [
      { value: 'absent', label: 'Ausencias' },
      { value: 'late', label: 'Tardanzas' },
      { value: 'justified', label: 'Justificadas' },
    ],
  },
  {
    key: 'state',
    label: 'Estado',
    value: (r) => (r.active === false ? 'off' : 'on'),
    options: [
      { value: 'on', label: 'Activos' },
      { value: 'off', label: 'Retirados' },
    ],
  },
]

const pctTone = (p) =>
  p >= 85
    ? ['bg-emerald-500', 'text-emerald-700 dark:text-emerald-300']
    : p >= 60
      ? ['bg-amber-500', 'text-amber-700 dark:text-amber-300']
      : ['bg-red-500', 'text-red-700 dark:text-red-300']

/** Color de acento actual (CSS var) para recharts: los atributos SVG no resuelven var(). */
function accentColor() {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb'
  } catch {
    return '#2563eb'
  }
}

/** Serie "faltaron": gris neutro (no compite con el acento, sea cual sea el color de marca). */
function neutralColor() {
  try {
    return document.documentElement.classList.contains('dark') ? '#475569' : '#cbd5e1'
  } catch {
    return '#cbd5e1'
  }
}

/** Tooltip con los tokens del sistema (funciona en claro y oscuro). */
const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 12,
  boxShadow: '0 4px 12px -4px rgba(15,23,42,0.12)',
}

/** Informes generales: asistencia por niño, tendencia y alimentación de un rango. */
export default function GeneralReportsPage() {
  const { pushToast } = useToasts()

  const [from, setFrom] = useState(addDays(todayKey(), -29))
  const [to, setTo] = useState(todayKey())
  const [classroomId, setClassroomId] = useState('')
  const [report, setReport] = useState(null)
  const [trend, setTrend] = useState([])
  const [meals, setMeals] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [att, tr, ms] = await Promise.all([
        api.get('/reports/attendance', { params: { from, to, classroomId: classroomId || undefined } }),
        api.get('/reports/attendance-trend', {
          params: { from, to, classroomId: classroomId || undefined },
        }),
        api.get('/meals/summary', { params: { from, to, classroomId: classroomId || undefined } }),
      ])
      setReport(att.data)
      // Los días cerrados (feriados, fines de semana) no aportan nada al gráfico.
      setTrend((tr.data || []).filter((d) => !d.closed))
      setMeals(ms.data)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron generar los informes') })
    } finally {
      setLoading(false)
    }
  }, [from, to, classroomId, pushToast])

  useLoadEffect(load)

  // Cédulas para buscar en la tabla (el informe sólo trae nombre y sala).
  const [docs, setDocs] = useState({})
  useEffect(() => {
    api
      .get('/children', { params: { includeInactive: 'true' } })
      .then((r) => setDocs(Object.fromEntries((r.data || []).map((c) => [c.id, c.documentId || '']))))
      .catch(() => {})
  }, [])
  const searchKeys = useMemo(() => ['name', 'classroomName', (r) => docs[r.childId]], [docs])
  // Filas visibles tras buscar/filtrar: es lo que se exporta.
  const visibleRows = useRef([])
  const onFiltered = useCallback((list) => {
    visibleRows.current = list
  }, [])

  /**
   * Celda CSV segura: un nombre que empiece por = + - @ (o tab/CR) lo ejecutaría Excel
   * como fórmula; se neutraliza anteponiendo una comilla simple.
   */
  const csvCell = (v) => {
    let text = String(v ?? '')
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }

  /** Exporta la tabla de asistencia a CSV, que es lo que piden las entidades de control. */
  const exportCsv = () => {
    const rows = visibleRows.current.length ? visibleRows.current : report?.rows || []
    if (!rows.length) return
    const header = ['Niño', 'Sala', 'Estado', 'Días hábiles', 'Días presente', 'Ausencias', 'Justificadas', 'Tardanzas', '% asistencia']
    const body = rows.map((r) =>
      [
        r.name,
        r.classroomName,
        r.active === false ? 'Retirado' : 'Activo',
        r.openDays ?? '',
        r.present,
        r.absent,
        r.justified,
        r.late,
        `${r.attendancePct}%`,
      ]
        .map(csvCell)
        .join(','),
    )
    const csv = [header.join(','), ...body].join('\n')
    // BOM para que Excel en español abra los acentos correctamente.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `asistencia-${from}-a-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
    pushToast({ type: 'success', message: `Exportados ${rows.length} niños a CSV` })
  }

  const rows = report?.rows || []
  const avgAttendance = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + r.attendancePct, 0) / rows.length)
    : 0
  const lowAttendance = rows.filter((r) => r.attendancePct < 60).length
  const activePreset = PRESETS.find(([, , fn]) => {
    const [f, t] = fn()
    return f === from && t === to
  })?.[0]
  const mealTotal = meals?.total || 0

  return (
    <>
      <PageHeader
        title="Informes"
        subtitle={`${shortDate(from)} – ${shortDate(to)}`}
        icon={CalendarDays}
        actions={
          <Button icon={Download} onClick={exportCsv} disabled={!rows.length}>
            Exportar asistencia (CSV)
          </Button>
        }
      />

      {/* Filtros: rango rápido o fechas exactas + sala */}
      <Card className="mb-5" padded={false}>
        <div className="p-3 sm:p-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-white/5" role="group" aria-label="Rango rápido">
            {PRESETS.map(([key, label, fn]) => (
              <button
                key={key}
                type="button"
                aria-pressed={activePreset === key}
                onClick={() => {
                  const [f, t] = fn()
                  setFrom(f)
                  setTo(t)
                }}
                className={`px-3 min-h-9 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                  activePreset === key
                    ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/45">
            <input
              type="date"
              aria-label="Desde"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className={`${inputClass} w-auto!`}
            />
            <span>a</span>
            <input
              type="date"
              aria-label="Hasta"
              value={to}
              min={from}
              max={todayKey()}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className={`${inputClass} w-auto!`}
            />
          </div>
          <DayFilters classroomId={classroomId} onClassroomChange={setClassroomId} />
          {loading && (
            <span className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-white/45">
              <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              Actualizando…
            </span>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Días abiertos" icon={CalendarDays} value={report?.openDays ?? 0} hint="Sin feriados ni fines de semana" />
        <StatTile label="Niños" icon={Users} value={rows.length} tone="accent" hint={lowAttendance ? `${lowAttendance} bajo 60%` : 'Ninguno bajo 60%'} />
        <StatTile label="Asistencia media" icon={CheckCircle2} value={`${avgAttendance}%`} tone="green" />
        <StatTile
          label="Comieron bien"
          icon={Utensils}
          value={`${meals?.ateWellPct ?? 0}%`}
          tone="amber"
          hint={`Todo o casi todo · ${mealTotal} registros`}
        />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5 mb-5">
        <Card>
          <SectionTitle hint="Por día abierto">Asistencia diaria</SectionTitle>
          {trend.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Sin datos en el rango" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barGap={2}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-white/8" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => `${d.slice(8)}/${d.slice(5, 7)}`}
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    stroke="currentColor"
                    className="text-slate-500 dark:text-white/45"
                    tickLine={false}
                    minTickGap={12}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    stroke="currentColor"
                    className="text-slate-500 dark:text-white/45"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: 'var(--text-secondary)', marginBottom: 2 }}
                    labelFormatter={(d) => shortDate(d)}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(v) => <span style={{ color: 'var(--text-secondary)' }}>{v}</span>}
                  />
                  <Bar dataKey="present" name="Asistieron" fill={accentColor()} radius={[3, 3, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="absent" name="Faltaron" fill={neutralColor()} radius={[3, 3, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle hint={`${mealTotal} registros`}>Cuánto comieron</SectionTitle>
          {!mealTotal ? (
            <EmptyState icon={Utensils} title="Sin registros de comidas" />
          ) : (
            <>
              <div className="flex h-2 rounded-full overflow-hidden mb-4 gap-px bg-slate-100 dark:bg-white/10" aria-hidden="true">
                {INTAKE.map(([key, , color]) =>
                  meals.counts?.[key] ? (
                    <div key={key} className={color} style={{ width: `${(meals.counts[key] / mealTotal) * 100}%` }} />
                  ) : null,
                )}
              </div>
              <ul className="space-y-2">
                {INTAKE.map(([key, label, color]) => {
                  const n = meals.counts?.[key] || 0
                  return (
                    <li key={key} className="flex items-center gap-2 text-sm">
                      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
                      <span className="flex-1 text-slate-700 dark:text-white/75">{label}</span>
                      <span className="tabular-nums font-semibold text-slate-900 dark:text-white">{n}</span>
                      <span className="tabular-nums text-xs text-slate-400 dark:text-white/40 w-10 text-right">
                        {Math.round((n / mealTotal) * 100)}%
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Card>
      </div>

      <SectionTitle hint={`${report?.openDays ?? 0} días abiertos en el rango`}>Asistencia por niño</SectionTitle>
      <SmartTable
        rows={rows}
        rowKey="childId"
        loading={loading && !report}
        searchKeys={searchKeys}
        searchPlaceholder="Buscar niño, cédula o sala…"
        filters={REPORT_FILTERS}
        storageKey="report-attendance"
        defaultSort={{ key: 'name', dir: 'asc' }}
        columnToggle
        itemLabel={['niño', 'niños']}
        onFiltered={onFiltered}
        emptyMessage="Sin niños en el rango seleccionado."
        emptyIcon={CalendarDays}
        toolbar={
          <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!rows.length} title="Exporta las filas visibles (con la búsqueda y filtros aplicados)">
            CSV
          </Button>
        }
        columns={[
          {
            key: 'name',
            label: 'Niño',
            primary: true,
            sortValue: (r) => r.name,
            render: (r) => (
              <span className="font-semibold text-slate-900 dark:text-white">
                {r.name}
                {r.active === false && <span className="ml-1.5 text-xs font-normal text-slate-400">(retirado)</span>}
              </span>
            ),
          },
          { key: 'classroom', label: 'Sala', sortValue: (r) => r.classroomName || '', render: (r) => r.classroomName || '—' },
          {
            key: 'present',
            label: 'Presente',
            className: 'text-right tabular-nums',
            sortValue: (r) => r.present,
            render: (r) => (r.openDays != null ? `${r.present} de ${r.openDays}` : `${r.present}`),
          },
          { key: 'absent', label: 'Ausencias', className: 'text-right tabular-nums', sortValue: (r) => r.absent, render: (r) => r.absent },
          { key: 'justified', label: 'Justificadas', className: 'text-right tabular-nums', sortValue: (r) => r.justified, render: (r) => r.justified },
          { key: 'late', label: 'Tardanzas', className: 'text-right tabular-nums', sortValue: (r) => r.late, render: (r) => r.late },
          {
            key: 'pct',
            label: '% asistencia',
            mobileLabel: 'Asistencia',
            sortValue: (r) => r.attendancePct,
            render: (r) => {
              const [bar, text] = pctTone(r.attendancePct)
              return (
                <div className="flex items-center gap-2 min-w-28">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                    <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, r.attendancePct)}%` }} />
                  </div>
                  <span className={`text-xs font-semibold tabular-nums w-10 text-right ${text}`}>{r.attendancePct}%</span>
                </div>
              )
            },
          },
        ]}
      />
    </>
  )
}
