import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'

/** Orden en que se muestran los consentimientos. */
export const CONSENT_TYPES = ['data_processing', 'images', 'whatsapp']

export const CONSENT_LABEL = {
  data_processing: 'Tratamiento de datos',
  images: 'Uso de imagen',
  whatsapp: 'Avisos por WhatsApp',
}

/** Texto corto de cada estado, según el tipo. */
export const STATUS_LABEL = {
  granted: 'Autorizado',
  denied: 'No autorizado',
  pending: 'Pendiente',
}

export const STATUS_TONE = { granted: 'green', denied: 'red', pending: 'amber' }

/** Acepta el estado como texto ('granted') o como objeto ({ status, outdated… }). */
export function statusOf(value) {
  if (!value) return 'pending'
  return typeof value === 'string' ? value : value.status || 'pending'
}

export function formatDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('es-EC', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Niños de una sala sin autorización de imagen (para fotos grupales).
 * Devuelve { loading, total, withoutConsent: [{ id, name, status }] , reload }.
 */
export function useClassroomPhotoCheck(classroomId) {
  const [state, setState] = useState({ loading: false, total: 0, withoutConsent: [], forId: null })
  const load = useCallback(async () => {
    if (!classroomId) return
    setState((s) => ({ ...s, loading: true }))
    try {
      const { data } = await api.get(`/consents/classrooms/${classroomId}/photo-check`)
      setState({ loading: false, total: data.total, withoutConsent: data.withoutConsent || [], forId: classroomId })
    } catch {
      setState({ loading: false, total: 0, withoutConsent: [], forId: classroomId })
    }
  }, [classroomId])
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])
  const current = state.forId === classroomId ? state : { loading: !!classroomId, total: 0, withoutConsent: [] }
  return { ...current, reload: load }
}

/**
 * Estado de imagen de un niño. `allowed` sólo es true con autorización vigente.
 * Devuelve { loading, status, allowed, name }.
 */
export function useImageConsent(childId) {
  const [state, setState] = useState({ forId: null, status: 'pending', name: '' })
  useEffect(() => {
    if (!childId) return undefined
    let cancelled = false
    api
      .get(`/consents/children/${childId}`)
      .then(({ data }) => {
        if (!cancelled) setState({ forId: childId, status: data.consents?.images?.status || 'pending', name: data.child?.name || '' })
      })
      .catch(() => {
        if (!cancelled) setState({ forId: childId, status: 'pending', name: '' })
      })
    return () => {
      cancelled = true
    }
  }, [childId])
  const loading = !!childId && state.forId !== childId
  const status = loading ? 'pending' : state.status
  return { loading, status, allowed: status === 'granted', name: state.name }
}
