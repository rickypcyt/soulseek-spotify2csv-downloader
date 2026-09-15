import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { request, requestJson } from '../api/client'
import { getSpotifyTrackId } from '../utils/spotify'
import { saveSearchCache } from '../utils/storage'

const SEARCH_POLL_INTERVAL_MS = 1500
const SEARCH_QUEUE_DELAY_MS = 800

const TERMINAL_STATUSES = new Set(['completed', 'complete', 'finished', 'failed', 'error', 'cancelled', 'canceled'])

export function useSearches({ tracks, url, initialAutoSearchDone = false, initialSearches = [] }) {
  const [searches, setSearches] = useState(initialSearches)
  const [expandedSearches, setExpandedSearches] = useState(new Set())
  const [collapsedSearches, setCollapsedSearches] = useState(new Set())

  const searchesRef = useRef(searches)
  const searchPollInFlight = useRef(false)
  const searchQueueRef = useRef([])
  const searchRunningRef = useRef(false)

  // Sincronizar initialSearches cuando lleguen desde el bootstrap async.
  // useState(initialSearches) solo usa el valor en el primer render; si el
  // bootstrap completa después, necesitamos inyectar las búsquedas cacheadas.
  useEffect(() => {
    if (initialSearches.length > 0 && searchesRef.current.length === 0) {
      setSearches(initialSearches)
    }
  }, [initialSearches])

  // Cola de búsquedas: procesar una a la vez para no saturar slskd.
  const processSearchQueue = useCallback(async () => {
    if (searchRunningRef.current) return
    const next = searchQueueRef.current.shift()
    if (!next) return
    searchRunningRef.current = true
    try {
      await next.fn()
    } finally {
      searchRunningRef.current = false
      if (searchQueueRef.current.length > 0) {
        setTimeout(processSearchQueue, SEARCH_QUEUE_DELAY_MS)
      }
    }
  }, [])

  const enqueueSearch = useCallback((fn) => {
    searchQueueRef.current.push({ fn })
    processSearchQueue()
  }, [processSearchQueue])

  // Buscar en Soulseek para una pista en particular
  const searchTrack = useCallback(async (i, query) => {
    const q = (query || '').trim()
    if (!q) return

    enqueueSearch(async () => {
      // Reemplazar búsqueda anterior de la misma pista
      setSearches((prev) => prev.filter((s) => s.trackIndex !== i))

      try {
        const r = await request('/api/search_soulseek', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        })
        const data = await r.json()
        if (!r.ok) {
          toast.error(data.error || 'Error')
          return
        }
        setSearches((prev) => [
          ...prev,
          {
            searchId: data.searchId,
            trackIndex: i,
            trackKey: getSpotifyTrackId(tracks[i]?.spotify_url),
            query: data.query,
            resultsCount: data.resultsCount,
            status: data.status || 'buscando',
            pollCount: 0,
            raw: null,
          },
        ])
      } catch (err) {
        toast.error('Error: ' + err.message)
      }
    })
  }, [tracks, enqueueSearch])

  const autoSearchAll = useCallback(() => {
    searchQueueRef.current = []
    tracks.forEach((t, i) => {
      if (searchesRef.current.some((search) => search.trackIndex === i && search.cached)) return
      enqueueSearch(async () => {
        setSearches((prev) => prev.filter((s) => s.trackIndex !== i))
        try {
          const r = await request('/api/search_soulseek', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: t.search_query }),
          })
          const data = await r.json()
          if (!r.ok) return
          setSearches((prev) => [
            ...prev,
            {
              searchId: data.searchId,
              trackIndex: i,
              trackKey: getSpotifyTrackId(tracks[i]?.spotify_url),
              query: data.query,
              resultsCount: data.resultsCount,
              status: data.status || 'buscando',
              pollCount: 0,
              raw: null,
            },
          ])
        } catch {}
      })
    })
  }, [tracks, enqueueSearch])

  // Keep a ref in sync so the polling loop always reads the latest searches.
  useEffect(() => {
    searchesRef.current = searches
  }, [searches])

  // Persist search cache when the playlist or its searches change.
  useEffect(() => {
    if (url && searches.length > 0) saveSearchCache(url, searches)
  }, [url, searches])

  // Keep one stable polling loop for all Soulseek searches.
  // Auto-reschedule: rápido cuando hay pendientes, lento en reposo.
  useEffect(() => {
    let cancelled = false
    let timer = null

    const poll = async () => {
      if (searchPollInFlight.current || searchesRef.current.length === 0) {
        timer = setTimeout(poll, SEARCH_POLL_INTERVAL_MS)
        return
      }
      searchPollInFlight.current = true
      const current = searchesRef.current
      const pendingSearches = current.filter(
        (s) => s.searchId && !s.raw?.isComplete && !TERMINAL_STATUSES.has(String(s.status || '').toLowerCase())
      )
      if (pendingSearches.length === 0) {
        searchPollInFlight.current = false
        // Sin pendientes: re-check ligero para detectar nuevas búsquedas.
        timer = setTimeout(poll, SEARCH_POLL_INTERVAL_MS * 4)
        return
      }
      const updates = {}
      try {
        await Promise.all(
          pendingSearches.map(async (s) => {
            try {
              const r = await request(`/api/search_soulseek/${s.searchId}`)
              const data = await r.json()
              const results = data.results || []
              const nextStatus = data.isComplete ? 'completed' : data.status || data.state || s.status
              const wasActive = !s.raw?.isComplete && !TERMINAL_STATUSES.has(String(s.status || '').toLowerCase())
              const isCompleted = data.isComplete || ['completed', 'complete', 'finished'].includes(String(nextStatus).toLowerCase())
              if (wasActive && isCompleted) {
                toast.success(`Búsqueda completada: ${s.query} · ${data.resultsCount ?? results.length} resultado(s)`)
              }
              updates[s.searchId] = {
                ...s,
                raw: data,
                pollCount: (s.pollCount || 0) + 1,
                resultsCount: data.resultsCount ?? (Array.isArray(results) ? results.length : 0),
                status: nextStatus,
              }
            } catch {}
          })
        )
        if (Object.keys(updates).length > 0) {
          setSearches((prev) => prev.map((p) => (updates[p.searchId] ? updates[p.searchId] : p)))
        }
      } finally {
        searchPollInFlight.current = false
      }
      timer = setTimeout(poll, SEARCH_POLL_INTERVAL_MS)
    }

    timer = setTimeout(poll, SEARCH_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Limpiar cola de búsquedas al desmontar.
  useEffect(() => {
    return () => {
      searchQueueRef.current = []
      searchRunningRef.current = false
    }
  }, [])

  const toggleExpandedSearch = useCallback((searchId) =>
    setExpandedSearches((prev) => {
      const next = new Set(prev)
      if (next.has(searchId)) next.delete(searchId)
      else next.add(searchId)
      return next
    })
  , [])

  const toggleCollapsedSearch = useCallback((searchId, isOpen) =>
    setCollapsedSearches((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(searchId)
      else next.add(searchId)
      return next
    })
  , [])

  const collapseTrackResults = useCallback((trackIndex) => {
    const search = searchesRef.current.find((item) => item.trackIndex === trackIndex)
    if (!search?.searchId) return
    setCollapsedSearches((prev) => {
      if (prev.has(search.searchId)) return prev
      const next = new Set(prev)
      next.add(search.searchId)
      return next
    })
  }, [])

  const refreshSearch = useCallback(async (searchId) => {
    const search = searchesRef.current.find((item) => item.searchId === searchId)
    if (!search) return
    try {
      const data = await requestJson(`/api/search_soulseek/${searchId}`)
      const results = data.results || []
      setSearches((prev) => prev.map((item) => item.searchId === searchId
        ? { ...item, raw: data, pollCount: (item.pollCount || 0) + 1, resultsCount: data.resultsCount ?? results.length, status: data.status || data.state || item.status }
        : item
      ))
      toast.info('Resultados actualizados')
    } catch (err) {
      toast.error('No se pudieron refrescar los resultados: ' + err.message)
    }
  }, [])

  const cancelSearch = useCallback((searchId) => {
    setSearches((prev) => prev.filter((item) => item.searchId !== searchId))
    // Avisar al backend para que slskd deje de buscar y libere el slot activo.
    if (searchId) {
      request(`/api/search_soulseek/${searchId}`, { method: 'DELETE' }).catch(() => {})
    }
    toast.info('Búsqueda cancelada')
  }, [])

  const getTrackSearch = useCallback((i) => {
    // última búsqueda asociada a este índice de pista
    const list = searches.filter((s) => s.trackIndex === i)
    return list[list.length - 1] || null
  }, [searches])

  const resetSearches = useCallback(() => {
    searchQueueRef.current = []
    searchRunningRef.current = false
    setSearches([])
    setExpandedSearches(new Set())
    setCollapsedSearches(new Set())
  }, [])

  return {
    searches,
    setSearches,
    searchTrack,
    autoSearchAll,
    refreshSearch,
    cancelSearch,
    getTrackSearch,
    expandedSearches,
    collapsedSearches,
    toggleExpandedSearch,
    toggleCollapsedSearch,
    collapseTrackResults,
    resetSearches,
  }
}
