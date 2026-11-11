import { useCallback, useState } from 'react'
import { Images } from '../../components/icons'
import { api, apiError } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { useToasts } from '../../context/ToastsContext'
import { Avatar, Card, EmptyState, Loading, PageHeader } from '../../components/ui'
import FamilyChildGallery from '../../components/photos/FamilyChildGallery'

const KEY = 'familia.galeria.nino'

function readPref() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Galería del portal familiar: por niño (hermanos con selector), agrupada por día,
 * con las fotos en las que sale y, aparte, las fotos de su sala.
 */
export default function FamilyGalleryPage() {
  const { pushToast } = useToasts()
  const [children, setChildren] = useState(null)
  const [picked, setPicked] = useState(readPref)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/family/children')
      setChildren(res.data || [])
    } catch (err) {
      setChildren([])
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar tus niños') })
    }
  }, [pushToast])
  useLoadEffect(load)

  const pick = (id) => {
    setPicked(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* sin almacenamiento */
    }
  }

  if (!children) return <Loading />
  const current = children.find((c) => c.id === picked) || children[0]

  return (
    <>
      <PageHeader title="Fotos" subtitle="Lo que vivieron en la guardería, día por día" icon={Images} />

      {!current ? (
        <Card>
          <EmptyState icon={Images} title="Todavía no hay fotos" message="Aquí aparecerán las fotos que la guardería comparta del día a día." />
        </Card>
      ) : (
        <div className="space-y-4">
          {children.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="radiogroup" aria-label="Elegir niño">
              {children.map((c) => {
                const on = c.id === current.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pick(c.id)}
                    className={`shrink-0 inline-flex items-center gap-2 min-h-11 pl-1.5 pr-3 rounded-lg border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                      on
                        ? 'bg-accent-soft text-accent-text border-accent/30'
                        : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/75 hover:bg-slate-50 dark:hover:bg-white/10'
                    }`}
                  >
                    <Avatar src={c.photoUrl} name={c.name} size="sm" />
                    {c.name.split(' ')[0]}
                  </button>
                )
              })}
            </div>
          )}
          <FamilyChildGallery key={current.id} childId={current.id} childName={current.name} />
        </div>
      )}
    </>
  )
}
