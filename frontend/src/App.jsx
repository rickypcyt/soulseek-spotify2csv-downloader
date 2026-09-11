import { useCallback, useEffect, useRef, useState } from 'react'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { request, requestJson } from './api/client'
import AppFooter from './components/AppFooter'
import AppNavbar from './components/AppNavbar'
import ConfigurationStatus from './components/ConfigurationStatus'
import LibraryPanel from './components/LibraryPanel'
import LogsPanel from './components/LogsPanel'
import PlaylistPicker from './components/PlaylistPicker'
import RecommendConfig from './components/RecommendConfig'
import SettingsPanel from './components/SettingsPanel'
import SourceInput from './components/SourceInput'
import TemporalesPanel from './components/TemporalesPanel'
import TrackList from './components/TrackList'
import { FONT_BODY, isCompletedTransfer, isLibraryFile } from './constants'
import { pickBest, rankResults } from './utils/resultPicker'

const HISTORY_KEY = 'spotifyUrlHistory'
const OUTPUT_FOLDER_PREFERENCES_KEY = 'soulseekOutputFolderPreferences'
const SEARCH_PREFERENCES_KEY = 'soulseekSearchPreferences'

const SEARCH_BATCH_SIZE = 6
const SEARCH_BATCH_DELAY_MS = 700
const SEARCH_POLL_INTERVAL_MS = 1500

function normalizeHistory(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const item = typeof entry === 'string' ? { url: entry } : entry
      if (!item?.url) return null
      return {
        url: item.url,
        name: item.name || item.title || getHistoryLabel(item.url, index),
      }
    })
    .filter(Boolean)
}

function loadHistory() {
  try {
    return normalizeHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'))
  } catch {
    return []
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(normalizeHistory(history).slice(0, 20)))
}

function loadSearchPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(SEARCH_PREFERENCES_KEY) || 'null')
    return {
      pickMode: ['quality', 'speed', 'longest', 'balanced'].includes(saved?.pickMode)
        ? saved.pickMode
        : 'quality',
      formatPref: ['any', 'flac', 'mp3', 'ogg', 'm4a'].includes(saved?.formatPref)
        ? saved.formatPref
        : 'any',
    }
  } catch {
    return { pickMode: 'quality', formatPref: 'any' }
  }
}

function saveSearchPreferences(pickMode, formatPref) {
  try {
    localStorage.setItem(SEARCH_PREFERENCES_KEY, JSON.stringify({ pickMode, formatPref }))
  } catch {}
}

function getHistoryLabel(url, index) {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const id = parts.at(-1)
    return id ? `Playlist ${index + 1} · ${id}` : `Playlist guardada ${index + 1}`
  } catch {
    return `Playlist guardada ${index + 1}`
  }
}

function loadLastPlaylist() {
  try {
    return JSON.parse(localStorage.getItem('lastPlaylist') || 'null') || {}
  } catch {
    return {}
  }
}

function loadOutputFolderPreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem(OUTPUT_FOLDER_PREFERENCES_KEY) || '{}')
    return preferences && typeof preferences === 'object' ? preferences : {}
  } catch {
    return {}
  }
}

function getOutputFolderPreference(url) {
  if (!url) return undefined
  const preferences = loadOutputFolderPreferences()
  return Object.prototype.hasOwnProperty.call(preferences, url) ? preferences[url] : undefined
}

const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function searchCacheKey(url) {
  return `soulseekSearchCache:${encodeURIComponent(url || '')}`
}

