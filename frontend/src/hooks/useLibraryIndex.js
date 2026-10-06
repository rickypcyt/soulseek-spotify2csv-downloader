import { useCallback, useEffect, useRef, useState } from 'react'
import { requestJson } from '../api/client'

// Poll rápido con actividad (descargas/búsquedas); lento en reposo.
const FAST_INTERVAL_MS = 2500
const SLOW_INTERVAL_MS = 20000

export function useLibraryIndex({ active = true } = {}) {
  const [libraryIndex, setLibraryIndex] = useState(null)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  const fetchLibraryIndex = useCallback(async () => {
    try {
      const data = await requestJson('/api/library/index')
      setLibraryIndex(data.library_index || {})
    } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer = null

    const tick = async () => {
      if (!cancelled) await fetchLibraryIndex()
      if (cancelled) return
      timer = setTimeout(tick, activeRef.current ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS)
    }

    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchLibraryIndex])

  return { libraryIndex, fetchLibraryIndex }
}
