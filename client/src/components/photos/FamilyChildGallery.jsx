import { useCallback, useEffect, useRef, useState } from 'react'
import { Images, Loader2, Users } from '../icons'
import { Button, Card, EmptyState, SegmentedControl, Skeleton } from '../ui'
import { addDays, api, apiError, longDate, todayKey } from '../../api/client'
import { useLiveReload } from '../../realtime'
import FamilyPhotoGrid from './FamilyPhotoGrid'
import { groupByDay } from './photoUtils'

const PAGE = 24

/** "Hoy", "Ayer" o "lunes, 3 de agosto". */
function dayLabel(day) {
  const today = todayKey()
  if (day === today) return 'Hoy'
  if (day === addDays(today, -1)) return 'Ayer'
  const s = longDate(day).replace(/ de \d{4}$/, (m) => (day.slice(0, 4) === today.slice(0, 4) ? '' : m))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Galería de un niño para su familia, agrupada por día y paginada (se cargan más al
 * llegar al final). `scope`: 'child' (fotos en las que sale) o 'room' (fotos de la sala).
 */
export default function FamilyChildGallery({ childId, childName, allowRoom = true }) {
  const [scope, setScope] = useState('child')
  const [state, setState] = useState({ key: '', items: [], page: 0, hasMore: false, total: 0 })
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const sentinel = useRef(null)
  const key = `${childId}|${scope}`

  const fetchPage = useCallback(
    (page, limit = PAGE) => api.get(`/family/children/${childId}/photos`, { params: { scope, page, limit } }).then((r) => r.data),
    [childId, scope],
  )

  // Primera página (y al cambiar de niño o de vista).
  useEffect(() => {
    let cancelled = false
    fetchPage(1)
      .then((d) => !cancelled && setState({ key, items: d.items || [], page: 1, hasMore: !!d.hasMore, total: d.total || 0 }))
      .catch((err) => {
        if (cancelled) return
        setError(apiError(err, 'No se pudieron cargar las fotos'))
        setState({ key, items: [], page: 0, hasMore: false, total: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [fetchPage, key])

  const loadMore = useCallback(async () => {
    if (loadingMore || !state.hasMore || state.key !== key) return
    setLoadingMore(true)
    try {
      const d = await fetchPage(state.page + 1)
      setState((s) => {
        const seen = new Set(s.items.map((p) => p.id))
        return { ...s, items: [...s.items, ...(d.items || []).filter((p) => !seen.has(p.id))], page: s.page + 1, hasMore: !!d.hasMore, total: d.total || s.total }
      })
    } catch (err) {
      setError(apiError(err, 'No se pudieron cargar más fotos'))
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage, key, loadingMore, state])

  // En vivo: recarga lo ya mostrado (mismas páginas) sin saltos.
  const refresh = useCallback(async () => {
    try {
      const pages = Math.max(state.page, 1)
      const d = await fetchPage(1, Math.min(PAGE * pages, 100))
      setState((s) => (s.key === key ? { ...s, items: d.items || [], hasMore: !!d.hasMore || (d.total || 0) > (d.items || []).length, total: d.total || 0 } : s))
    } catch {
      /* se reintenta con el próximo evento */
    }
  }, [fetchPage, key, state.page])
  useLiveReload(refresh, { entities: ['photo'] })

  // Carga automática al llegar al final.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !state.hasMore) return undefined
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, state.hasMore])

  const loading = state.key !== key
  const name = (childName || '').split(' ')[0]
  const groups = groupByDay(state.items)

  return (
    <div className="space-y-4">
      {allowRoom && (
        <SegmentedControl
          ariaLabel="Qué fotos ver"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'child', label: name ? `Fotos de ${name}` : 'Sus fotos', icon: Images },
            { value: 'room', label: 'Fotos de la sala', icon: Users },
          ]}
        />
      )}

      {loading ? (
        <Card>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square h-auto rounded-lg" />
            ))}
          </div>
        </Card>
      ) : error && !state.items.length ? (
        <Card>
          <EmptyState icon={Images} title={error} />
        </Card>
      ) : !state.items.length ? (
        <Card>
          <EmptyState
            icon={Images}
            title={scope === 'room' ? 'Aún no hay fotos de la sala' : `Aún no hay fotos${name ? ` de ${name}` : ''}`}
            message={
              scope === 'room'
                ? 'Aquí aparecerán las fotos grupales que comparta la guardería.'
                : 'Cuando sus educadoras le tomen fotos en las actividades o en momentos especiales, aparecerán aquí, día por día.'
            }
          />
        </Card>
      ) : (
        <>
          <p className="text-xs text-slate-500 dark:text-white/45 tabular-nums px-1">
            {state.total} {state.total === 1 ? 'foto' : 'fotos'}
          </p>
          {groups.map(([day, photos]) => (
            <Card key={day}>
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">{dayLabel(day)}</h3>
                <span className="text-xs text-slate-500 dark:text-white/45 tabular-nums">
                  {photos.length} {photos.length === 1 ? 'foto' : 'fotos'}
                </span>
              </div>
              <FamilyPhotoGrid photos={photos} featured={false} downloadName={name ? name.toLowerCase() : 'foto'} />
            </Card>
          ))}
          <div ref={sentinel} />
          {state.hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore} icon={loadingMore ? Loader2 : undefined}>
                Ver más fotos
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
