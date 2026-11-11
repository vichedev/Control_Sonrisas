import { createContext, useCallback, useContext, useState } from 'react'

const ToastsContext = createContext(null)

export function ToastsProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2)
    const entry = { id, type: 'info', ...toast }
    setToasts((prev) => [...prev, entry])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, toast.duration || (entry.type === 'error' ? 8000 : 4000))
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastsContext.Provider value={{ toasts, pushToast, dismissToast }}>
      {children}
    </ToastsContext.Provider>
  )
}

export function useToasts() {
  const ctx = useContext(ToastsContext)
  if (!ctx) throw new Error('useToasts debe usarse dentro de <ToastsProvider>')
  return ctx
}
