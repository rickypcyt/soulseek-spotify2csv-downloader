import { useCallback, useEffect, useRef, useState } from 'react'
import { requestJson } from '../api/client'

const LIBRARY_POLL_INTERVAL_MS = 1500

export function useLibraryIndex() {
  const [libraryIndex, setLibraryIndex] = useState(null)

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
      timer = setTimeout(tick, LIBRARY_POLL_INTERVAL_MS)
    }

    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchLibraryIndex])

  return { libraryIndex, fetchLibraryIndex }
}
