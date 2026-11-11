import { useCallback, useState } from 'react'
import { Camera, Images } from '../icons'
import { Button, Card, EmptyState, Skeleton } from '../ui'
import { api, apiError, todayKey } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { useLiveReload } from '../../realtime'
import MomentCaptureModal from './MomentCaptureModal'
import StaffPhotoGrid from './StaffPhotoGrid'

/**
 * Galería del día de un niño (panel): las fotos en las que sale, con edición de
 * etiquetas/pie y "Añadir momento". Es lo mismo que verá su familia (salvo las no compartidas).
 */
export default function ChildDayGallery({ childId, classroomId, date, childName, canAdd = true, bare = false }) {
  const day = date || todayKey()
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)
      try {
        const { data } = await api.get('/photos', { params: { childId, date: day } })
        // Del más antiguo al más reciente: se lee como el día.
        setPhotos([...(data || [])].sort((a, b) => new Date(a.takenAt || a.createdAt) - new Date(b.takenAt || b.createdAt)))
        setError('')
      } catch (err) {
        if (!silent) setError(apiError(err, 'No se pudieron cargar las fotos'))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [childId, day],
  )
  useLoadEffect(load)
  const quiet = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quiet, { entities: ['photo'], childId })

  const shared = photos.filter((p) => p.shareWithFamily !== false).length
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Images className="w-4 h-4 text-slate-400" /> Fotos del día
        </h3>
        <p className="text-xs text-slate-500 dark:text-white/45 tabular-nums">
          {photos.length === 0
            ? 'Aún no hay fotos'
            : `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'} · ${shared} visibles para la familia`}
        </p>
      </div>
      {canAdd && (
        <Button size="sm" icon={Camera} onClick={() => setAdding(true)}>
          Añadir momento
        </Button>
      )}
    </div>
  )

  const body = loading ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="aspect-4/3 rounded-xl h-auto" />
      ))}
    </div>
  ) : error ? (
    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  ) : photos.length === 0 ? (
    <EmptyState
      icon={Images}
      title={`Sin fotos de ${childName?.split(' ')[0] || 'este niño'} hoy`}
      message="Toma fotos de lo que está haciendo: su familia las verá en el portal y en el reporte del día."
    />
  ) : (
    <StaffPhotoGrid photos={photos} onChange={setPhotos} />
  )

  return (
    <>
      {bare ? (
        <div>
          {header}
          {body}
        </div>
      ) : (
        <Card>
          {header}
          {body}
        </Card>
      )}
      {adding && (
        <MomentCaptureModal
          open
          onClose={() => setAdding(false)}
          onSaved={() => load({ silent: true })}
          classroomId={classroomId}
          childId={childId}
          date={day}
        />
      )}
    </>
  )
}
