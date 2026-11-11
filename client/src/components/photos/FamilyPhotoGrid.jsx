import { useState } from 'react'
import { Clock, Sparkles, Users } from '../icons'
import { mediaUrl } from '../../api/client'
import Lightbox from './Lightbox'
import { othersLabel, photoTime } from './photoUtils'

/**
 * Rejilla de fotos para las familias (portal): miniaturas con hora, actividad y pie;
 * al tocar se abre el visor con deslizar, flechas y descarga.
 * `photos`: [{ id, url, caption, takenAt, activityTitle, othersCount }]
 */
export default function FamilyPhotoGrid({ photos, downloadName = 'foto', featured = true }) {
  const [index, setIndex] = useState(-1)
  if (!photos?.length) return null
  // La primera foto en grande cuando hay 3 o más: se ve como un álbum, no como una lista.
  const big = featured && photos.length >= 3

  return (
    <>
      <ul className={`grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 ${featured ? '' : 'lg:grid-cols-4'}`}>
        {photos.map((p, i) => {
          const time = photoTime(p.takenAt || p.createdAt)
          const first = big && i === 0
          return (
            <li key={p.id} className={first ? 'col-span-2 row-span-2' : ''}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                className="group relative block w-full h-full overflow-hidden rounded-lg bg-slate-100 dark:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                aria-label={`Ver foto${p.caption ? `: ${p.caption}` : ''}${time ? `, ${time}` : ''}`}
              >
                <img
                  src={mediaUrl(p.url)}
                  alt={p.caption || ''}
                  loading="lazy"
                  className={`w-full object-cover transition group-hover:scale-[1.02] ${first ? 'aspect-square sm:h-full' : 'aspect-square'}`}
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 p-2 bg-black/55 text-left">
                  {p.caption && (
                    <span className={`block text-white leading-snug ${first ? 'text-sm line-clamp-2' : 'text-xs line-clamp-1'}`}>
                      {p.caption}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-white/80">
                    {time && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock className="w-3 h-3" /> {time}
                      </span>
                    )}
                    {p.activityTitle && (
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Sparkles className="w-3 h-3 shrink-0" /> <span className="truncate">{p.activityTitle}</span>
                      </span>
                    )}
                    {first && p.othersCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3 h-3" /> {othersLabel(p.othersCount)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <Lightbox items={photos} index={index} onIndex={setIndex} onClose={() => setIndex(-1)} downloadName={downloadName} />
    </>
  )
}
