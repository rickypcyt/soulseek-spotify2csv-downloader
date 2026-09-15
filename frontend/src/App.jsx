import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { FONT_BODY, PREVIEW_PAGE_SIZE, isCompletedTransfer, isLibraryFile } from './constants'
import { pickBest, rankResults } from './utils/resultPicker'
import { getSpotifyTrackId, matchesLibraryFile, trackIdentity } from './utils/spotify'
import {
  getHistoryLabel,
  loadHistory,
  loadLastPlaylist,
  loadSearchCache,
  loadSearchPreferences,
  saveHistory,
  saveLastPlaylist,
  saveSearchPreferences,
} from './utils/storage'
import { useConfig } from './hooks/useConfig'
import { useDiagnostics } from './hooks/useDiagnostics'
import { useDownloads } from './hooks/useDownloads'
import { useLibraryIndex } from './hooks/useLibraryIndex'
import { useLibraryOps } from './hooks/useLibraryOps'
import { useLogs } from './hooks/useLogs'
import { usePreview } from './hooks/usePreview'
import { useSearches } from './hooks/useSearches'
import { useSpotifyAuth } from './hooks/useSpotifyAuth'
import { useTabNavigation } from './hooks/useTabNavigation'

function App() {
  const [bootstrapped, setBootstrapped] = useState(false)
  const [initialPlaylist, setInitialPlaylist] = useState({})
  const [url, setUrl] = useState('')
  const [searchProvider, setSearchProvider] = useState('spotify')
  const [outputFolderName, setOutputFolderName] = useState('')
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [manualDownloadedTracks, setManualDownloadedTracks] = useState(() => new Set())
  const [ignoredTracks, setIgnoredTracks] = useState(() => new Set())
  const [selected, setSelected] = useState(new Set())
  const [urlHistory, setUrlHistory] = useState([])
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([])
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [completedTransfersOpen, setCompletedTransfersOpen] = useState(false)
  const [pickMode, setPickMode] = useState('quality')
  const [formatPref, setFormatPref] = useState('any')
  const [formatFilters, setFormatFilters] = useState(['mp3', 'wav', 'aiff', 'flac'])
  const [initialSearches, setInitialSearches] = useState([])
  const logRef = useRef(null)
  const downloadSelectedTimers = useRef([])

  // Cargar estado inicial desde SQLite (vía API) al montar
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const playlist = await loadLastPlaylist()
      const history = await loadHistory()
      const prefs = await loadSearchPreferences()
      if (cancelled) return
      setInitialPlaylist(playlist)
      setUrl(playlist.url || '')
      if (cancelled) return
      setOutputFolderName('')
      setTracks(playlist.tracks || [])
      setUrlHistory(history)
      setPickMode(prefs.pickMode)
      setFormatPref(prefs.formatPref)
      setFormatFilters(prefs.formatFilters)
      const cached = await loadSearchCache(playlist.url || '', playlist.tracks || [])
      if (cancelled) return
      setInitialSearches(cached)
      setBootstrapped(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Limpiar timeouts pendientes de descarga masiva al desmontar.
  useEffect(() => {
    return () => {
      downloadSelectedTimers.current.forEach(clearTimeout)
      downloadSelectedTimers.current = []
    }
  }, [])

  // ---- composed hooks ----
  const { navigate, activeTab } = useTabNavigation()
  const { config, setConfig, saveConfig, savingConfig } = useConfig()
  const { diagnostics, fetchDiagnostics } = useDiagnostics()
  const { libraryIndex, fetchLibraryIndex } = useLibraryIndex()
  const { logs, backendOnline } = useLogs()
  const { spotifyAuth, startSpotifyAuth } = useSpotifyAuth()

  const {
    searches, setSearches, searchTrack, autoSearchAll, refreshSearch, cancelSearch,
    getTrackSearch, expandedSearches, collapsedSearches,
    toggleExpandedSearch, toggleCollapsedSearch, collapseTrackResults, resetSearches,
  } = useSearches({
    tracks,
    url,
    initialSearches,
  })

  const { downloads, enqueueDownload, cancelTrackDownload, getTrackDownloads, resetDownloads } = useDownloads({
    tracks,
    outputFolderName,
    playlistKey: url,
    maxConcurrent: config.download_concurrency,
    fetchDiagnostics,
    collapseTrackResults,
  })

  const {
    previews, startPreview, cancelPreview, savePreviewToLibrary, discardActivePreview,
  } = usePreview({ tracks, outputFolderName, playlistKey: url, fetchDiagnostics })

  const {
    newLibraryFolderName, setNewLibraryFolderName, dragOverLibraryFolder, setDragOverLibraryFolder,
    deleteItem, cleanupAll, cancelTransfer, saveTemporaryPreviewToLibrary, moveLibraryFile, renameLibraryFile, createLibraryFolder,
  } = useLibraryOps({ outputFolderName, fetchDiagnostics })

  const embedCoverInFile = useCallback(async (path, coverUrl) => {
    try {
      const response = await request('/api/library/cover/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, cover_url: coverUrl }),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || 'No se pudo insertar la portada')
      await Promise.all([fetchDiagnostics(), fetchLibraryIndex()])
      toast.success('Portada insertada en el archivo')
    } catch (error) {
      toast.error(`No se pudo insertar la portada: ${error.message}`)
    }
  }, [fetchDiagnostics, fetchLibraryIndex])

  const embedDownloadCover = useCallback((download, track) => {
    return embedCoverInFile(download.path, track.cover_url)
  }, [embedCoverInFile])

  const revealFile = useCallback(async (path, dir = 'downloads') => {
    try {
      await requestJson('/api/file/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dir }),
      })
    } catch (error) {
      toast.error(`No se pudo abrir la carpeta: ${error.message}`)
    }
  }, [])

  const searchAndEmbedCover = useCallback(async (path, dir = 'downloads') => {
    try {
      const response = await request('/api/library/cover/search-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dir }),
      })
      const raw = await response.text()
      let data = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        throw new Error('El backend no reconoce esta operación. Reinicia la aplicación con .\\run.ps1.')
      }
      if (!response.ok || data.error) throw new Error(data.error || 'No se encontró portada')
      await Promise.all([fetchDiagnostics(), fetchLibraryIndex()])
      toast.success('Portada encontrada y añadida al archivo')
    } catch (error) {
      toast.error(`No se pudo buscar la portada: ${error.message}`)
    }
  }, [fetchDiagnostics, fetchLibraryIndex])

  const syncLibraryBpm = useCallback(async (path) => {
    try {
      const data = await requestJson('/api/library/bpm/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      await Promise.all([fetchDiagnostics(), fetchLibraryIndex()])
      toast.success(`BPM ${data.bpm} guardado en el archivo`)
    } catch (error) {
      toast.error(`No se pudo guardar el BPM: ${error.message}`)
    }
  }, [fetchDiagnostics, fetchLibraryIndex])

  const updateLibraryBpm = useCallback(async (path, bpm) => {
    try {
      const data = await requestJson('/api/library/bpm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, bpm }),
      })
      await Promise.all([fetchDiagnostics(), fetchLibraryIndex()])
      toast.success(`BPM ${data.bpm} guardado en el archivo`)
    } catch (error) {
      toast.error(`No se pudo guardar el BPM: ${error.message}`)
    }
  }, [fetchDiagnostics, fetchLibraryIndex])

  const searchAndUpdateMetadata = useCallback(async (path) => {
    try {
      const data = await requestJson('/api/library/metadata/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      await Promise.all([fetchDiagnostics(), fetchLibraryIndex()])
      toast.success(`Metadata guardada: ${data.track_name}`)
    } catch (error) {
      toast.error(`No se pudo buscar metadata: ${error.message}`)
    }
  }, [fetchDiagnostics, fetchLibraryIndex])

  const updateLibraryMetadata = useCallback(async (path, trackName, artists) => {
    try {
      const data = await requestJson('/api/library/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, track_name: trackName, artists }),
      })
      await Promise.all([fetchDiagnostics(), fetchLibraryIndex()])
      toast.success(`Metadata actualizada: ${data.track_name}`)
    } catch (error) {
      toast.error(`No se pudo actualizar la metadata: ${error.message}`)
    }
  }, [fetchDiagnostics, fetchLibraryIndex])

  // ---- effects: playlist persistence & preferences ----
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // Guardar playlist actual cuando cambia
  useEffect(() => {
    if (url && tracks.length > 0) {
      saveLastPlaylist({ url, tracks, outputFolderName })
    }
  }, [url, tracks, outputFolderName])

  useEffect(() => {
    if (!url) return undefined
    let cancelled = false
    requestJson(`/api/playlist/status?playlist_key=${encodeURIComponent(url)}`)
      .then((data) => {
        if (cancelled) return
        const statuses = data.statuses || {}
        setManualDownloadedTracks(new Set(
          Object.entries(statuses)
            .filter(([, info]) => info && info.downloaded)
            .map(([trackKey]) => trackKey)
        ))
        setIgnoredTracks(new Set(
          Object.entries(statuses)
            .filter(([, info]) => info && info.ignored)
            .map(([trackKey]) => trackKey)
        ))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => {
    if (!bootstrapped) return
    saveSearchPreferences(pickMode, formatPref, formatFilters)
  }, [bootstrapped, pickMode, formatPref, formatFilters])

  // ---- playlist loading ----
  const loadPlaylist = useCallback(async (sourceUrl) => {
    const targetUrl = (sourceUrl || '').trim()
    if (!targetUrl || loading) return
    setUrl(targetUrl)
    setOutputFolderName('')
    resetSearches()
    resetDownloads()
    setLoading(true)
    setError('')
    setTracks([])
    try {
      const r = await request('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, provider: searchProvider }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      const loaded = data.tracks || []
      const cachedSearches = await loadSearchCache(targetUrl, loaded)
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
  }, [loading, searchProvider, resetSearches, resetDownloads, setSearches, urlHistory])

  const preview = (event) => {
    event.preventDefault()
    loadPlaylist(url)
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

  // ---- track interactions ----
  const copy = (q) =>
    navigator.clipboard.writeText(q).then(() => toast.success('Copiado: ' + q)).catch(() => toast.error('No se pudo copiar'))

  const updateQuery = (i, newQuery) => {
    setTracks((prev) =>
      prev.map((track, index) =>
        index === i ? { ...track, search_query: newQuery } : track
      )
    )
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
    downloadSelectedTimers.current.forEach(clearTimeout)
    downloadSelectedTimers.current = []
    list.forEach((i, n) => {
      const s = getTrackSearch(i)
      const results = rankResults(s?.raw?.results || [], s?.query, pickMode, formatPref, formatFilters)
      const best = pickBest(results, pickMode, formatPref, formatFilters)
      if (best) {
        const id = setTimeout(() => enqueueDownload(i, best), n * 400)
        downloadSelectedTimers.current.push(id)
      }
    })
  }

  const isTrackDownloaded = (track) => {
    const trackKey = getSpotifyTrackId(track.spotify_url)
    // Búsqueda Soulseek de texto libre: track_name es el propio texto buscado,
    // no un track real; el estado "descargada" solo aplica a tracks de Spotify.
    if (!trackKey) return false
    if (libraryIndex?.[trackKey]) return true
    if (diagnostics?.library_index?.[trackKey]) return true
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

  const toggleIgnored = async (track, trackIndex) => {
    if (!url) return
    const key = trackIdentity(track)
    const wasIgnored = ignoredTracks.has(key)
    const ignored = !wasIgnored
    setIgnoredTracks((current) => {
      const next = new Set(current)
      if (ignored) next.add(key)
      else next.delete(key)
      return next
    })
    try {
      await requestJson('/api/playlist/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist_key: url, track_key: key, ignored }),
      })
      toast[ignored ? 'info' : 'info'](ignored ? `Ignorada: ${track.track_name}` : `Restaurada: ${track.track_name}`)
    } catch (err) {
      setIgnoredTracks((current) => {
        const next = new Set(current)
        if (wasIgnored) next.add(key)
        else next.delete(key)
        return next
      })
      toast.error('No se pudo guardar el estado: ' + err.message)
    }
  }

  const selectHistory = async (selectedUrl) => {
    const saved = urlHistory.find((item) => item.url === selectedUrl)
    if (saved) {
      setUrl(saved.url)
      setOutputFolderName('')
    }
  }

  const clearHistory = () => {
    setUrlHistory([])
    saveHistory([])
  }

  const storedFileUrl = (dir, path) =>
    `/api/file/download?dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`

  const storedFileStreamUrl = (dir, path) =>
    `/api/file/stream?dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`

  const refreshLibrary = () => fetchDiagnostics()

  // ---- derived values for the library / temporales panels ----
  const libraryFiles = useMemo(
    () => (diagnostics?.downloads || []).filter(isLibraryFile).sort((a, b) => a.path.localeCompare(b.path)),
    [diagnostics]
  )
  const libraryFolders = diagnostics?.download_directories || []
  const localPlaylists = [...new Set([
    ...libraryFolders,
    ...libraryFiles.map((file) => file.path),
  ].map((path) => String(path).split('/').filter(Boolean)[0]).filter((name) => name && !['temp', '.incomplete'].includes(name.toLowerCase())))].sort((a, b) => a.localeCompare(b))
  const coverByPath = useMemo(() => {
    const map = {}
    if (libraryIndex) {
      for (const entry of Object.values(libraryIndex)) {
        if (entry?.path) map[entry.path] = entry.cover_url || ''
      }
    }
    return map
  }, [libraryIndex])
  const coverSourceByPath = useMemo(() => {
    const map = {}
    if (libraryIndex) {
      for (const entry of Object.values(libraryIndex)) {
        if (entry?.path) map[entry.path] = entry.cover_source_url || ''
      }
    }
    return map
  }, [libraryIndex])
  const bpmByPath = useMemo(() => {
    const map = {}
    if (libraryIndex) {
      for (const entry of Object.values(libraryIndex)) {
        if (entry?.path) map[entry.path] = entry.bpm || null
      }
    }
    return map
  }, [libraryIndex])
  const _isSpotifyTrackKey = (trackKey) => typeof trackKey === 'string' && trackKey.length === 22 && !trackKey.includes(':')

  const metadataByPath = useMemo(() => {
    const map = {}
    if (libraryIndex) {
      for (const entry of Object.values(libraryIndex)) {
        const path = entry?.path
        if (!path) continue
        const existing = map[path]
        if (!existing) {
          map[path] = { trackName: entry.track_name || '', artists: entry.artists || '', __trackKey: entry.track_key || '' }
          continue
        }
        const existingComplete = existing.trackName.trim() && existing.artists.trim()
        const currentComplete = (entry.track_name || '').trim() && (entry.artists || '').trim()
        const existingIsSpotify = _isSpotifyTrackKey(existing.__trackKey)
        const currentIsSpotify = _isSpotifyTrackKey(entry.track_key)
        if (currentIsSpotify && !existingIsSpotify) {
          map[path] = { trackName: entry.track_name || '', artists: entry.artists || '', __trackKey: entry.track_key || '' }
        } else if (currentComplete && !existingComplete) {
          map[path] = { trackName: entry.track_name || '', artists: entry.artists || '', __trackKey: entry.track_key || '' }
        }
      }
    }
    return map
  }, [libraryIndex])
  const previewFiles = diagnostics?.previews || []
  const previewPages = Math.max(1, Math.ceil(previewFiles.length / PREVIEW_PAGE_SIZE))
  const currentPreviewPage = Math.min(previewPage, previewPages)
  const visiblePreviewFiles = previewFiles.slice((currentPreviewPage - 1) * PREVIEW_PAGE_SIZE, currentPreviewPage * PREVIEW_PAGE_SIZE)
  const downloadEntries = useMemo(
    () => Object.values(downloads).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []),
    [downloads]
  )
  const queuedDownloadCount = downloadEntries.filter((download) => download.state === 'encolando').length
  const activeDownloadCount = downloadEntries.filter((download) => download.state === 'descargando').length
  const pendingDownloadCount = queuedDownloadCount + activeDownloadCount
  const activeSearchCount = searches.filter(
    (s) => s.searchId && !s.raw?.isComplete && !['completed', 'complete', 'finished', 'failed', 'error', 'cancelled', 'canceled'].includes(String(s.status || '').toLowerCase())
  ).length
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
          activeSearchCount={activeSearchCount}
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
              searchProvider={searchProvider}
              onSearchProviderChange={setSearchProvider}
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
            spotifyAuth={spotifyAuth}
            onStartSpotifyAuth={startSpotifyAuth}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            config={config}
            onChange={setConfig}
            onSave={saveConfig}
            saving={savingConfig}
            open
          />
        )}

        {activeTab === 'main' && (
          <RecommendConfig
            pickMode={pickMode}
            onPickModeChange={setPickMode}
            formatPref={formatPref}
            onFormatPrefChange={setFormatPref}
            formatFilters={formatFilters}
            onFormatFiltersChange={setFormatFilters}
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
              localPlaylists={localPlaylists}
              formatFilters={formatFilters}
              loading={loading}
              selected={selected}
              onSelectAll={selectAll}
              onDownloadSelected={downloadSelected}
              onAutoSearchAll={autoSearchAll}
              getTrackSearch={getTrackSearch}
              isTrackDownloaded={isTrackDownloaded}
              manualDownloadedTracks={manualDownloadedTracks}
              ignoredTracks={ignoredTracks}
              trackIdentity={trackIdentity}
              getTrackDownloads={getTrackDownloads}
              getSpotifyTrackId={getSpotifyTrackId}
              onToggleSelect={toggleSelect}
              onToggleManualDownloaded={toggleManualDownloaded}
              onToggleIgnored={toggleIgnored}
              onUpdateQuery={updateQuery}
              onCopy={copy}
              onSearchTrack={searchTrack}
              pickMode={pickMode}
              formatPref={formatPref}
              expandedSearches={expandedSearches}
              onToggleExpandedSearch={toggleExpandedSearch}
              collapsedSearches={collapsedSearches}
              onToggleCollapsedSearch={toggleCollapsedSearch}
              previews={previews}
              onStartPreview={startPreview}
              onSavePreview={savePreviewToLibrary}
              onDiscardPreview={discardActivePreview}
              onCancelPreview={cancelPreview}
              storedFileStreamUrl={storedFileStreamUrl}
              storedFileUrl={storedFileUrl}
              onCancelDownload={cancelTrackDownload}
              onEmbedCover={embedDownloadCover}
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
                coverByPath={coverByPath}
                coverSourceByPath={coverSourceByPath}
                onEmbedCover={embedCoverInFile}
                onSearchCover={searchAndEmbedCover}
                onRenameFile={renameLibraryFile}
                onRevealFile={(path) => revealFile(path, 'downloads')}
                bpmByPath={bpmByPath}
                onSyncBpm={syncLibraryBpm}
                onUpdateBpm={updateLibraryBpm}
                metadataByPath={metadataByPath}
                onUpdateMetadata={updateLibraryMetadata}
                onSearchMetadata={searchAndUpdateMetadata}
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
                localPlaylists={localPlaylists}
                onSearchCover={(path) => searchAndEmbedCover(path, 'previews')}
                onRevealFile={(path) => revealFile(path, 'previews')}
                onDeleteFile={deleteItem}
              />
            </div>
          </div>
        </div>
        <AppFooter />
        <ToastContainer
          position="top-left"
          autoClose={6000}
          theme="dark"
          newestOnTop
          closeOnClick
          pauseOnFocusLoss
          draggable
          limit={4}
          closeButton={false}
        />
      </div>
    </div>
  )
}

export default App