function loadSearchCache(url, tracks) {
  if (!url) return []
  try {
    const cached = JSON.parse(localStorage.getItem(searchCacheKey(url)) || 'null')
    if (!cached || Date.now() - cached.savedAt > SEARCH_CACHE_TTL_MS) return []
    return (cached.searches || [])
      .map((search) => {
        const trackIndex = tracks.findIndex((track) =>
          (search.trackKey && getSpotifyTrackId(track.spotify_url) === search.trackKey) ||
          track.search_query === search.query
        )
        return trackIndex < 0
          ? null
          : {
              ...search,
              trackIndex,
              searchId: null,
              status: 'completed',
              cached: true,
            }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function saveSearchCache(url, searches) {
  if (!url) return
  try {
    const cacheable = searches
      .filter((search) => search.raw)
      .map((search) => ({
        ...search,
        raw: {
          ...search.raw,
          results: Array.isArray(search.raw.results) ? search.raw.results.slice(0, 100) : [],
        },
      }))
    localStorage.setItem(searchCacheKey(url), JSON.stringify({ savedAt: Date.now(), searches: cacheable }))
  } catch {}
}

function getSpotifyTrackId(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/track\/([a-zA-Z0-9]+)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matchesLibraryFile(track, file) {
  const title = normalizeSearchText(track.track_name)
  const path = normalizeSearchText(file.path)
  return Boolean(title && path.includes(title))
}

function trackIdentity(track) {
  return getSpotifyTrackId(track.spotify_url)
    || `${normalizeSearchText(track.artists)}:${normalizeSearchText(track.track_name)}`
}

const TAB_PATHS = {
  main: '/',
  settings: '/settings',
  logs: '/logs',
  library: '/library',
}

function tabFromPath(pathname) {
  const match = Object.entries(TAB_PATHS).find(([, path]) => path === pathname)
  return match ? match[0] : 'main'
}

function App() {
  const [initialPlaylist] = useState(loadLastPlaylist)
  const [url, setUrl] = useState(() => initialPlaylist.url || '')
  const [outputFolderName, setOutputFolderName] = useState(() => getOutputFolderPreference(initialPlaylist.url) ?? initialPlaylist.outputFolderName ?? '')
  const [tracks, setTracks] = useState(() => initialPlaylist.tracks || [])
  const [loading, setLoading] = useState(false)
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname)
  const activeTab = tabFromPath(currentPath)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const [backendOnline, setBackendOnline] = useState(true)
  const [searches, setSearches] = useState(() =>
    loadSearchCache(initialPlaylist.url || '', initialPlaylist.tracks || [])
  )
  const [expandedSearches, setExpandedSearches] = useState(new Set())
  const [collapsedSearches, setCollapsedSearches] = useState(new Set())
  const [urlHistory, setUrlHistory] = useState(loadHistory)
  const [activePreview, setActivePreview] = useState(null)
  const [downloads, setDownloads] = useState({})
  const [manualDownloadedTracks, setManualDownloadedTracks] = useState(() => new Set())
  const [selected, setSelected] = useState(new Set())
  const [searchPreferences] = useState(loadSearchPreferences)
  const [pickMode, setPickMode] = useState(() => searchPreferences.pickMode)
  const [formatPref, setFormatPref] = useState(() => searchPreferences.formatPref)
  const [config, setConfig] = useState({})
  const [spotifyAuth, setSpotifyAuth] = useState({ status: 'not_configured' })
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([])
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [diagnostics, setDiagnostics] = useState(null)
  const [previewPage, setPreviewPage] = useState(1)
  const [newLibraryFolderName, setNewLibraryFolderName] = useState('')
  const [dragOverLibraryFolder, setDragOverLibraryFolder] = useState(null)
  const [completedTransfersOpen, setCompletedTransfersOpen] = useState(false)
  const previewTimer = useRef(null)
  const downloadTimers = useRef({})
  const downloadToastIds = useRef({})
  const downloadTaskSequence = useRef(0)
  const logRef = useRef(null)
  const autoSearchStarted = useRef((initialPlaylist.tracks || []).length > 0)
  const autoSearchTimeouts = useRef([])
  const searchesRef = useRef([])
  const searchPollInFlight = useRef(false)

  const navigate = (path) => {
    window.history.pushState({}, '', path)
    setCurrentPath(path)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const fetchLogs = async () => {
    try {
      setLogs(await requestJson('/api/logs'))
      setBackendOnline(true)
    } catch {
      setBackendOnline(false)
    }
  }

  const fetchDiagnostics = async () => {
    try {
      setDiagnostics(await requestJson('/api/diagnostics'))
    } catch {}
  }

  const fetchSpotifyAuth = async () => {
    try {
      setSpotifyAuth(await requestJson('/api/spotify/auth/status'))
    } catch {}
  }

  const startSpotifyAuth = async () => {
    try {
      setSpotifyAuth(await requestJson('/api/spotify/auth/start', { method: 'POST' }))
      toast.info('Se abrió Spotify en el navegador. Completa la autorización y vuelve aquí.')
    } catch (err) {
      toast.error('No se pudo iniciar Spotify: ' + err.message)
    }
  }

  const loadSpotifyPlaylists = async () => {
    try {
      const data = await requestJson('/api/spotify/playlists')
      setSpotifyPlaylists(data.playlists || [])
      setPlaylistPickerOpen(true)
    } catch (err) {
      toast.error('No se pudieron cargar tus playlists: ' + err.message)
    }
  }

  const deleteItem = async (path, dir) => {
    try {
      const response = await request('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dir }),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || 'No se pudo borrar el archivo')
      await fetchDiagnostics()
      toast.success('Archivo eliminado')
    } catch (err) {
      toast.error(`No se pudo borrar: ${err.message}`)
    }
  }

  const cleanupAll = async () => {
    if (!confirm('¿Borrar todos los temporales e incompletos?')) return
    try {
      await request('/api/cleanup', { method: 'POST' })
      fetchDiagnostics()
      toast.success('Temporales e incompletos eliminados')
    } catch (err) {
      toast.error('No se pudieron limpiar los temporales: ' + err.message)
    }
  }

  const cancelTransfer = async (username, filename) => {
    try {
      const response = await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, filename }),
      })
      if (!response.ok) throw new Error(`slskd ${response.status}`)
      await fetchDiagnostics()
      toast.success(`Transferencia cancelada: ${filename}`)
    } catch (err) {
      toast.error(`No se pudo cancelar la transferencia: ${err.message}`)
    }
  }

  useEffect(() => {
    const initialFetch = setTimeout(fetchLogs, 0)
    const iv = setInterval(fetchLogs, 5000)
    return () => {
      clearTimeout(initialFetch)
      clearInterval(iv)
    }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // Guardar playlist actual cuando cambia
  useEffect(() => {
    if (url && tracks.length > 0) {
      localStorage.setItem('lastPlaylist', JSON.stringify({ url, tracks, outputFolderName }))
    }
  }, [url, tracks, outputFolderName])

  useEffect(() => {
    if (!url) return
    const preferences = loadOutputFolderPreferences()
    preferences[url] = outputFolderName
    localStorage.setItem(OUTPUT_FOLDER_PREFERENCES_KEY, JSON.stringify(preferences))
  }, [url, outputFolderName])

  useEffect(() => {
    if (!url) return undefined
    let cancelled = false
    requestJson(`/api/playlist/status?playlist_key=${encodeURIComponent(url)}`)
      .then((data) => {
        if (cancelled) return
        const statuses = data.statuses || {}
        setManualDownloadedTracks(new Set(Object.entries(statuses).filter(([, downloaded]) => downloaded).map(([trackKey]) => trackKey)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => {
    if (url && searches.length > 0) saveSearchCache(url, searches)
  }, [url, searches])

  useEffect(() => {
    saveSearchPreferences(pickMode, formatPref)
  }, [pickMode, formatPref])

  // Cargar carpeta de descargas
  useEffect(() => {
    requestJson('/api/config')
      .then((data) => {
        setConfig(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const initialFetch = setTimeout(fetchSpotifyAuth, 0)
    const iv = setInterval(fetchSpotifyAuth, 3000)
    return () => {
      clearTimeout(initialFetch)
      clearInterval(iv)
    }
  }, [])

  // Cargar diagnósticos al inicio
  useEffect(() => {
    const initialFetch = setTimeout(fetchDiagnostics, 0)
    const iv = setInterval(fetchDiagnostics, 10000)
    return () => {
      clearTimeout(initialFetch)
      clearInterval(iv)
    }
  }, [])

  useEffect(() => {
    return () => {
      autoSearchTimeouts.current.forEach(clearTimeout)
      Object.values(downloadTimers.current).forEach(clearInterval)
    }
  }, [])

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      const data = { ...config }
      for (const secret of ['spotify_client_secret', 'slskd_api_key', 'soulseek_password']) {
        if (!data[secret]) delete data[secret]
      }
      const saved = await requestJson('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setConfig(saved)
      toast.success('Configuración guardada')
    } catch (err) {
      toast.error('Error al guardar configuración: ' + err.message)
    } finally {
      setSavingConfig(false)
    }
  }

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

  // Keep one stable polling loop for all Soulseek searches.
  useEffect(() => {
    searchesRef.current = searches
  }, [searches])

  useEffect(() => {
    const poll = async () => {
      if (searchPollInFlight.current || searchesRef.current.length === 0) return
      searchPollInFlight.current = true
      const current = searchesRef.current
      const terminalStatuses = new Set(['completed', 'complete', 'finished', 'failed', 'error', 'cancelled', 'canceled'])
      const pendingSearches = current.filter(
        (s) => s.searchId && !terminalStatuses.has(String(s.status || '').toLowerCase())
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

  const loadPlaylist = async (sourceUrl) => {
    const targetUrl = (sourceUrl || '').trim()
    if (!targetUrl || loading) return
    const savedOutputFolder = getOutputFolderPreference(targetUrl)
    setUrl(targetUrl)
    setOutputFolderName(savedOutputFolder ?? '')
    autoSearchTimeouts.current.forEach(clearTimeout)
    autoSearchTimeouts.current = []
    setLoading(true)
    setError('')
    setTracks([])
    setSearches([])
    setExpandedSearches(new Set())
    setCollapsedSearches(new Set())
    setDownloads({})
    Object.values(downloadTimers.current).forEach(clearInterval)
    downloadTimers.current = {}
    autoSearchStarted.current = false
    try {
      const r = await request('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      const loaded = data.tracks || []
      if (savedOutputFolder === undefined) setOutputFolderName(data.playlist_name || '')
      const cachedSearches = loadSearchCache(targetUrl, loaded)
      searchesRef.current = cachedSearches
      setSearches(cachedSearches)
      setTracks(loaded)
      setSelected(new Set(loaded.map((_, i) => i)))
      if (data.source !== 'soulseek') {
        const historyItem = {
          url: targetUrl,
          name: data.playlist_name || getHistoryLabel(targetUrl, 0),
        }
        const next = [historyItem, ...urlHistory.filter((item) => item.url !== targetUrl)]
        setUrlHistory(next)
        saveHistory(next)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const preview = (event) => {
    event.preventDefault()
    loadPlaylist(url)
  }

  const copy = (q) =>
    navigator.clipboard.writeText(q).then(() => toast.success('Copiado: ' + q)).catch(() => toast.error('No se pudo copiar'))

  const updateQuery = (i, newQuery) => {
    setTracks((prev) =>
      prev.map((track, index) =>
        index === i ? { ...track, search_query: newQuery } : track
      )
    )
  }

  const stopPreviewTimer = () => {
    if (previewTimer.current) {
      clearInterval(previewTimer.current)
      previewTimer.current = null
    }
  }

  const stopDownloadTimer = (i) => {
    if (downloadTimers.current[i]) {
      clearInterval(downloadTimers.current[i])
      delete downloadTimers.current[i]
    }
  }

  const getTrackDownloads = (i) => {
    const value = downloads[i]
    if (Array.isArray(value)) return value
    return value ? [value] : []
  }

  const updateDownloadTask = (i, taskId, patch) =>
    setDownloads((prev) => {
      const current = Array.isArray(prev[i]) ? prev[i] : prev[i] ? [prev[i]] : []
      return {
        ...prev,
        [i]: current.map((task) => task.id === taskId ? { ...task, ...patch } : task),
      }
    })

  const enqueueDownload = async (i, res) => {
    if (!res) return
    const downloadFolderName = outputFolderName.trim()
    const taskId = `${i}-${downloadTaskSequence.current++}`
    const task = {
      id: taskId,
      username: res.username,
      filename: res.filename,
      size: res.size,
      folder_name: downloadFolderName,
      state: 'encolando',
      percent: 0,
      path: null,
      error: null,
    }
    setDownloads((prev) => {
      const current = Array.isArray(prev[i]) ? prev[i] : prev[i] ? [prev[i]] : []
      return { ...prev, [i]: [...current, task] }
    })
    const downloadToastId = toast.loading(`Descargando ${res.filename}`)
    downloadToastIds.current[taskId] = downloadToastId
    try {
      const r = await request('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: res.username,
          filename: res.filename,
          size: res.size,
          folder_name: downloadFolderName,
          track_key: getSpotifyTrackId(tracks[i]?.spotify_url),
          track_name: tracks[i]?.track_name,
          artists: tracks[i]?.artists,
        }),
      })
      const data = await r.json()
      if (data.error) {
        updateDownloadTask(i, taskId, { state: 'error', error: data.error })
        toast.update(downloadToastId, { render: `Error de descarga: ${data.error}`, type: 'error', isLoading: false, autoClose: 5000 })
        delete downloadToastIds.current[taskId]
        return
      }
      updateDownloadTask(i, taskId, { state: 'descargando' })
      downloadTimers.current[taskId] = setInterval(async () => {
        try {
          const st = await request(
            `/api/download/status?username=${encodeURIComponent(res.username)}&filename=${encodeURIComponent(res.filename)}&folder_name=${encodeURIComponent(downloadFolderName)}`
          )
          const d = await st.json()
          const downloadState = String(d.state || '').toLowerCase()
          const percentComplete = Number(d.percentComplete || 0)
          const isCancelled = downloadState.includes('cancelled') || downloadState.includes('canceled')
          const isComplete = !isCancelled && (Boolean(d.path) || percentComplete >= 100 || ['completed', 'complete', 'succeeded', 'finished'].some((state) => downloadState.includes(state)))
          if (isComplete) {
            stopDownloadTimer(taskId)
            updateDownloadTask(i, taskId, { state: 'completado', path: d.path || null, percent: 100 })
            collapseTrackResults(i)
            toast.update(downloadToastId, { render: `Descarga completada: ${res.filename}`, type: 'success', isLoading: false, autoClose: 3500 })
            delete downloadToastIds.current[taskId]
            fetchDiagnostics()
          } else if (isCancelled || downloadState === 'error' || downloadState === 'errored' || downloadState === 'cancelled') {
            stopDownloadTimer(taskId)
            const error = d.error || d.state
            updateDownloadTask(i, taskId, isCancelled ? { state: 'cancelado', error } : { state: 'error', error })
            toast.update(downloadToastId, {
              render: isCancelled ? `Descarga cancelada: ${res.filename}` : `Error de descarga: ${error}`,
              type: isCancelled ? 'info' : 'error',
              isLoading: false,
              autoClose: 4000,
            })
            delete downloadToastIds.current[taskId]
          } else {
            updateDownloadTask(i, taskId, { percent: d.percentComplete || 0 })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      updateDownloadTask(i, taskId, { state: 'error', error: err.message })
      toast.update(downloadToastId, { render: `Error de descarga: ${err.message}`, type: 'error', isLoading: false, autoClose: 5000 })
      delete downloadToastIds.current[taskId]
    }
  }

  const cancelTrackDownload = async (taskId) => {
    const task = Object.values(downloads).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).find((item) => item.id === taskId)
    stopDownloadTimer(taskId)
    if (!task) return
    const trackIndex = Number(taskId.split('-')[0])
    updateDownloadTask(trackIndex, taskId, { state: 'cancelado', error: 'Cancelado por el usuario' })
    const downloadToastId = downloadToastIds.current[taskId]
    if (downloadToastId) {
      toast.update(downloadToastId, { render: `Cancelando descarga: ${task.filename}`, type: 'info', isLoading: false, autoClose: 2500 })
      delete downloadToastIds.current[taskId]
    }
    try {
      const response = await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: task.username, filename: task.filename }),
      })
      if (!response.ok) throw new Error(`slskd ${response.status}`)
      toast.success(`Descarga cancelada: ${task.filename}`)
    } catch (err) {
      toast.error(`No se pudo cancelar la descarga: ${err.message}`)
    }
  }

  const toggleSelect = (i) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const selectAll = (checked) =>
    setSelected(checked ? new Set(tracks.map((_, i) => i)) : new Set())

  const downloadSelected = () => {
    const list = tracks.map((_, i) => i).filter((i) => selected.has(i))
    list.forEach((i, n) => {
      const s = getTrackSearch(i)
      const results = rankResults(s?.raw?.results || [], s?.query, pickMode, formatPref)
      const best = pickBest(results, pickMode, formatPref)
      if (best) setTimeout(() => enqueueDownload(i, best), n * 400)
    })
  }

  const cancelPreview = async (res) => {
    stopPreviewTimer()
    setActivePreview(null)
    try {
      await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: res.username, filename: res.filename }),
      })
    } catch {}
  }

  const storedFileUrl = (dir, path) =>
    `/api/file/download?dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`

  const storedFileStreamUrl = (dir, path) =>
    `/api/file/stream?dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`

  const refreshLibrary = () => fetchDiagnostics()

  const savePreviewToLibrary = async () => {
    if (!activePreview?.path || activePreview.savedPath) return
    if (!outputFolderName.trim()) {
      toast.info('Escribe una carpeta de playlist para guardar el preview')
      return
    }
    try {
      const data = await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: activePreview.path,
          folder_name: outputFolderName,
          track_key: activePreview.trackKey,
          track_name: activePreview.trackName,
          artists: activePreview.artists,
        }),
      })
      setActivePreview((current) => ({ ...current, savedPath: data.path }))
      setOutputFolderName(data.folder || outputFolderName)
      fetchDiagnostics()
      toast.success('Preview guardado en la biblioteca')
    } catch (err) {
      toast.error('No se pudo guardar el preview: ' + err.message)
    }
  }

  const discardActivePreview = async () => {
    if (!activePreview?.path || activePreview.savedPath) return
    try {
      await requestJson('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activePreview.path, dir: 'previews' }),
      })
      await fetchDiagnostics()
      setActivePreview(null)
      toast.success('Preview descartado y eliminado')
    } catch (err) {
      toast.error('No se pudo descartar el preview: ' + err.message)
    }
  }

  const saveTemporaryPreviewToLibrary = async (path) => {
    if (!outputFolderName.trim()) {
      toast.info('Escribe una carpeta de playlist para mover el preview')
      return
    }
    try {
      await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folder_name: outputFolderName }),
      })
      await fetchDiagnostics()
      toast.success('Preview movido a la biblioteca')
    } catch (err) {
      toast.error('No se pudo mover a la biblioteca: ' + err.message)
    }
  }

  const createLibraryFolder = async () => {
    const folderName = newLibraryFolderName.trim()
    if (!folderName) return
    try {
      await requestJson('/api/library/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_name: folderName }),
      })
      setNewLibraryFolderName('')
      await fetchDiagnostics()
      toast.success(`Playlist creada: ${folderName}`)
    } catch (err) {
      toast.error('No se pudo crear la carpeta: ' + err.message)
    }
  }

  const movePreviewToFolder = async (path, targetFolder) => {
    try {
      await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folder_name: targetFolder }),
      })
      await fetchDiagnostics()
      toast.success(`Preview movido a ${targetFolder}`)
    } catch (err) {
      toast.error('No se pudo mover el preview al playlist: ' + err.message)
    }
  }

  const moveLibraryFile = async (source, targetFolder) => {
    if (source.dir === 'previews') {
      await movePreviewToFolder(source.path, targetFolder)
      return
    }
    try {
      await requestJson('/api/library/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_dir: source.dir,
          source_path: source.path,
          target_folder: targetFolder,
        }),
      })
      await fetchDiagnostics()
      toast.success(`Archivo movido${targetFolder ? ` a ${targetFolder}` : ''}`)
    } catch (err) {
      toast.error('No se pudo mover el archivo: ' + err.message)
    }
  }

  const startPreview = async (res, trackIndex) => {
    if (activePreview && !activePreview.error && activePreview.state !== 'completado') {
      return
    }
    stopPreviewTimer()
    setActivePreview({
      username: res.username,
      filename: res.filename,
      trackKey: getSpotifyTrackId(tracks[trackIndex]?.spotify_url),
      trackName: tracks[trackIndex]?.track_name,
      artists: tracks[trackIndex]?.artists,
      size: res.size,
      state: 'encolando',
      percent: 0,
      path: null,
      error: null,
    })
    try {
      const r = await request('/api/preview_audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: res.username,
          filename: res.filename,
          trackKey: getSpotifyTrackId(tracks[trackIndex]?.spotify_url),
          trackName: tracks[trackIndex]?.track_name,
          artists: tracks[trackIndex]?.artists,
          size: res.size,
        }),
      })
      const data = await r.json()
      if (data.error) {
        setActivePreview({
          username: res.username,
          filename: res.filename,
          trackKey: getSpotifyTrackId(tracks[trackIndex]?.spotify_url),
          trackName: tracks[trackIndex]?.track_name,
          artists: tracks[trackIndex]?.artists,
          size: res.size,
          state: 'error',
          percent: 0,
          path: null,
          error: data.error,
        })
        return
      }
      setActivePreview({
        username: res.username,
        filename: res.filename,
        size: res.size,
        state: 'descargando',
        percent: 0,
        path: null,
        error: null,
      })
      previewTimer.current = setInterval(async () => {
        try {
          const st = await request(
            `/api/preview/status?username=${encodeURIComponent(res.username)}&filename=${encodeURIComponent(res.filename)}`
          )
          const d = await st.json()
          const percent = d.percentComplete ?? 0
          if (d.path) {
            stopPreviewTimer()
            setActivePreview({
              username: res.username,
              filename: res.filename,
              trackKey: getSpotifyTrackId(tracks[trackIndex]?.spotify_url),
              trackName: tracks[trackIndex]?.track_name,
              artists: tracks[trackIndex]?.artists,
              size: res.size,
              state: 'completado',
              percent,
              path: d.path,
              error: null,
            })
          } else if (d.state === 'error' || d.state === 'Errored' || d.state === 'Cancelled') {
            stopPreviewTimer()
            setActivePreview({
              username: res.username,
              filename: res.filename,
              size: res.size,
              state: 'error',
              percent,
              path: null,
              error: d.error || d.state,
            })
          } else {
            setActivePreview({
              username: res.username,
              filename: res.filename,
              size: res.size,
              state: 'descargando',
              percent,
              path: null,
              error: null,
            })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      setActivePreview({
        username: res.username,
        filename: res.filename,
        size: res.size,
        state: 'error',
        path: null,
        error: err.message,
      })
    }
  }

  const toggleExpandedSearch = (searchId) =>
    setExpandedSearches((prev) => {
      const next = new Set(prev)
      if (next.has(searchId)) next.delete(searchId)
      else next.add(searchId)
      return next
    })

  const toggleCollapsedSearch = (searchId, isOpen) =>
    setCollapsedSearches((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(searchId)
      else next.add(searchId)
      return next
    })

  const collapseTrackResults = (trackIndex) => {
    const search = searchesRef.current.find((item) => item.trackIndex === trackIndex)
    if (!search?.searchId) return
    setCollapsedSearches((prev) => {
      if (prev.has(search.searchId)) return prev
      const next = new Set(prev)
      next.add(search.searchId)
      return next
    })
  }

  const refreshSearch = async (searchId) => {
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
  }

  const cancelSearch = (searchId) => {
    setSearches((prev) => prev.filter((item) => item.searchId !== searchId))
    toast.info('Búsqueda cancelada')
  }

  const getTrackSearch = (i) => {
    // última búsqueda asociada a este índice de pista
    const list = searches.filter((s) => s.trackIndex === i)
    return list[list.length - 1] || null
  }

  const isTrackDownloaded = (track) => {
    const trackKey = getSpotifyTrackId(track.spotify_url)
    if (trackKey && diagnostics?.library_index?.[trackKey]) return true
    return (diagnostics?.downloads || [])
      .filter(isLibraryFile)
      .some((file) => matchesLibraryFile(track, file))
  }

  const toggleManualDownloaded = async (track, trackIndex) => {
    if (!url) return
    const key = trackIdentity(track)
    const wasManual = manualDownloadedTracks.has(key)
    const downloaded = !wasManual
    if (downloaded) collapseTrackResults(trackIndex)
    setManualDownloadedTracks((current) => {
      const next = new Set(current)
      if (downloaded) next.add(key)
      else next.delete(key)
      return next
    })
    try {
      await requestJson('/api/playlist/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist_key: url, track_key: key, downloaded }),
      })
      toast[downloaded ? 'success' : 'info'](downloaded ? `Marcada como descargada: ${track.track_name}` : `Marcada como pendiente: ${track.track_name}`)
    } catch (err) {
      setManualDownloadedTracks((current) => {
        const next = new Set(current)
        if (wasManual) next.add(key)
        else next.delete(key)
        return next
      })
      toast.error('No se pudo guardar el estado de la canción: ' + err.message)
    }
  }

  const selectHistory = (selectedUrl) => {
    const saved = urlHistory.find((item) => item.url === selectedUrl)
    if (saved) {
      setUrl(saved.url)
      setOutputFolderName(getOutputFolderPreference(saved.url) ?? saved.name)
    }
  }

  const clearHistory = () => {
    setUrlHistory([])
    saveHistory([])
  }

  // ---- derived values for the library / temporales panels ----
  const libraryFiles = (diagnostics?.downloads || [])
    .filter(isLibraryFile)
    .sort((a, b) => a.path.localeCompare(b.path))
  const libraryFolders = diagnostics?.download_directories || []
  const previewFiles = diagnostics?.previews || []
  const previewPages = Math.max(1, Math.ceil(previewFiles.length / 12))
  const currentPreviewPage = Math.min(previewPage, previewPages)
  const visiblePreviewFiles = previewFiles.slice((currentPreviewPage - 1) * 12, currentPreviewPage * 12)
  const downloadEntries = Object.values(downloads).flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
  const queuedDownloadCount = downloadEntries.filter((download) => download.state === 'encolando').length
  const activeDownloadCount = downloadEntries.filter((download) => download.state === 'descargando').length
  const pendingDownloadCount = queuedDownloadCount + activeDownloadCount
  const transfers = diagnostics?.transfers || []
  const activeTransfers = transfers.filter((transfer) => !isCompletedTransfer(transfer))
  const completedTransfers = transfers.filter(isCompletedTransfer)

  return (
    <div
      className="min-h-screen bg-[#10121A] text-[#E9EAF0]"
      style={{ fontFamily: FONT_BODY }}
    >
      <div className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-10 sm:py-10">
        <AppNavbar
          activeTab={activeTab}
          navigate={navigate}
          libraryCount={libraryFiles.length}
          pendingDownloadCount={pendingDownloadCount}
          queuedDownloadCount={queuedDownloadCount}
          activeDownloadCount={activeDownloadCount}
        />

        {activeTab === 'main' && (
          <>
            <SourceInput
              url={url}
              onUrlChange={setUrl}
              loading={loading}
              onSubmit={preview}
              onLoadSpotifyPlaylists={loadSpotifyPlaylists}
              spotifyAuthStatus={spotifyAuth.status}
              outputFolderName={outputFolderName}
              onOutputFolderChange={setOutputFolderName}
              urlHistory={urlHistory}
              onSelectHistory={selectHistory}
              onClearHistory={clearHistory}
            />
            <PlaylistPicker
              open={playlistPickerOpen}
              playlists={spotifyPlaylists}
              onClose={() => setPlaylistPickerOpen(false)}
              onSelect={(playlistUrl) => {
                setPlaylistPickerOpen(false)
                loadPlaylist(playlistUrl)
              }}
            />
          </>
        )}

        {activeTab === 'main' && error && (
          <div className="mb-6 rounded-md border border-[#6B7280]/30 bg-[#6B7280]/10 px-4 py-2.5 text-sm text-[#6B7280]">
            {error}
          </div>
        )}

        {activeTab === 'settings' && (
          <ConfigurationStatus
            config={config}
            diagnostics={diagnostics}
            backendOnline={backendOnline}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            config={config}
            onChange={setConfig}
            onSave={saveConfig}
            saving={savingConfig}
            spotifyAuth={spotifyAuth}
            onStartSpotifyAuth={startSpotifyAuth}
            open
          />
        )}

        {activeTab === 'main' && (
          <RecommendConfig
            pickMode={pickMode}
            onPickModeChange={setPickMode}
            formatPref={formatPref}
            onFormatPrefChange={setFormatPref}
          />
        )}

        {/* main grid: cards + monitor */}
        {activeTab === 'main' && (
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-slate-100">2. Revisar y descargar canciones</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">Selecciona pistas, busca versiones disponibles y elige escuchar o descargar cada resultado.</p>
          </div>
        )}
        <div className={`grid grid-cols-1 gap-8 ${activeTab === 'main' ? 'lg:grid-cols-1' : 'lg:grid-cols-1'}`}>
          <div className={`min-w-0 ${activeTab === 'main' ? '' : 'hidden'}`}>
            <TrackList
              tracks={tracks}
              loading={loading}
              selected={selected}
              onSelectAll={selectAll}
              onDownloadSelected={downloadSelected}
              onAutoSearchAll={autoSearchAll}
              getTrackSearch={getTrackSearch}
              isTrackDownloaded={isTrackDownloaded}
              manualDownloadedTracks={manualDownloadedTracks}
              trackIdentity={trackIdentity}
              getTrackDownloads={getTrackDownloads}
              getSpotifyTrackId={getSpotifyTrackId}
              onToggleSelect={toggleSelect}
              onToggleManualDownloaded={toggleManualDownloaded}
              onUpdateQuery={updateQuery}
              onCopy={copy}
              onSearchTrack={searchTrack}
              pickMode={pickMode}
              formatPref={formatPref}
              expandedSearches={expandedSearches}
              onToggleExpandedSearch={toggleExpandedSearch}
              collapsedSearches={collapsedSearches}
              onToggleCollapsedSearch={toggleCollapsedSearch}
              activePreview={activePreview}
              onStartPreview={startPreview}
              onSavePreview={savePreviewToLibrary}
              onDiscardPreview={discardActivePreview}
              onCancelPreview={cancelPreview}
              storedFileStreamUrl={storedFileStreamUrl}
              storedFileUrl={storedFileUrl}
              onCancelDownload={cancelTrackDownload}
              onRefreshSearch={refreshSearch}
              onCancelSearch={cancelSearch}
            />
          </div>

          {/* monitor column */}
          <div className={`${activeTab === 'main' ? 'hidden' : activeTab === 'logs' ? 'min-w-0 grid grid-cols-1 gap-4' : 'min-w-0 grid grid-cols-1 gap-4 lg:grid-cols-3'}`}>
            <div className={`${activeTab === 'library' ? 'flex min-w-0 lg:col-span-2' : 'hidden'}`}>
              <LibraryPanel
                newLibraryFolderName={newLibraryFolderName}
                onNewFolderNameChange={setNewLibraryFolderName}
                onCreateFolder={createLibraryFolder}
                config={config}
                onRefresh={refreshLibrary}
                diagnostics={diagnostics}
                libraryFiles={libraryFiles}
                libraryFolders={libraryFolders}
                dragOverFolder={dragOverLibraryFolder}
                onDragOverFolder={setDragOverLibraryFolder}
                onMoveFile={moveLibraryFile}
                storedFileStreamUrl={storedFileStreamUrl}
                onDeleteFile={deleteItem}
              />
            </div>

            <div className={`${activeTab === 'logs' ? 'flex min-w-0' : 'hidden'}`}>
              <LogsPanel ref={logRef} logs={logs} backendOnline={backendOnline} />
            </div>

            <div className={`${activeTab === 'library' ? 'flex min-w-0 lg:col-span-1' : 'hidden'}`}>
              <TemporalesPanel
                diagnostics={diagnostics}
                activeTransfers={activeTransfers}
                completedTransfers={completedTransfers}
                completedTransfersOpen={completedTransfersOpen}
                onToggleCompletedTransfers={setCompletedTransfersOpen}
                onCleanupAll={cleanupAll}
                onCancelTransfer={cancelTransfer}
                visiblePreviewFiles={visiblePreviewFiles}
                previewFilesCount={previewFiles.length}
                currentPreviewPage={currentPreviewPage}
                onPreviewPageChange={setPreviewPage}
                storedFileStreamUrl={storedFileStreamUrl}
                onSaveTemporaryPreview={saveTemporaryPreviewToLibrary}
                onDeleteFile={deleteItem}
              />
            </div>
          </div>
        </div>
        <AppFooter />
        <ToastContainer
          position="bottom-right"
          autoClose={3500}
          theme="dark"
          newestOnTop
          closeOnClick
          pauseOnFocusLoss
          draggable
          limit={4}
        />
      </div>
    </div>
  )
}

export default App
