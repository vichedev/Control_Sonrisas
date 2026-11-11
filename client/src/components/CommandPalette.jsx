import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CornerDownLeft, Search, X } from './icons'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { allPagesFor, normalize } from './navConfig'
import { Avatar, Kbd } from './ui'
import { formatDocumentId, matchChild } from './childSearch'

const MAX_CHILDREN = 8

/**
 * Buscador global (Ctrl+K): ir a la ficha de un niño o a cualquier página por su nombre.
 * Los niños se cargan una vez al abrir (la educadora sólo recibe los de sus salas) y se
 * filtran en el navegador, sin tildes, para que la respuesta sea instantánea.
 */
export default function CommandPalette({ open, onClose }) {
  if (!open) return null
  return <PaletteDialog onClose={onClose} />
}

// Caché del módulo: reabrir el buscador es instantáneo (se refresca en segundo plano).
let childrenCache = null

function PaletteDialog({ onClose }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [children, setChildren] = useState(childrenCache || [])
  const [loadingKids, setLoadingKids] = useState(!childrenCache)

  useEffect(() => {
    let cancelled = false
    api
      .get('/children')
      .then((r) => {
        childrenCache = (r.data || []).map((c) => ({
          id: c.id,
          name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
          photoUrl: c.photoUrl,
          room: c.classroomName || c.classroom?.name || '',
          allergies: c.allergies,
          documentId: c.documentId || '',
          code: c.code || '',
          key: normalize(`${c.firstName} ${c.lastName}`),
        }))
        if (!cancelled) setChildren(childrenCache)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingKids(false))
    return () => {
      cancelled = true
    }
  }, [])

  // Escape (en captura, para no cerrar también un modal de debajo) y bloqueo del scroll.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    const prevFocus = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true })
    }
  }, [onClose])

  const pages = useMemo(() => allPagesFor(auth), [auth])

  const results = useMemo(() => {
    const q = normalize(query)
    const pageItems = pages
      .filter((p) => !q || normalize(`${p.label} ${p.section || ''} ${p.keywords || ''}`).includes(q))
      .map((p) => ({ kind: 'page', id: p.to, to: p.to, label: p.label, icon: p.icon, hint: p.section }))
    if (!q) {
      // Sin texto: sólo páginas (las del día primero, que ya vienen en ese orden).
      return [{ group: 'Ir a', items: pageItems }]
    }
    // Nombre (sin tildes, en cualquier orden), cédula (con o sin guion) o matrícula.
    const kids = children
      .filter((c) => matchChild(c, query))
      .sort((a, b) => Number(!a.key.startsWith(q)) - Number(!b.key.startsWith(q)))
      .slice(0, MAX_CHILDREN)
      .map((c) => ({ kind: 'child', id: c.id, to: `/panel/ninos/${c.id}`, label: c.name, child: c,
        hint: [c.room || 'Sin sala', c.documentId && `Cédula ${formatDocumentId(c.documentId)}`].filter(Boolean).join(' · '),
      }))
    return [
      { group: 'Niños', items: kids },
      { group: 'Páginas', items: pageItems },
    ].filter((g) => g.items.length)
  }, [query, pages, children])

  const flat = useMemo(() => results.flatMap((g) => g.items), [results])
  const safeActive = Math.min(active, Math.max(0, flat.length - 1))

  // Mantiene visible la opción activa al moverse con el teclado.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${safeActive}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [safeActive])

  const go = (item) => {
    if (!item) return
    onClose()
    navigate(item.to)
  }

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (flat.length ? (Math.min(i, flat.length - 1) + 1) % flat.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (flat.length ? (Math.min(i, flat.length - 1) - 1 + flat.length) % flat.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(flat[safeActive])
    } else if (e.key === 'Tab') {
      // El foco se queda en el campo: Tab no debe escaparse a la página de detrás.
      e.preventDefault()
    }
  }

  let index = -1
  const optionId = (i) => `cmdk-opt-${i}`

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 sm:p-6 sm:pt-[12vh]">
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar niños y páginas"
        className="relative w-full max-w-xl rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-elevated shadow-xl overflow-hidden animate-pop-in"
      >
        <div className="flex items-center gap-3 px-4 border-b border-slate-200/70 dark:border-white/8">
          <Search className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onInputKey}
            placeholder="Busca un niño (nombre o cédula) o una página…"
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={flat.length ? optionId(safeActive) : undefined}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 h-12 bg-transparent text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="sm:hidden p-2 -mr-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
            aria-label="Cerrar buscador"
          >
            <X className="w-5 h-5" />
          </button>
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        </div>

        <div ref={listRef} id="cmdk-list" role="listbox" className="max-h-[60dvh] overflow-y-auto p-2">
          {flat.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-slate-500 dark:text-white/50">
              {loadingKids ? 'Buscando…' : `No hay resultados para “${query}”.`}
            </p>
          )}
          {results.map((g) => (
            <div key={g.group} className="mb-1">
              <p className="px-3 pt-2 pb-1 text-[11px] font-medium text-slate-400 dark:text-white/40">
                {g.group}
              </p>
              {g.items.map((item) => {
                index += 1
                const i = index
                const isActive = i === safeActive
                const Icon = item.icon
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    id={optionId(i)}
                    data-index={i}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(item)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      isActive
                        ? 'bg-accent-soft text-accent-text'
                        : 'text-slate-700 dark:text-white/75'
                    }`}
                  >
                    {item.kind === 'child' ? (
                      <Avatar src={item.child.photoUrl} name={item.label} size="xs" />
                    ) : (
                      <span className="w-7 h-7 shrink-0 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-center">
                        {Icon && <Icon className="w-4 h-4" />}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{item.label}</span>
                      {item.hint && (
                        <span className="block text-xs text-slate-400 dark:text-white/40 truncate">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {item.kind === 'child' && item.child.allergies?.trim() && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-accent-soft text-accent-text">
                        Alergias
                      </span>
                    )}
                    {isActive ? (
                      <CornerDownLeft className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
                    ) : (
                      <ArrowRight className="w-4 h-4 shrink-0 text-transparent" aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-slate-200/70 dark:border-white/8 bg-slate-50 dark:bg-white/3 text-[11px] text-slate-400 dark:text-white/40">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> moverse
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Enter</Kbd> abrir
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Esc</Kbd> cerrar
          </span>
        </div>
      </div>
    </div>
  )
}
