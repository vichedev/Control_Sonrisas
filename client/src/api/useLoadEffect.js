import { useEffect } from 'react'

/**
 * Lanza `load` cada vez que cambia — normalmente al cambiar los filtros de día o sala.
 *
 * El disparo se difiere un tick a propósito. Llamar a `load()` en el cuerpo del efecto
 * ejecutaría su `setLoading(true)` de forma síncrona durante el commit, que es justo lo
 * que provoca renders en cascada. Además, al diferirlo, cambiar de filtro rápidamente
 * cancela la carga anterior en vez de encadenar peticiones que se pisan entre sí.
 *
 * `load` debe venir memoizado con `useCallback`, o el efecto se relanzaría en cada render.
 */
export function useLoadEffect(load) {
  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])
}
