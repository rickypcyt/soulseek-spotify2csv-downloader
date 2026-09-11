import { useCallback, useEffect, useRef, useState } from 'react'
import { request, requestJson } from './api/client'
import SettingsPanel from './components/SettingsPanel'
import { extOf, pickBest, rankResults } from './utils/resultPicker'

const HISTORY_KEY = 'spotifyUrlHistory'
const SEARCH_PREFERENCES_KEY = 'soulseekSearchPreferences'

// ---- design tokens -------------------------------------------------------
const FONT_DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif"
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"
const FONT_BODY = "'IBM Plex Sans', 'Segoe UI', sans-serif"

const RESULTS_PER_TRACK = 5
const SEARCH_BATCH_SIZE = 4
const SEARCH_BATCH_DELAY_MS = 800
const LIBRARY_PAGE_SIZE = 12
const PREVIEW_PAGE_SIZE = 12

/*
  Add these to your index.html <head> to get the intended type:
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet">
*/

function normalizeHistory(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const item = typeof entry === 'string' ? { url: entry } : entry
      if (!item?.url) return null
      return {
        url: item.url,
        name: item.name || getHistoryLabel(item.url, index),
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

function isLibraryFile(file) {
  const firstFolder = file.path.split('/').filter(Boolean)[0]?.toLowerCase()
  return firstFolder !== 'temp' && firstFolder !== '.incomplete'
}

function isPlayableFile(file) {
  return /\.(flac|mp3|m4a|aac|ogg|opus|wav|webm)$/i.test(file.name || file.path)
}

function buildFolderTree(files) {
  const root = { folders: {}, files: [] }
  files
    .filter(isLibraryFile)
    .forEach((file) => {
      const parts = file.path.split('/').filter(Boolean)
      if (parts.length === 0) return
      const name = parts.pop()
      let folder = root
      parts.forEach((part) => {
        folder.folders[part] ||= { folders: {}, files: [] }
        folder = folder.folders[part]
      })
      folder.files.push({ ...file, name })
    })
  return root
}

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '--:--'
  const total = Math.floor(Number(ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
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

function StatusDot({ ok }) {
  return (
    <span className="relative flex h-2 w-2">
      {ok && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFFFFF] opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${ok ? 'bg-[#FFFFFF]' : 'bg-[#6B7280]'}`}
      />
    </span>
  )
}

function Chip({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-[#21242F] text-[#8D93A6] border-[#2C303D]',
    amber: 'bg-[#FFFFFF]/10 text-[#FFFFFF] border-[#FFFFFF]/30',
    teal: 'bg-[#FFFFFF]/10 text-[#FFFFFF] border-[#FFFFFF]/30',
    coral: 'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/30',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${tones[tone]}`}
      style={{ fontFamily: FONT_MONO }}
    >
      {children}
    </span>
  )
}

function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-[#2C303D] bg-[#0D0F16] px-3 py-2 text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
      <span>página {page} de {pages} · {total} archivos</span>
      <div className="flex gap-1">
        <button disabled={page === 1} onClick={() => onChange(page - 1)} className="rounded border border-[#2C303D] px-2 py-1 disabled:opacity-30">anterior</button>
        <button disabled={page === pages} onClick={() => onChange(page + 1)} className="rounded border border-[#2C303D] px-2 py-1 disabled:opacity-30">siguiente</button>
      </div>
    </div>
  )
}

function LibraryAudioCard({ file, streamUrl, downloadUrl, onDownload, formatSize, onDelete }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const extension = (file.name.split('.').pop() || 'archivo').toUpperCase()

  const togglePlayback = async () => {
    if (!audioRef.current) return
    if (audioRef.current.paused) {
      try {
        await audioRef.current.play()
        setPlaying(true)
      } catch {}
    } else {
      audioRef.current.pause()
      setPlaying(false)
    }
  }

  const seek = (event) => {
    const nextTime = Number(event.target.value)
    if (audioRef.current) audioRef.current.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  return (
    <div className="rounded-lg border border-[#2C303D] bg-[#161822] p-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
      <div className="flex items-start gap-2">
        <button
          onClick={togglePlayback}
          aria-label={playing ? `Pausar ${file.name}` : `Reproducir ${file.name}`}
          className="flex h-8 w-8 min-h-8 min-w-8 shrink-0 aspect-square items-center justify-center rounded-full p-0 leading-none bg-[#FFFFFF] text-xs font-semibold text-[#161822] transition-transform hover:scale-105"
        >
          {playing ? '||' : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[#E9EAF0]" title={file.path}>{file.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
            <span>{extension}</span>
            <span className="text-[#565C6E]">·</span>
            <span>{duration ? formatDuration(duration * 1000) : '--:--'}</span>
            <span className="text-[#565C6E]">·</span>
            <span>{formatSize(file.size)}</span>
          </div>
        </div>
        {onDownload ? (
          <button
            onClick={() => onDownload(file.path)}
            className="shrink-0 rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
          >
            descargar
          </button>
        ) : downloadUrl ? (
          <a
            href={downloadUrl}
            className="shrink-0 rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
          >
            descargar
          </a>
        ) : null}
        <button
          onClick={() => {
            if (audioRef.current) {
              audioRef.current.pause()
              audioRef.current.removeAttribute('src')
              audioRef.current.load()
            }
            onDelete(file.path)
          }}
          className="shrink-0 rounded border border-[#6B7280]/40 px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#6B7280] hover:text-[#E9EAF0]"
        >
          borrar
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>{formatDuration(currentTime * 1000)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
          aria-label="Posición de reproducción"
        />
        <span className="text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>{formatDuration(duration * 1000)}</span>
      </div>
      <audio
        ref={audioRef}
        src={streamUrl}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        className="hidden"
      />
    </div>
  )
}

function StatusItem({ label, description, ready, pending = false }) {
  const state = pending ? 'Pendiente' : ready ? 'Correcto' : 'Revisar'
  const color = pending
    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    : ready
      ? 'border-blue-400/40 bg-blue-400/10 text-blue-200'
      : 'border-red-400/40 bg-red-400/10 text-red-200'
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{label}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{description}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${color}`}>{state}</span>
      </div>
    </div>
  )
}

function ConfigurationStatus({ config, diagnostics, backendOnline }) {
  const status = diagnostics?.configuration
  const hasStatus = Boolean(status)
  const spotifyReady = hasStatus
    ? Boolean(status.spotify?.clientIdConfigured && status.spotify?.clientSecretConfigured)
    : Boolean(config?.spotify_client_id && config?.spotify_client_secret_configured)
  const slskdReady = hasStatus
    ? Boolean(status.slskd?.reachable && status.slskd?.apiKeyConfigured)
    : false
  const downloadsReady = hasStatus
    ? Boolean(status.downloads?.exists)
    : Boolean(config?.downloads_dir)

  return (
    <section className="mb-8 rounded-xl border border-slate-600 bg-slate-800 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Estado de la configuración</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Aquí puedes confirmar rápidamente si todo está listo antes de buscar o descargar.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${backendOnline ? 'border-blue-400/40 bg-blue-400/10 text-blue-200' : 'border-red-400/40 bg-red-400/10 text-red-200'}`}>
          Backend: {backendOnline ? 'conectado' : 'sin respuesta'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatusItem
          label="Spotify"
          description={spotifyReady ? 'Credenciales configuradas. Puedes cargar playlists.' : 'Falta el Client ID o Client Secret en la configuración.'}
          ready={spotifyReady}
          pending={!hasStatus}
        />
        <StatusItem
          label="Soulseek / slskd"
          description={slskdReady ? `Servicio conectado en ${status.slskd.url}.` : 'El servicio no responde o falta la API key. Revisa slskd.exe y su URL.'}
          ready={slskdReady}
          pending={!hasStatus}
        />
        <StatusItem
          label="Carpeta de descargas"
          description={downloadsReady ? (status?.downloads?.path || config?.downloads_dir) : 'La carpeta todavía no existe o no está configurada.'}
          ready={downloadsReady}
          pending={!hasStatus}
        />
      </div>
      {status?.slskd && !status.slskd.reachable && (
        <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
          Para habilitar las búsquedas, inicia slskd o configura la ruta de <strong>slskd.exe</strong> en Configuración local y guarda los cambios.
        </p>
      )}
      {config?.slskd_path && status?.slskd && !status.slskd.executableExists && (
        <p className="mt-3 text-sm text-red-200">La ruta configurada de slskd.exe no existe: {config.slskd_path}</p>
      )}
    </section>
  )
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
  const [outputFolderName, setOutputFolderName] = useState('')
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
  const [urlHistory, setUrlHistory] = useState(loadHistory)
  const [activePreview, setActivePreview] = useState(null)
  const [downloads, setDownloads] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [searchPreferences] = useState(loadSearchPreferences)
  const [pickMode, setPickMode] = useState(() => searchPreferences.pickMode)
  const [formatPref, setFormatPref] = useState(() => searchPreferences.formatPref)
  const [config, setConfig] = useState({})
  const [spotifyAuth, setSpotifyAuth] = useState({ status: 'not_configured' })
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([])
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false)
  const [playlistSearch, setPlaylistSearch] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)
  const [diagnostics, setDiagnostics] = useState(null)
  const [libraryPage, setLibraryPage] = useState(1)
  const [previewPage, setPreviewPage] = useState(1)
  const previewTimer = useRef(null)
  const downloadTimers = useRef({})
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
      alert('Se abrió Spotify en el navegador. Completa la autorización y vuelve aquí.')
    } catch (err) {
      alert('No se pudo iniciar Spotify: ' + err.message)
    }
  }

  const loadSpotifyPlaylists = async () => {
    try {
      const data = await requestJson('/api/spotify/playlists')
      setSpotifyPlaylists(data.playlists || [])
      setPlaylistSearch('')
      setPlaylistPickerOpen(true)
    } catch (err) {
      alert('No se pudieron cargar tus playlists: ' + err.message)
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
    } catch (err) {
      alert(`No se pudo borrar: ${err.message}`)
    }
  }

  const cleanupAll = async () => {
    if (!confirm('¿Borrar todos los temporales e incompletos?')) return
    try {
      await request('/api/cleanup', { method: 'POST' })
      fetchDiagnostics()
    } catch {}
  }

  const cancelTransfer = async (username, filename) => {
    try {
      await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, filename }),
      })
      fetchDiagnostics()
    } catch {}
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
      localStorage.setItem('lastPlaylist', JSON.stringify({ url, tracks }))
    }
  }, [url, tracks])

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
    } catch (err) {
      alert('Error al guardar configuración: ' + err.message)
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
        alert(data.error || 'Error')
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
      alert('Error: ' + err.message)
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

    const iv = setInterval(poll, 3000)
    return () => clearInterval(iv)
  }, [])

  const preview = async (e) => {
    e.preventDefault()
    autoSearchTimeouts.current.forEach(clearTimeout)
    autoSearchTimeouts.current = []
    setLoading(true)
    setError('')
    setTracks([])
    setSearches([])
    setExpandedSearches(new Set())
    setDownloads({})
    Object.values(downloadTimers.current).forEach(clearInterval)
    downloadTimers.current = {}
    autoSearchStarted.current = false
    try {
      const r = await request('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      const loaded = data.tracks || []
      setOutputFolderName(data.playlist_name || '')
      const cachedSearches = loadSearchCache(url, loaded)
      searchesRef.current = cachedSearches
      setSearches(cachedSearches)
      setTracks(loaded)
      setSelected(new Set(loaded.map((_, i) => i)))
      if (url) {
        const historyItem = {
          url,
          name: data.playlist_name || getHistoryLabel(url, 0),
        }
        const next = [historyItem, ...urlHistory.filter((item) => item.url !== url)]
        setUrlHistory(next)
        saveHistory(next)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copy = (q) =>
    navigator.clipboard.writeText(q).then(() => alert('Copiado: ' + q))

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

  const formatSize = (bytes) => {
    if (bytes == null || bytes === 0) return ''
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let n = Number(bytes)
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024
      i++
    }
    return `${n.toFixed(2)} ${units[i]}`
  }

  const formatSpeed = (bps) => {
    if (!bps) return ''
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
    let i = 0
    let n = Number(bps)
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024
      i++
    }
    return `${n.toFixed(1)} ${units[i]}`
  }

  const setDl = (i, patch) =>
    setDownloads((prev) => ({ ...prev, [i]: { ...prev[i], ...patch } }))

  const enqueueDownload = async (i, res) => {
    if (!res) return
    stopDownloadTimer(i)
    setDownloads((prev) => ({
      ...prev,
      [i]: {
        username: res.username,
        filename: res.filename,
        size: res.size,
        state: 'encolando',
        percent: 0,
        path: null,
        error: null,
      },
    }))
    try {
      const r = await request('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: res.username,
          filename: res.filename,
          size: res.size,
          folder_name: outputFolderName,
          track_key: getSpotifyTrackId(tracks[i]?.spotify_url),
          track_name: tracks[i]?.track_name,
          artists: tracks[i]?.artists,
        }),
      })
      const data = await r.json()
      if (data.error) {
        setDl(i, { state: 'error', error: data.error })
        return
      }
      setDl(i, { state: 'descargando' })
      downloadTimers.current[i] = setInterval(async () => {
        try {
          const st = await request(
            `/api/download/status?username=${encodeURIComponent(res.username)}&filename=${encodeURIComponent(res.filename)}`
          )
          const d = await st.json()
          if (d.path) {
            stopDownloadTimer(i)
            setDl(i, { state: 'completado', path: d.path, percent: 100 })
            fetchDiagnostics()
          } else if (
            d.state === 'error' ||
            d.state === 'Errored' ||
            d.state === 'Cancelled'
          ) {
            stopDownloadTimer(i)
            setDl(i, { state: 'error', error: d.error || d.state })
          } else {
            setDl(i, { percent: d.percentComplete || 0 })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      setDl(i, { state: 'error', error: err.message })
    }
  }

  const cancelTrackDownload = async (i) => {
    const dl = downloads[i]
    stopDownloadTimer(i)
    setDownloads((prev) => {
      const next = { ...prev }
      delete next[i]
      return next
    })
    if (!dl) return
    try {
      await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: dl.username, filename: dl.filename }),
      })
    } catch {}
  }

  const toggleSelect = (i) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

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
    } catch (err) {
      alert('No se pudo guardar el preview: ' + err.message)
    }
  }

  const saveTemporaryPreviewToLibrary = async (path) => {
    try {
      await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folder_name: outputFolderName }),
      })
      await fetchDiagnostics()
    } catch (err) {
      alert('No se pudo mover a la biblioteca: ' + err.message)
    }
  }

  const renderDownloadTree = (node, level = 0) => {
    const folders = Object.entries(node.folders).sort(([a], [b]) => a.localeCompare(b))
    const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
    return (
      <div className={level > 0 ? 'ml-3 border-l border-[#2C303D] pl-2' : ''}>
        {folders.map(([name, folder]) => (
          <details key={name} open={level === 0} className="py-0.5">
            <summary className="cursor-pointer truncate py-1 text-[#E9EAF0] hover:text-white">{name}</summary>
            {renderDownloadTree(folder, level + 1)}
          </details>
        ))}
        {files.map((file) => (
          isPlayableFile(file) ? (
            <LibraryAudioCard
              key={file.path}
              file={file}
              streamUrl={storedFileStreamUrl('downloads', file.path)}
              formatSize={formatSize}
              onDelete={(path) => {
                if (confirm(`¿Borrar ${path}?`)) deleteItem(path, 'downloads')
              }}
            />
          ) : (
            <div key={file.path} className="rounded-lg border border-[#2C303D] bg-[#161822] p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-[#E9EAF0]" title={file.path}>{file.name}</span>
                <span className="shrink-0 text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>{formatSize(file.size)}</span>
                <button
                  onClick={() => {
                    if (confirm(`¿Borrar ${file.path}?`)) deleteItem(file.path, 'downloads')
                  }}
                  className="shrink-0 rounded border border-[#6B7280]/40 px-2 py-1 text-[10px] text-[#8D93A6] hover:border-[#6B7280] hover:text-[#E9EAF0]"
                >
                  borrar
                </button>
              </div>
            </div>
          )
        ))}
      </div>
    )
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

  const renderResults = (s, limit = RESULTS_PER_TRACK) => {
    if (!s.raw) {
      return (
        <p className="px-1 py-2 text-sm text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
          esperando resultados&hellip;
        </p>
      )
    }
    const allResults = rankResults(s.raw.results || [], s.query, pickMode, formatPref)
    const total = allResults.length
    const expanded = expandedSearches.has(s.searchId)

    if (s.raw.error || s.raw.status === 'error') {
      return (
        <div className="py-2">
          <Chip tone="coral">
            error · {typeof s.raw.error === 'string' ? s.raw.error : JSON.stringify(s.raw.error)}
          </Chip>
        </div>
      )
    }

    const normalizedStatus = String(s.raw.status || s.raw.state || s.status || '').toLowerCase()
    const terminalStatuses = new Set(['completed', 'complete', 'finished', 'failed', 'cancelled', 'canceled', 'error'])
    const activeStatuses = new Set(['active', 'searching', 'inprogress', 'in_progress', 'pending', 'running', 'queued', 'started', 'buscando'])
    const stillSearching =
      !terminalStatuses.has(normalizedStatus) &&
      (activeStatuses.has(normalizedStatus) || !normalizedStatus && (s.pollCount || 0) < 10)

    if (!Array.isArray(allResults) || allResults.length === 0) {
      return stillSearching ? (
        <div className="py-2">
          <Chip tone="amber">buscando resultados…</Chip>
        </div>
      ) : (
        <p className="py-2 text-xs text-[#8D93A6]">
          sin resultados
        </p>
      )
    }

    const results = expanded ? allResults : allResults.slice(0, limit)
    const isBusy =
      activePreview && !activePreview.error && activePreview.state !== 'completado'
    const dl = downloads[s.trackIndex]
    const dlActive = dl && !['completado', 'error'].includes(dl.state)
    const bestPick = pickBest(allResults, pickMode, formatPref)
    const isThisPreview = (res) =>
      activePreview &&
      activePreview.username === res.username &&
      activePreview.filename === res.filename
    const isThisDownload = (res) =>
      dl &&
      dl.username === res.username &&
      dl.filename === res.filename

    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
          {results.length} de {total} resultado(s) únicos
          {total > results.length ? ` · +${total - results.length} más` : ''}
        </p>
        {total > limit && (
          <button
            onClick={() => toggleExpandedSearch(s.searchId)}
            className="mb-1 rounded border border-[#2C303D] px-2 py-1 text-[11px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
          >
            {expanded ? 'mostrar menos' : `ver los ${total} resultados`}
          </button>
        )}
        {results.map((res, i) => (
          <div
            key={`${res.username || 'unknown'}|${res.filename || res.path || i}|${res.size || 0}`}
            className="fade-in rounded-md border border-[#2C303D] bg-[#0D0F16] p-2.5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="truncate text-[13px] text-[#E9EAF0]" title={res.filename}>
              {res === bestPick && (
                <span className="mr-1.5 rounded bg-[#FFFFFF] px-1 py-0.5 text-[9px] font-semibold text-[#161822]">
                  Recomendado
                </span>
              )}
              {res.filename || res.file || res.name || res.path || `Resultado ${i + 1}`}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
              {res.username && <span>@{res.username}</span>}
              {extOf(res) && <span>{extOf(res).toUpperCase()}</span>}
              {res.size ? <span>{formatSize(res.size)}</span> : null}
              {res.speed ? <span>{formatSpeed(res.speed)}</span> : null}
              {res.bitrate ? <span>{Math.round(res.bitrate / 1000)} kbps</span> : null}
            </p>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => startPreview(res, s.trackIndex)}
                disabled={isBusy}
                className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-2 py-1 text-[11px] font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Escuchar
              </button>
              <button
                onClick={() => enqueueDownload(s.trackIndex, res)}
                disabled={isBusy || dlActive}
                className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-2 py-1 text-[11px] font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Descargar
              </button>
            </div>
            {isThisPreview(res) && (
              <div className="mt-2">
                {activePreview.state === 'encolando' && <Chip tone="amber">encolando</Chip>}
                {activePreview.state === 'descargando' && <Chip tone="amber">cargando preview {Math.round(activePreview.percent || 0)}%</Chip>}
                {activePreview.state === 'completado' && activePreview.path && (
                  <>
                    <audio
                      controls
                      src={activePreview.savedPath
                        ? storedFileStreamUrl('downloads', activePreview.savedPath)
                        : `/api/preview/stream?path=${encodeURIComponent(activePreview.path)}`}
                      onTimeUpdate={(e) => {
                        if (e.target.currentTime > 30) {
                          e.target.currentTime = 0
                          e.target.pause()
                        }
                      }}
                      className="mt-1 h-8 w-full"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        onClick={savePreviewToLibrary}
                        disabled={Boolean(activePreview.savedPath)}
                        className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10 disabled:cursor-default disabled:opacity-60"
                      >
                        {activePreview.savedPath ? 'Guardado en biblioteca' : 'Guardar en biblioteca'}
                      </button>
                      <a
                        href={activePreview.savedPath
                          ? storedFileUrl('downloads', activePreview.savedPath)
                          : storedFileUrl('previews', activePreview.path)}
                        className="inline-flex rounded border border-[#2C303D] px-2 py-1 text-[11px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
                      >
                        Descargar archivo
                      </a>
                    </div>
                  </>
                )}
                {activePreview.state === 'error' && (
                  <Chip tone="coral">error · {activePreview.error}</Chip>
                )}
                {activePreview.state !== 'completado' && activePreview.state !== 'error' && (
                  <button
                    onClick={() => cancelPreview(res)}
                    className="ml-2 rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            )}
            {isThisDownload(res) && (
              <div className="mt-2">
                {dl.state === 'encolando' && <Chip tone="amber">encolando</Chip>}
                {dl.state === 'descargando' && (
                  <Chip tone="amber">descargando {Math.round(dl.percent || 0)}%</Chip>
                )}
                {dl.state === 'completado' && dl.path && (
                  <Chip tone="teal">guardado · {dl.path}</Chip>
                )}
                {dl.state === 'error' && (
                  <Chip tone="coral">error · {dl.error}</Chip>
                )}
                {dl.state !== 'completado' && dl.state !== 'error' && (
                  <button
                    onClick={() => cancelTrackDownload(s.trackIndex)}
                    className="ml-2 rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    )
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

  const renderTrackCard = (t, i) => {
    const s = getTrackSearch(i)
    const downloaded = isTrackDownloaded(t)
    const spotifyTrackId = getSpotifyTrackId(t.spotify_url)
    return (
      <div
        key={i}
        className={`relative overflow-hidden fade-in rounded-lg border border-[#2C303D] bg-[#161822] p-4 ${downloaded ? 'border-[#6B7280]/60' : ''}`}
        style={{ animationDelay: `${i * 40}ms` }}
      >
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            <input
              type="checkbox"
              checked={selected.has(i)}
              onChange={() => toggleSelect(i)}
              title="Seleccionar pista"
              className="h-3.5 w-3.5 cursor-pointer accent-white"
            />
            <div
              className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0D0F16] text-xs text-[#8D93A6]"
              style={{ fontFamily: FONT_MONO }}
            >
              {String(i + 1).padStart(2, '0')}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-medium leading-tight text-[#E9EAF0]">
              {t.track_name}
            </h3>
            <p className="truncate text-xs text-[#8D93A6]">
              {t.artists}
              {t.album ? ` · ${t.album}` : ''}
            </p>
            <p className="mt-0.5 text-[11px] text-[#565C6E]" style={{ fontFamily: FONT_MONO }}>
              {formatDuration(t.duration_ms)}
            </p>
          </div>
        </div>

        {downloads[i] && (
          <div className="mt-2">
            {downloads[i].state === 'encolando' && <Chip tone="amber">encolando</Chip>}
            {downloads[i].state === 'descargando' && (
              <Chip tone="amber">descargando {Math.round(downloads[i].percent || 0)}%</Chip>
            )}
            {downloads[i].state === 'completado' && (
              <Chip tone="teal">guardado{downloads[i].path ? ` · ${downloads[i].path}` : ''}</Chip>
            )}
            {downloads[i].state === 'error' && (
              <Chip tone="coral">error · {downloads[i].error}</Chip>
            )}
          </div>
        )}

        {spotifyTrackId && (
          <div className="mt-3">
            <iframe
              src={`https://open.spotify.com/embed/track/${spotifyTrackId}`}
              width="100%"
              height="80"
              style={{ border: 0, borderRadius: '8px' }}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={t.search_query}
            onChange={(e) => updateQuery(i, e.target.value)}
            placeholder="query para Soulseek"
            className="min-w-0 flex-1 rounded border border-[#2C303D] bg-[#0D0F16] px-2.5 py-1.5 text-xs text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
            style={{ fontFamily: FONT_MONO }}
          />
          <button
            onClick={() => copy(t.search_query)}
            title="Copiar búsqueda"
            className="shrink-0 rounded border border-[#2C303D] px-2.5 py-1.5 text-xs text-[#8D93A6] transition-colors hover:border-[#3A3F4E] hover:text-[#E9EAF0]"
          >
            copiar
          </button>
          <button
            onClick={() => searchTrack(i, t.search_query)}
            className="shrink-0 rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-2.5 py-1.5 text-xs text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20"
          >
            buscar
          </button>
        </div>

        {s && (
          <div className="mt-3 border-t border-[#2C303D] pt-3">
            {renderResults(s, RESULTS_PER_TRACK)}
          </div>
        )}
        {downloaded && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#10121A]/70 p-4 text-center backdrop-blur-[2px]">
            <span className="rounded border border-[#8D93A6]/50 bg-[#161822]/90 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-[#D5D7DE]">
              Already downloaded this song
            </span>
          </div>
        )}
      </div>
    )
  }

  const libraryFiles = (diagnostics?.downloads || [])
    .filter(isLibraryFile)
    .sort((a, b) => a.path.localeCompare(b.path))
  const previewFiles = diagnostics?.previews || []
  const libraryPages = Math.max(1, Math.ceil(libraryFiles.length / LIBRARY_PAGE_SIZE))
  const previewPages = Math.max(1, Math.ceil(previewFiles.length / PREVIEW_PAGE_SIZE))
  const currentLibraryPage = Math.min(libraryPage, libraryPages)
  const currentPreviewPage = Math.min(previewPage, previewPages)
  const visibleLibraryFiles = libraryFiles.slice((currentLibraryPage - 1) * LIBRARY_PAGE_SIZE, currentLibraryPage * LIBRARY_PAGE_SIZE)
  const visiblePreviewFiles = previewFiles.slice((currentPreviewPage - 1) * PREVIEW_PAGE_SIZE, currentPreviewPage * PREVIEW_PAGE_SIZE)

  return (
    <div
      className="min-h-screen bg-[#10121A] text-[#E9EAF0]"
      style={{ fontFamily: FONT_BODY }}
    >
      <div className="w-full px-5 py-8 sm:px-10 sm:py-10">
        {/* header / label plate */}
        <header className="mb-10 flex flex-wrap items-center justify-between gap-5 border-b border-slate-600 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#2C303D] bg-[#1A1D28]">
              <div className="h-2.5 w-2.5 rounded-sm bg-[#FFFFFF]" />
            </div>
            <div>
              <h1
                className="text-xl leading-tight tracking-tight text-[#E9EAF0] sm:text-2xl"
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 600 }}
              >
                Spotify <span className="text-[#8D93A6]">&rarr;</span> Soulseek
              </h1>
              <p className="mt-1 text-sm text-slate-300">Carga una playlist, encuentra cada pista y descarga los archivos seleccionados.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
              <StatusDot ok={backendOnline} />
              {backendOnline ? 'backend activo' : 'backend sin respuesta'}
            </div>
            <span
              className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-300"
              title="slskd se ejecuta en modo API y se controla desde esta aplicación"
            >
              slskd · API interna
            </span>
          </div>
        </header>

        <nav className="mb-8 flex flex-wrap gap-2 border-b border-[#2C303D] pb-3" aria-label="Secciones">
          {[
            ['main', 'Principal'],
            ['settings', 'Settings'],
            ['logs', 'Logs'],
            ['library', 'Biblioteca y previews'],
          ].map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => navigate(TAB_PATHS[tab])}
              className={`rounded-md px-3 py-2 text-xs transition-colors ${activeTab === tab
                ? 'bg-[#FFFFFF] font-medium text-[#161822]'
                : 'border border-[#2C303D] text-[#8D93A6] hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]'}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === 'main' && (
          <>
        {/* input jack */}
        <section className="mb-8 rounded-xl border border-slate-600 bg-slate-800 p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-100">1. Cargar playlist de Spotify</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">Pega aquí el enlace de una playlist pública para importar sus canciones.</p>
          </div>
        <form onSubmit={preview} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8D93A6]"
              style={{ fontFamily: FONT_MONO }}
            >
              url
            </span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://open.spotify.com/playlist/..."
              list="url-history"
              className="w-full rounded-md border border-[#2C303D] bg-[#161822] py-2.5 pl-11 pr-3 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
              style={{ fontFamily: FONT_MONO }}
            />
            <datalist id="url-history">
              {urlHistory.map((u, i) => (
                <option key={i} value={u} />
              ))}
            </datalist>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="whitespace-nowrap rounded-md bg-[#FFFFFF] px-5 py-2.5 text-sm font-medium text-[#161822] transition-colors hover:bg-[#f0b25c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Cargando playlist…' : 'Cargar playlist'}
          </button>
        </form>
        <div className="mt-4 rounded-md border border-[#2C303D] bg-[#161822] p-3">
          <button
            type="button"
            onClick={loadSpotifyPlaylists}
            disabled={spotifyAuth.status !== 'authenticated'}
            className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-3 py-2 text-xs text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            elegir una playlist de Spotify
          </button>
          <span className="ml-3 text-xs text-[#8D93A6]">
            {spotifyAuth.status === 'authenticated' ? 'Abre el selector de playlists' : 'Conecta Spotify desde Settings primero'}
          </span>
        </div>
        <div className="mt-4 rounded-md border border-[#2C303D] bg-[#161822] p-3">
          <label className="block text-sm font-medium text-slate-200" htmlFor="output-folder-name">
            Carpeta de salida de esta playlist
          </label>
          <p className="mt-1 text-xs leading-relaxed text-[#8D93A6]">
            Los previews que guardes y las descargas de esta playlist irán aquí. Si lo dejas vacío se usará automáticamente el nombre de la playlist.
          </p>
          <input
            id="output-folder-name"
            type="text"
            value={outputFolderName}
            onChange={(event) => setOutputFolderName(event.target.value)}
            placeholder="Nombre de la playlist"
            className="mt-2 w-full rounded-md border border-[#2C303D] bg-[#0D0F16] px-3 py-2 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none focus:border-[#FFFFFF]/60"
          />
        </div>
        {urlHistory.length > 0 && (
          <div className="mt-5 border-t border-slate-600 pt-5">
            <label className="block text-sm font-medium text-slate-200" htmlFor="saved-playlists">
              Historial local de playlists
            </label>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">
              Selecciona una playlist guardada para volver a poner su enlace en la barra. Este historial vive en este navegador y usuario.
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <select
                id="saved-playlists"
                defaultValue=""
                onChange={(event) => {
                  const saved = urlHistory.find((item) => item.url === event.target.value)
                  if (saved) {
                    setUrl(saved.url)
                    setOutputFolderName(saved.name)
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              >
                <option value="">Elegir una playlist guardada…</option>
                {urlHistory.map((saved) => (
                  <option key={saved.url} value={saved.url}>
                    {saved.name} — {saved.url}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setUrlHistory([])
                  saveHistory([])
                }}
                className="shrink-0 text-sm text-slate-300 underline decoration-dotted underline-offset-2 hover:text-white"
              >
                Borrar historial ({urlHistory.length})
              </button>
            </div>
          </div>
        )}
        </section>
          {playlistPickerOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#10121A]/85 p-4 backdrop-blur-sm">
              <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-[#2C303D] bg-[#161822] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#2C303D] p-4">
                  <div>
                    <h2 className="text-lg font-semibold text-[#E9EAF0]">Tus playlists de Spotify</h2>
                    <p className="mt-1 text-xs text-[#8D93A6]">Selecciona una playlist para cargarla en Soulseek.</p>
                  </div>
                  <button onClick={() => setPlaylistPickerOpen(false)} className="rounded border border-[#2C303D] px-2 py-1 text-xs text-[#8D93A6] hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]">cerrar</button>
                </div>
                <div className="border-b border-[#2C303D] p-4">
                  <input
                    autoFocus
                    value={playlistSearch}
                    onChange={(event) => setPlaylistSearch(event.target.value)}
                    placeholder="Buscar playlist…"
                    className="w-full rounded-md border border-[#2C303D] bg-[#0D0F16] px-3 py-2 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none focus:border-[#FFFFFF]/60"
                  />
                </div>
                <div className="min-h-0 overflow-y-auto p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {spotifyPlaylists
                      .filter((playlist) => playlist.name.toLowerCase().includes(playlistSearch.toLowerCase()))
                      .map((playlist) => (
                        <button
                          key={playlist.id}
                          type="button"
                          onClick={() => {
                            setUrl(playlist.url)
                            setOutputFolderName(playlist.name)
                            setPlaylistPickerOpen(false)
                          }}
                          className="rounded-lg border border-[#2C303D] bg-[#0D0F16] px-4 py-3 text-left transition-colors hover:border-[#FFFFFF]/50 hover:bg-[#1A1D28]"
                        >
                          <p className="truncate text-sm font-medium text-[#E9EAF0]" title={playlist.name}>{playlist.name}</p>
                        </button>
                      ))}
                  </div>
                  {spotifyPlaylists.filter((playlist) => playlist.name.toLowerCase().includes(playlistSearch.toLowerCase())).length === 0 && (
                    <p className="py-10 text-center text-sm text-[#8D93A6]">No se encontraron playlists.</p>
                  )}
                </div>
              </div>
            </div>
          )}
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

        {/* main grid: cards + monitor */}
        {activeTab === 'main' && (
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-slate-100">2. Revisar y descargar canciones</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">Selecciona pistas, busca versiones disponibles y elige escuchar o descargar cada resultado.</p>
          </div>
        )}
        <div className={`grid grid-cols-1 gap-8 ${activeTab === 'main' ? 'lg:grid-cols-1' : 'lg:grid-cols-1'}`}>
          <div className={`min-w-0 ${activeTab === 'main' ? '' : 'hidden'}`}>
            {tracks.length > 0 ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[#8D93A6]">
                    <input
                      type="checkbox"
                      checked={selected.size === tracks.length && tracks.length > 0}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? new Set(tracks.map((_, i) => i)) : new Set()
                        )
                      }
                      className="h-3.5 w-3.5 cursor-pointer accent-white"
                    />
                    {selected.size} de {tracks.length} seleccionada
                    {selected.size === 1 ? '' : 's'}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={pickMode}
                      onChange={(e) => setPickMode(e.target.value)}
                      title="Criterio de elección"
                      className="rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1 text-xs text-[#E9EAF0] outline-none"
                    >
                      <option value="quality">mejor calidad</option>
                      <option value="speed">más rápido</option>
                      <option value="longest">más largo</option>
                      <option value="balanced">balanceado</option>
                    </select>
                    <select
                      value={formatPref}
                      onChange={(e) => setFormatPref(e.target.value)}
                      title="Formato preferido"
                      className="rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1 text-xs text-[#E9EAF0] outline-none"
                    >
                      <option value="any">cualquier formato</option>
                      <option value="flac">FLAC</option>
                      <option value="mp3">MP3</option>
                      <option value="ogg">OGG</option>
                      <option value="m4a">M4A</option>
                    </select>
                    <button
                      onClick={downloadSelected}
                      disabled={selected.size === 0}
                      className="rounded bg-[#FFFFFF] px-2.5 py-1 text-xs font-medium text-[#161822] transition-colors hover:bg-[#f0b25c] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      descargar seleccionadas
                    </button>
                    <button
                      onClick={autoSearchAll}
                      className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-2.5 py-1 text-xs text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20"
                    >
                      buscar todas
                    </button>
                    <a href="/api/download/csv">
                      <button className="rounded border border-[#2C303D] px-2.5 py-1 text-xs text-[#8D93A6] transition-colors hover:border-[#3A3F4E] hover:text-[#E9EAF0]">
                        exportar CSV
                      </button>
                    </a>
                    <a href="/api/download/soulseek">
                      <button className="rounded border border-[#2C303D] px-2.5 py-1 text-xs text-[#8D93A6] transition-colors hover:border-[#3A3F4E] hover:text-[#E9EAF0]">
                        exportar búsquedas
                      </button>
                    </a>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {tracks.map((t, i) => renderTrackCard(t, i))}
                </div>
              </>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-[#2C303D] text-center text-sm text-[#565C6E]">
                <p>Pegá el link de una playlist para ver sus pistas acá.</p>
              </div>
            )}
          </div>

          {/* monitor column */}
          <div className={`${activeTab === 'main' ? 'hidden' : activeTab === 'logs' ? 'min-w-0 grid grid-cols-1 gap-4' : 'min-w-0 grid grid-cols-1 gap-4 lg:grid-cols-2'}`}>
            <div className={`${activeTab === 'library' ? 'flex' : 'hidden'} min-h-[calc(100dvh-15rem)] lg:h-[calc(100dvh-15rem)] min-w-0 flex-col rounded-lg border border-[#2C303D]`}>
              <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
                <div>
                  <h2 className="text-xs text-[#8D93A6]">Biblioteca local</h2>
                  <p className="mt-0.5 max-w-[245px] truncate text-[10px] text-[#565C6E]" title={config.downloads_dir}>
                    {config.downloads_dir || 'sin configurar'}
                  </p>
                </div>
                <button
                  onClick={refreshLibrary}
                  className="rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
                >
                  actualizar
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#0D0F16] p-3 text-[11px] text-[#E9EAF0]">
                {!diagnostics ? (
                  <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>cargando…</p>
                ) : libraryFiles.length > 0 ? (
                  renderDownloadTree(buildFolderTree(visibleLibraryFiles))
                ) : (
                  <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>la carpeta está vacía</p>
                )}
              </div>
              <Pagination page={currentLibraryPage} total={libraryFiles.length} pageSize={LIBRARY_PAGE_SIZE} onChange={setLibraryPage} />
            </div>

            <div className={`${activeTab === 'logs' ? 'flex' : 'hidden'} min-h-[calc(100vh-15rem)] h-[calc(100vh-15rem)] flex-col rounded-lg border border-[#2C303D]`}>
              <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
                <h2 className="text-xs text-[#8D93A6]">logs</h2>
                <StatusDot ok={backendOnline} />
              </div>
              <pre
                ref={logRef}
                className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap bg-[#0D0F16] p-3 text-[11px] leading-relaxed text-[#7FD8CC]"
                style={{ fontFamily: FONT_MONO }}
              >
                {logs.join('\n')}
              </pre>
            </div>

            <div className={`${activeTab === 'library' ? 'flex' : 'hidden'} min-h-[calc(100dvh-15rem)] lg:h-[calc(100dvh-15rem)] min-w-0 flex-col rounded-lg border border-[#2C303D]`}>
              <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
                <h2 className="text-xs text-[#8D93A6]">temporales</h2>
                <button
                  onClick={cleanupAll}
                  className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
                >
                  limpiar todo
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#0D0F16] p-3 text-[11px] text-[#E9EAF0]">
                {!diagnostics ? (
                  <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>cargando…</p>
                ) : (
                  <div className="space-y-3">
                    {diagnostics.transfers?.length > 0 && (
                      <div>
                        <p className="mb-1 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>slskd</p>
                        <div className="space-y-1">
                          {diagnostics.transfers.map((t, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="shrink-0 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
                                {t.state} · {Math.round(t.percentComplete || 0)}%
                              </span>
                              <span className="truncate text-[#E9EAF0]" title={t.filename}>@{t.username}</span>
                              <button
                                onClick={() => cancelTransfer(t.username, t.filename)}
                                className="ml-auto shrink-0 rounded border border-[#FFFFFF]/40 px-1.5 py-0.5 text-[10px] text-[#FFFFFF] hover:bg-[#FFFFFF]/10"
                              >
                                cancelar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {diagnostics.previews?.length > 0 && (
                      <div>
                        <p className="mb-1 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>previews</p>
                        <div className="space-y-1">
                          {visiblePreviewFiles.map((f) => (
                            <LibraryAudioCard
                              key={f.path}
                              file={{ ...f, name: f.path.split('/').pop() || f.path }}
                              streamUrl={storedFileStreamUrl('previews', f.path)}
                              onDownload={saveTemporaryPreviewToLibrary}
                              formatSize={formatSize}
                              onDelete={(path) => {
                                if (confirm(`¿Borrar ${path}?`)) deleteItem(path, 'previews')
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {diagnostics.previews?.length === 0 &&
                      diagnostics.transfers?.length === 0 && (
                        <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>sin temporales</p>
                      )}
                  </div>
                )}
              </div>
              <Pagination page={currentPreviewPage} total={previewFiles.length} pageSize={PREVIEW_PAGE_SIZE} onChange={setPreviewPage} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
