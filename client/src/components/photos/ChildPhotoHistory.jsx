import { useCallback, useState } from 'react'
import { Camera, Images } from '../icons'
import { Button, Card, EmptyState, Loading, SegmentedControl } from '../ui'
import { addDays, api, apiError, longDate, todayKey } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { useLiveReload } from '../../realtime'
import MomentCaptureModal from './MomentCaptureModal'
import StaffPhotoGrid from './StaffPhotoGrid'
import { groupByDay } from './photoUtils'

const RANGES = [
  { value: 7, label: '7 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '3 meses' },
]

/** Historial de fotos de un niño (panel), agrupado por día, con edición. */
export default function ChildPhotoHistory({ childId, classroomId, childName }) {
  const [days, setDays] = useState(30)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)
      try {
        const to = todayKey()
        const { data } = await api.get('/photos', { params: { childId, from: addDays(to, -days + 1), to } })
        setPhotos(data || [])
        setError('')
      } catch (err) {
        if (!silent) setError(apiError(err, 'No se pudieron cargar las fotos'))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [childId, days],
  )
  useLoadEffect(load)
  const quiet = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quiet, { entities: ['photo'], childId })

  const groups = groupByDay(photos)
  const today = todayKey()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl ariaLabel="Periodo" value={days} onChange={setDays} options={RANGES} size="sm" />
        <Button icon={Camera} onClick={() => setAdding(true)}>
          Añadir momento
        </Button>
      </div>
      {loading ? (
        <Card>
          <Loading />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState icon={Images} title={error} />
        </Card>
      ) : !photos.length ? (
        <Card>
          <EmptyState
            icon={Images}
            title={`Sin fotos de ${(childName || '').split(' ')[0] || 'este niño'} en este periodo`}
            message="Las fotos en las que sale (momentos, actividades, comidas…) aparecen aquí y en el portal de su familia."
          />
        </Card>
      ) : (
        groups.map(([day, list]) => (
          <Card key={day}>
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white first-letter:uppercase">
                {day === today ? 'Hoy' : longDate(day)}
              </h3>
              <span className="text-xs text-slate-500 dark:text-white/45 tabular-nums">
                {list.length} {list.length === 1 ? 'foto' : 'fotos'}
              </span>
            </div>
            <StaffPhotoGrid
              photos={list}
              onChange={(next) => setPhotos((all) => [...all.filter((p) => (p.date || '') !== day), ...next].sort((a, b) => (a.date < b.date ? 1 : -1)))}
            />
          </Card>
        ))
      )}
      {adding && (
        <MomentCaptureModal
          open
          onClose={() => setAdding(false)}
          onSaved={() => load({ silent: true })}
          classroomId={classroomId}
          childId={childId}
        />
      )}
    </div>
  )
}
