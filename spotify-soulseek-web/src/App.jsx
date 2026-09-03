import { useEffect, useRef, useState } from 'react'

const HISTORY_KEY = 'spotifyUrlHistory'

// ---- design tokens -------------------------------------------------------
const FONT_DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif"
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"
const FONT_BODY = "'IBM Plex Sans', 'Segoe UI', sans-serif"

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
  const [url, setUrl] = useState('')
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const [backendOnline, setBackendOnline] = useState(true)
  const [searches, setSearches] = useState([])
  const [urlHistory, setUrlHistory] = useState(loadHistory)
  const [selectedSearchId, setSelectedSearchId] = useState(null)
  const [activePreview, setActivePreview] = useState(null)
  const [activeDownload, setActiveDownload] = useState(null)
  const [downloadsDir, setDownloadsDir] = useState('')
  const [diagnostics, setDiagnostics] = useState(null)
  const previewTimer = useRef(null)
  const downloadTimer = useRef(null)
  const logRef = useRef(null)

  const fetchLogs = async () => {
    try {
      const r = await fetch('/api/logs')
      const data = await r.json()
      setLogs(data)
      setBackendOnline(true)
    } catch {
      setBackendOnline(false)
    }
  }

  const fetchDiagnostics = async () => {
    try {
      const r = await fetch('/api/diagnostics')
      const data = await r.json()
      setDiagnostics(data)
    } catch {}
  }

  const deleteItem = async (path, dir) => {
    try {
      await fetch('/api/delete', {
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
      await fetch('/api/cleanup', { method: 'POST' })
      fetchDiagnostics()
    } catch {}
  }

  const cancelTransfer = async (username, filename) => {
    try {
      await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, filename }),
      })
      fetchDiagnostics()
    } catch {}
  }

  useEffect(() => {
    const iv = setInterval(fetchLogs, 5000)
    fetchLogs()
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // Cargar última playlist guardada
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('lastPlaylist') || 'null')
      if (saved) {
        setUrl(saved.url || '')
        setTracks(saved.tracks || [])
      }
    } catch {}
  }, [])

  // Guardar playlist actual cuando cambia
  useEffect(() => {
    if (url && tracks.length > 0) {
      localStorage.setItem('lastPlaylist', JSON.stringify({ url, tracks }))
    }
  }, [url, tracks])

  // Cargar carpeta de descargas
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => setDownloadsDir(data.downloads_dir || ''))
      .catch(() => {})
  }, [])

  // Cargar diagnósticos al inicio
  useEffect(() => {
    fetchDiagnostics()
    const iv = setInterval(fetchDiagnostics, 10000)
    return () => clearInterval(iv)
  }, [])

  const saveDownloadsDir = async () => {
    try {
      const r = await fetch('/api/config/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloads_dir: downloadsDir }),
      })
      const data = await r.json()
      if (data.error) {
        alert(data.error)
      } else {
        alert('Carpeta guardada: ' + data.downloads_dir)
      }
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  // Poll slskr searches
  useEffect(() => {
    const poll = async () => {
      const updated = await Promise.all(
        searches.map(async (s) => {
          try {
            const r = await fetch(`/api/search_slskr/${s.searchId}`)
            const data = await r.json()
            const results = data.results || []
            return {
              ...s,
              raw: data,
              resultsCount: data.resultsCount ?? (Array.isArray(results) ? results.length : 0),
              status: data.status || s.status,
            }
          } catch {
            return s
          }
        })
      )
      if (JSON.stringify(updated) !== JSON.stringify(searches)) {
        setSearches(updated)
      }
    }
    if (searches.length === 0) return
    const iv = setInterval(poll, 3000)
    return () => clearInterval(iv)
  }, [searches])

  const preview = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setTracks([])
    try {
      const r = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      setTracks(data.tracks || [])
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

  const searchSlskr = async (query) => {
    try {
      const r = await fetch('/api/search_slskr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
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
          query: data.query,
          resultsCount: data.resultsCount,
          status: 'buscando',
          raw: null,
        },
      ])
      setSelectedSearchId(data.searchId)
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const removeSearch = (searchId) => {
    setSearches((prev) => prev.filter((s) => s.searchId !== searchId))
  }

  const copy = (q) =>
    navigator.clipboard.writeText(q).then(() => alert('Copiado: ' + q))

  const updateQuery = (i, newQuery) => {
    const next = [...tracks]
    next[i].search_query = newQuery
    setTracks(next)
  }

  const stopPreviewTimer = () => {
    if (previewTimer.current) {
      clearInterval(previewTimer.current)
      previewTimer.current = null
    }
  }

  const stopDownloadTimer = () => {
    if (downloadTimer.current) {
      clearInterval(downloadTimer.current)
      downloadTimer.current = null
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

  const startDownload = async (res) => {
    if (
      activeDownload &&
      !activeDownload.error &&
      !['completado', 'error'].includes(activeDownload.state)
    ) {
      return
    }
    stopDownloadTimer()
    setActiveDownload({
      username: res.username,
      filename: res.filename,
      size: res.size,
      state: 'encolando',
      path: null,
      error: null,
    })
    try {
      const r = await fetch('/api/download', {
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
        setActiveDownload({
          username: res.username,
          filename: res.filename,
          size: res.size,
          state: 'error',
          path: null,
          error: data.error,
        })
        return
      }
      setActiveDownload({
        username: res.username,
        filename: res.filename,
        size: res.size,
        state: 'descargando',
        path: null,
        error: null,
      })
      downloadTimer.current = setInterval(async () => {
        try {
          const st = await fetch(
            `/api/download/status?username=${encodeURIComponent(res.username)}&filename=${encodeURIComponent(res.filename)}`
          )
          const d = await st.json()
          if (d.path) {
            stopDownloadTimer()
            setActiveDownload({
              username: res.username,
              filename: res.filename,
              size: res.size,
              state: 'completado',
              path: d.path,
              error: null,
            })
          } else if (
            d.state === 'error' ||
            d.state === 'Errored' ||
            d.state === 'Cancelled'
          ) {
            stopDownloadTimer()
            setActiveDownload({
              username: res.username,
              filename: res.filename,
              size: res.size,
              state: 'error',
              path: null,
              error: d.state,
            })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      setActiveDownload({
        username: res.username,
        filename: res.filename,
        size: res.size,
        state: 'error',
        path: null,
        error: err.message,
      })
    }
  }

  const cancelDownload = async (res) => {
    stopDownloadTimer()
    setActiveDownload(null)
    try {
      await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: res.username, filename: res.filename }),
      })
    } catch {}
  }

  const cancelPreview = async (res) => {
    stopPreviewTimer()
    setActivePreview(null)
    try {
      await fetch('/api/cancel', {
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
      const r = await fetch('/api/preview_audio', {
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
          const st = await fetch(
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

  const renderResults = (s) => {
    if (!s.raw)
      return (
        <p className="px-3 py-4 text-sm text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
          esperando resultados&hellip;
        </p>
      )
    const results = s.raw.results || []
    const total = s.raw.resultsCount || results.length
    if (!Array.isArray(results) || results.length === 0) {
      return (
        <pre className="max-h-56 overflow-x-auto whitespace-pre-wrap rounded-md bg-[#0D0F16] p-3 text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
          {JSON.stringify(s.raw, null, 2)}
        </pre>
      )
    }
    const isBusy =
      (activePreview && !activePreview.error && activePreview.state !== 'completado') ||
      (activeDownload && !activeDownload.error && activeDownload.state !== 'completado')
    const isThisPreview = (res) =>
      activePreview &&
      activePreview.username === res.username &&
      activePreview.filename === res.filename
    const isThisDownload = (res) =>
      activeDownload &&
      activeDownload.username === res.username &&
      activeDownload.filename === res.filename
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
          {results.length} de {total} resultado(s)
          {total > results.length ? ` · +${total - results.length} más en slskd` : ''}
        </p>
        {results.map((res, i) => (
          <div
            key={i}
            className="fade-in rounded-md border border-[#2C303D] bg-[#161822] p-2.5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="truncate text-[13px] text-[#E9EAF0]" title={res.filename}>
              {res.filename || res.file || res.name || res.path || `Resultado ${i + 1}`}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
              {res.username && <span>@{res.username}</span>}
              {res.extension && <span>{res.extension.toUpperCase()}</span>}
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
                onClick={() => startDownload(res)}
                disabled={isBusy}
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
                {activeDownload.state === 'encolando' && <Chip tone="amber">encolando</Chip>}
                {activeDownload.state === 'descargando' && <Chip tone="amber">descargando</Chip>}
                {activeDownload.state === 'completado' && activeDownload.path && (
                  <Chip tone="teal">guardado · {activeDownload.path}</Chip>
                )}
                {activeDownload.state === 'error' && (
                  <Chip tone="coral">error · {activeDownload.error}</Chip>
                )}
                {activeDownload.state !== 'completado' && activeDownload.state !== 'error' && (
                  <button
                    onClick={() => cancelDownload(res)}
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

        {/* carpeta de descargas */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8D93A6]"
              style={{ fontFamily: FONT_MONO }}
            >
              out
            </span>
            <input
              type="text"
              value={downloadsDir}
              onChange={(e) => setDownloadsDir(e.target.value)}
              placeholder="C:\\Users\\...\\Music\\Descargas"
              className="w-full rounded-md border border-[#2C303D] bg-[#161822] py-2 pl-11 pr-3 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
              style={{ fontFamily: FONT_MONO }}
            />
          </div>
          <button
            onClick={saveDownloadsDir}
            className="whitespace-nowrap rounded-md border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-4 py-2 text-sm font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20"
          >
            Guardar carpeta
          </button>
        </div>

        {/* main grid: tracklist + monitor */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            {tracks.length > 0 ? (
              <>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm text-[#8D93A6]">
                    {tracks.length} pista{tracks.length === 1 ? '' : 's'} encontradas
                  </h2>
                  <div className="flex gap-2">
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

                <div className="overflow-hidden rounded-lg border border-[#2C303D]">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[#2C303D] bg-[#161822] text-left text-xs text-[#565C6E]">
                        <th className="w-10 px-3 py-2 font-normal" style={{ fontFamily: FONT_MONO }}>#</th>
                        <th className="px-3 py-2 font-normal">pista</th>
                        <th className="hidden px-3 py-2 font-normal sm:table-cell">artista(s)</th>
                        <th className="hidden px-3 py-2 font-normal md:table-cell">álbum</th>
                        <th className="px-3 py-2 font-normal">búsqueda slskd</th>
                        <th className="px-3 py-2 font-normal"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tracks.map((t, i) => (
                        <tr key={i} className="border-b border-[#22242E] last:border-0 hover:bg-[#161822]/60">
                          <td
                            className="px-3 py-2 align-top text-[#565C6E]"
                            style={{ fontFamily: FONT_MONO }}
                          >
                            {String(i + 1).padStart(2, '0')}
                          </td>
                          <td className="px-3 py-2 align-top text-[#E9EAF0]">
                            {t.track_name}
                            <div className="text-xs text-[#8D93A6] sm:hidden">{t.artists}</div>
                          </td>
                          <td className="hidden px-3 py-2 align-top text-[#8D93A6] sm:table-cell">{t.artists}</td>
                          <td className="hidden px-3 py-2 align-top text-[#8D93A6] md:table-cell">{t.album}</td>
                          <td className="px-3 py-2 align-top">
                            <input
                              type="text"
                              value={t.search_query}
                              onChange={(e) => updateQuery(i, e.target.value)}
                              className="w-full min-w-[160px] rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1 text-xs text-[#E9EAF0] outline-none focus:border-[#FFFFFF]/60"
                              style={{ fontFamily: FONT_MONO }}
                            />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex justify-end gap-1.5">
                              {t.spotify_preview ? (
                                <a href={t.spotify_preview} target="_blank" rel="noreferrer">
                                  <button
                                    title="Preview 30s de Spotify"
                                    className="rounded border border-[#1DB954]/40 px-2 py-1 text-xs text-[#FFFFFF] transition-colors hover:bg-[#1DB954]/20"
                                  >
                                    spotify
                                  </button>
                                </a>
                              ) : (
                                <button
                                  disabled
                                  title="No hay preview en Spotify"
                                  className="rounded border border-[#2C303D] px-2 py-1 text-xs text-[#8D93A6] disabled:opacity-40"
                                >
                                  spotify
                                </button>
                              )}
                              <button
                                onClick={() => copy(t.search_query)}
                                title="Copiar búsqueda"
                                className="rounded border border-[#2C303D] px-2 py-1 text-xs text-[#8D93A6] transition-colors hover:border-[#3A3F4E] hover:text-[#E9EAF0]"
                              >
                                copiar
                              </button>
                              <button
                                onClick={() => searchSlskr(t.search_query)}
                                className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-2 py-1 text-xs text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20"
                              >
                                buscar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
            <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#2C303D]">
              <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
                <h2 className="text-xs text-[#8D93A6]">búsquedas slskd</h2>
                {searches.length > 0 && (
                  <span className="text-[11px] text-[#565C6E]" style={{ fontFamily: FONT_MONO }}>
                    {searches.length}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {searches.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-[#565C6E]">
                    Buscá una pista para verla acá.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {searches.map((s) => (
                      <div key={s.searchId} className="rounded-md border border-[#2C303D] bg-[#161822]">
                        <div className="flex items-start justify-between gap-2 px-2.5 py-2">
                          <button
                            onClick={() =>
                              setSelectedSearchId(selectedSearchId === s.searchId ? null : s.searchId)
                            }
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-[13px] text-[#E9EAF0]">{s.query}</p>
                            <p className="mt-0.5 text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
                              {s.raw?.state || s.status}
                              {s.raw?.responseCount ? ` · ${s.raw.responseCount} usuarios` : ''}
                              {` · ${s.resultsCount} archivos`}
                            </p>
                          </button>
                          <button
                            onClick={() => removeSearch(s.searchId)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-[#565C6E] hover:bg-[#6B7280]/10 hover:text-[#6B7280]"
                            aria-label="Quitar búsqueda"
                          >
                            ✕
                          </button>
                        </div>
                        {selectedSearchId === s.searchId && (
                          <div className="border-t border-[#2C303D] p-2">{renderResults(s)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

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

