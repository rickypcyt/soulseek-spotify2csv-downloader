import { useCallback, useEffect, useRef, useState } from 'react'
import { request, requestJson } from './api/client'
import SettingsPanel from './components/SettingsPanel'
import { extOf, pickBest } from './utils/resultPicker'

const HISTORY_KEY = 'spotifyUrlHistory'

// ---- design tokens -------------------------------------------------------
const FONT_DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif"
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"
const FONT_BODY = "'IBM Plex Sans', 'Segoe UI', sans-serif"

const RESULTS_PER_TRACK = 5

/*
  Add these to your index.html <head> to get the intended type:
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet">
*/

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch {
    return []
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)))
}

function loadLastPlaylist() {
  try {
    return JSON.parse(localStorage.getItem('lastPlaylist') || 'null') || {}
  } catch {
    return {}
  }
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

function App() {
  const [initialPlaylist] = useState(loadLastPlaylist)
  const [url, setUrl] = useState(() => initialPlaylist.url || '')
  const [tracks, setTracks] = useState(() => initialPlaylist.tracks || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const [backendOnline, setBackendOnline] = useState(true)
  const [searches, setSearches] = useState([])
  const [urlHistory, setUrlHistory] = useState(loadHistory)
  const [activePreview, setActivePreview] = useState(null)
  const [downloads, setDownloads] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [pickMode, setPickMode] = useState('quality')
  const [formatPref, setFormatPref] = useState('any')
  const [config, setConfig] = useState({})
  const [savingConfig, setSavingConfig] = useState(false)
  const [diagnostics, setDiagnostics] = useState(null)
  const previewTimer = useRef(null)
  const downloadTimers = useRef({})
  const logRef = useRef(null)
  const autoSearchStarted = useRef((initialPlaylist.tracks || []).length > 0)
  const autoSearchTimeouts = useRef([])
  const searchesRef = useRef([])
  const searchPollInFlight = useRef(false)

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

  const deleteItem = async (path, dir) => {
    try {
      await request('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dir }),
      })
      fetchDiagnostics()
    } catch {}
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

  // Cargar carpeta de descargas
  useEffect(() => {
    requestJson('/api/config')
      .then((data) => {
        setConfig(data)
      })
      .catch(() => {})
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
  }, [])

  const autoSearchAll = useCallback(() => {
    autoSearchTimeouts.current.forEach(clearTimeout)
    autoSearchTimeouts.current = []
    tracks.forEach((t, i) => {
      const id = setTimeout(() => searchTrack(i, t.search_query), i * 400)
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
      const updates = {}
      try {
        await Promise.all(
          current.map(async (s) => {
            if (!s.searchId) return
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
      setTracks(loaded)
      setSelected(new Set(loaded.map((_, i) => i)))
      if (url) {
        const next = [url, ...urlHistory.filter((u) => u !== url)]
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
      const results = s?.raw?.results || []
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

  const startPreview = async (res) => {
    if (activePreview && !activePreview.error && activePreview.state !== 'completado') {
      return
    }
    stopPreviewTimer()
    setActivePreview({
      username: res.username,
      filename: res.filename,
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
          size: res.size,
        }),
      })
      const data = await r.json()
      if (data.error) {
        setActivePreview({
          username: res.username,
          filename: res.filename,
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
              size: res.size,
              state: 'completado',
              percent,
              path: d.path,
              error: null,
            })
          } else if (d.state === 'procesando') {
            setActivePreview({
              username: res.username,
              filename: res.filename,
              size: res.size,
              state: 'procesando',
              percent,
              path: null,
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

  const renderResults = (s, limit = RESULTS_PER_TRACK) => {
    if (!s.raw) {
      return (
        <p className="px-1 py-2 text-sm text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
          esperando resultados&hellip;
        </p>
      )
    }
    const allResults = s.raw.results || []
    const total = s.raw.resultsCount ?? allResults.length

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

    const results = allResults.slice(0, limit)
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
          {results.length} de {total} resultado(s)
          {total > results.length ? ` · +${total - results.length} más` : ''}
        </p>
        {results.map((res, i) => (
          <div
            key={i}
            className="fade-in rounded-md border border-[#2C303D] bg-[#0D0F16] p-2.5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="truncate text-[13px] text-[#E9EAF0]" title={res.filename}>
              {res === bestPick && (
                <span className="mr-1.5 rounded bg-[#FFFFFF] px-1 py-0.5 text-[9px] font-semibold text-[#161822]">
                  pick
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
                onClick={() => startPreview(res)}
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
                {activePreview.state === 'procesando' && <Chip tone="amber">generando clip 30s {Math.round(activePreview.percent || 0)}%</Chip>}
                {activePreview.state === 'completado' && activePreview.path && (
                  <audio
                    controls
                    src={`/api/preview/stream?path=${encodeURIComponent(activePreview.path)}`}
                    onTimeUpdate={(e) => {
                      if (e.target.currentTime > 30) {
                        e.target.currentTime = 0
                        e.target.pause()
                      }
                    }}
                    className="mt-1 h-8 w-full"
                  />
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

  const renderTrackCard = (t, i) => {
    const s = getTrackSearch(i)
    const spotifyTrackId = getSpotifyTrackId(t.spotify_url)
    return (
      <div
        key={i}
        className="fade-in rounded-lg border border-[#2C303D] bg-[#161822] p-4"
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
      </div>
    )
  }

  return (
    <div
      className="min-h-screen bg-[#10121A] text-[#E9EAF0]"
      style={{ fontFamily: FONT_BODY }}
    >
      <div className="w-full px-5 py-6 sm:px-8 sm:py-8">
        {/* header / label plate */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[#2C303D] pb-5">
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
              <p className="text-xs text-[#8D93A6]">convierte una playlist en descargas P2P</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
              <StatusDot ok={backendOnline} />
              {backendOnline ? 'backend activo' : 'backend sin respuesta'}
            </div>
            <a href="http://127.0.0.1:5030" target="_blank" rel="noreferrer">
              <button className="rounded-md border border-[#2C303D] bg-[#1A1D28] px-3 py-1.5 text-xs text-[#8D93A6] transition-colors hover:border-[#3A3F4E] hover:text-[#E9EAF0]">
                abrir slskd
              </button>
            </a>
          </div>
        </header>

        {/* input jack */}
        <form onSubmit={preview} className="mb-2 flex flex-col gap-2 sm:flex-row">
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

        {urlHistory.length > 0 && (
          <div className="mb-6 flex items-center justify-between text-xs text-[#565C6E]">
            <span style={{ fontFamily: FONT_MONO }}>{urlHistory.length} link(s) recientes</span>
            <button
              onClick={() => {
                setUrlHistory([])
                saveHistory([])
              }}
              className="text-[#8D93A6] underline decoration-dotted underline-offset-2 hover:text-[#E9EAF0]"
            >
              borrar historial
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-md border border-[#6B7280]/30 bg-[#6B7280]/10 px-4 py-2.5 text-sm text-[#6B7280]">
            {error}
          </div>
        )}

        <SettingsPanel
          config={config}
          onChange={setConfig}
          onSave={saveConfig}
          saving={savingConfig}
        />

        {/* main grid: cards + monitor */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
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
          <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
            <div className="flex h-48 flex-col rounded-lg border border-[#2C303D] lg:h-56">
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

            <div className="mt-4 flex h-64 flex-col rounded-lg border border-[#2C303D]">
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
                    {diagnostics.previews
                      ?.filter((f) => !f.path.endsWith('.preview.mp3'))
                      .length > 0 && (
                      <div>
                        <p className="mb-1 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>previews</p>
                        <div className="space-y-1">
                          {diagnostics.previews
                            .filter((f) => !f.path.endsWith('.preview.mp3'))
                            .map((f, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="truncate text-[#E9EAF0]" title={f.path}>
                                  {f.path}
                                </span>
                                <span className="shrink-0 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
                                  {formatSize(f.size)}
                                </span>
                                <button
                                  onClick={() => deleteItem(f.path, 'previews')}
                                  className="ml-auto shrink-0 rounded border border-[#FFFFFF]/40 px-1.5 py-0.5 text-[10px] text-[#FFFFFF] hover:bg-[#FFFFFF]/10"
                                >
                                  borrar
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    {diagnostics.previews?.filter((f) => !f.path.endsWith('.preview.mp3')).length === 0 &&
                      diagnostics.transfers?.length === 0 && (
                        <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>sin temporales</p>
                      )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
