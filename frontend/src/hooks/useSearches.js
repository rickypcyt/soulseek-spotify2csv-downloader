import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { request, requestJson } from '../api/client'
import { getSpotifyTrackId } from '../utils/spotify'
import { saveSearchCache } from '../utils/storage'

const SEARCH_BATCH_SIZE = 6
const SEARCH_BATCH_DELAY_MS = 700
const SEARCH_POLL_INTERVAL_MS = 1500

const TERMINAL_STATUSES = new Set(['completed', 'complete', 'finished', 'failed', 'error', 'cancelled', 'canceled'])

export function useSearches({ tracks, url, initialAutoSearchDone = false, initialSearches = [] }) {
  const [searches, setSearches] = useState(initialSearches)
  const [expandedSearches, setExpandedSearches] = useState(new Set())
  const [collapsedSearches, setCollapsedSearches] = useState(new Set())

  const searchesRef = useRef(searches)
  const searchPollInFlight = useRef(false)
  const autoSearchStarted = useRef(initialAutoSearchDone)
  const autoSearchTimeouts = useRef([])

  // Buscar en Soulseek para una pista en particular
  const searchTrack = useCallback(async (i, query) => {
    const q = (query || '').trim()
    if (!q) return

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
  }, [tracks])

  const autoSearchAll = useCallback(() => {
    autoSearchTimeouts.current.forEach(clearTimeout)
    autoSearchTimeouts.current = []
    tracks.forEach((t, i) => {
      if (searchesRef.current.some((search) => search.trackIndex === i && search.cached)) return
      const batch = Math.floor(i / SEARCH_BATCH_SIZE)
      const id = setTimeout(
        () => searchTrack(i, t.search_query),
        batch * SEARCH_BATCH_DELAY_MS
      )
      autoSearchTimeouts.current.push(id)
    })
  }, [tracks, searchTrack])

  // Auto-buscar al cargar una playlist
  useEffect(() => {
    if (tracks.length > 0 && !autoSearchStarted.current) {
      autoSearchStarted.current = true
      autoSearchAll()
    }
  }, [tracks, autoSearchAll])

  // Keep a ref in sync so the polling loop always reads the latest searches.
  useEffect(() => {
    searchesRef.current = searches
  }, [searches])

  // Persist search cache when the playlist or its searches change.
  useEffect(() => {
    if (url && searches.length > 0) saveSearchCache(url, searches)
  }, [url, searches])

  // Keep one stable polling loop for all Soulseek searches.
  useEffect(() => {
    const poll = async () => {
      if (searchPollInFlight.current || searchesRef.current.length === 0) return
      searchPollInFlight.current = true
      const current = searchesRef.current
      const pendingSearches = current.filter(
        (s) => s.searchId && !TERMINAL_STATUSES.has(String(s.status || '').toLowerCase())
      )
      if (pendingSearches.length === 0) {
        searchPollInFlight.current = false
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
              updates[s.searchId] = {
                ...s,
                raw: data,
                pollCount: (s.pollCount || 0) + 1,
                resultsCount: data.resultsCount ?? (Array.isArray(results) ? results.length : 0),
                status: data.status || data.state || s.status,
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
    }

    const iv = setInterval(poll, SEARCH_POLL_INTERVAL_MS)
    return () => clearInterval(iv)
  }, [])

  // Clear all search timers on unmount.
  useEffect(() => {
    return () => {
      autoSearchTimeouts.current.forEach(clearTimeout)
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
    toast.info('Búsqueda cancelada')
  }, [])

  const getTrackSearch = useCallback((i) => {
    // última búsqueda asociada a este índice de pista
    const list = searches.filter((s) => s.trackIndex === i)
    return list[list.length - 1] || null
  }, [searches])

  const resetSearches = useCallback(() => {
    autoSearchTimeouts.current.forEach(clearTimeout)
    autoSearchTimeouts.current = []
    setSearches([])
    setExpandedSearches(new Set())
    setCollapsedSearches(new Set())
    autoSearchStarted.current = false
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
