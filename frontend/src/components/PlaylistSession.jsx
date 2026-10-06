import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { request, requestJson } from '../api/client'
import PlaylistSelectModal from './PlaylistSelectModal'
import TrackList from './TrackList'
import { isLibraryFile } from '../constants'
import { pickBest, rankResults } from '../utils/resultPicker'
import { getSpotifyTrackId, matchesLibraryFile, trackIdentity } from '../utils/spotify'
import { loadPlaylistSnapshot, loadSearchCache, savePlaylistSnapshot } from '../utils/storage'
import { useDownloads } from '../hooks/useDownloads'
import { usePreview } from '../hooks/usePreview'
import { useSearches } from '../hooks/useSearches'

const TERMINAL_SEARCH_STATUSES = ['completed', 'complete', 'finished', 'failed', 'error', 'cancelled', 'canceled']

// Una sesión = una pestaña de playlist. Se mantiene montada aunque no sea la
// pestaña activa para que búsquedas/descargas sigan en segundo plano.
export default function PlaylistSession({
  session,           // { key, url, provider, name }
  active,
  refreshTick,       // al cambiar, recarga la playlist desde el origen
  initialSnapshot,   // snapshot precargado (opcional)
  onMeta,            // (key, meta) => reporta nombre/stats para la barra de tabs
  onRegister,        // (key, handlers) => registra quickSave para SourceInput
  onHistoryAdd,      // ({url, name}) => añade al historial
  config,
  diagnostics,
  libraryIndex,
  fetchDiagnostics,
  localPlaylists,
  folderOverrides,
  rememberFolderOverride,
  pickMode,
  formatPref,
  formatFilters,
  saveTemporaryPreviewToLibrary,
  embedCoverInFile,
  storedFileUrl,
  storedFileStreamUrl,
}) {
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [manualDownloadedTracks, setManualDownloadedTracks] = useState(() => new Set())
  const [ignoredTracks, setIgnoredTracks] = useState(() => new Set())
  const [outputFolderName, setOutputFolderName] = useState('')
  const [currentPlaylistName, setCurrentPlaylistName] = useState(session.name || '')
  const [initialSearches, setInitialSearches] = useState([])
  const [missingFolder, setMissingFolder] = useState(null)   // { save, folder, playlistName }
  const [relocateFolder, setRelocateFolder] = useState(null) // { save, playlistName }
  const downloadSelectedTimers = useRef([])
  const snapshotPromiseRef = useRef(null)
  const prevRefreshTickRef = useRef(refreshTick)

  const {
    searches, setSearches, searchTrack, autoSearchAll, refreshSearch, cancelSearch,
    getTrackSearch, expandedSearches, collapsedSearches,
    toggleExpandedSearch, toggleCollapsedSearch, collapseTrackResults, resetSearches,
  } = useSearches({
    tracks,
    url: session.url,
    initialSearches,
  })

  const {
    previews, startPreview, cancelPreview, savePreviewToLibrary, discardActivePreview,
  } = usePreview({ tracks, outputFolderName, playlistKey: session.url, fetchDiagnostics })

  // No colapsar los resultados de un track con preview activo: el reproductor
  // desaparecería/cortaría el audio al terminar la descarga.
  const hasTrackPreview = useCallback((i) => {
    const results = getTrackSearch(i)?.raw?.results || []
    return results.some((res) => {
      const preview = previews[`${res.username}|${res.filename}`]
      return preview && preview.state !== 'error'
    })
  }, [getTrackSearch, previews])

  const collapseResultsIfNoPreview = useCallback((i) => {
    if (!hasTrackPreview(i)) collapseTrackResults(i)
  }, [hasTrackPreview, collapseTrackResults])

  const { downloads, enqueueDownload, cancelTrackDownload, getTrackDownloads, resetDownloads } = useDownloads({
    tracks,
    outputFolderName,
    playlistKey: session.url,
    maxConcurrent: config.download_concurrency,
    fetchDiagnostics,
    collapseTrackResults: collapseResultsIfNoPreview,
  })

  // ---- carga de la playlist desde el origen (Spotify / texto) ----
  const fetchPlaylist = useCallback(async () => {
    if (loading) return
    resetSearches()
    resetDownloads()
    setLoading(true)
    setError('')
    setTracks([])
    try {
      const r = await request('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: session.url, provider: session.provider }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      const loaded = data.tracks || []
      setCurrentPlaylistName(data.source === 'spotify' ? (data.playlist_name || '') : (data.playlist_name || ''))
      const cachedSearches = await loadSearchCache(session.url, loaded)
      setSearches(cachedSearches)
      setTracks(loaded)
      setSelected(new Set(loaded.map((_, i) => i)))
      if (data.source !== 'soulseek') {
        onHistoryAdd?.({ url: session.url, name: data.playlist_name || session.url })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [loading, session.url, session.provider, resetSearches, resetDownloads, setSearches, onHistoryAdd])

  // ---- bootstrap: restaurar snapshot o cargar desde el origen ----
  // StrictMode ejecuta el efecto dos veces: la promesa del snapshot se guarda
  // en ref para no repetir el fetch, y el primer .then queda cancelado.
  useEffect(() => {
    let cancelled = false
    if (!snapshotPromiseRef.current) {
      snapshotPromiseRef.current = initialSnapshot && Object.keys(initialSnapshot).length > 0
        ? Promise.resolve(initialSnapshot)
        : loadPlaylistSnapshot(session.key)
    }
    snapshotPromiseRef.current.then(async (snapshot) => {
      if (cancelled) return
      const snapshotTracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : []
      if (snapshotTracks.length > 0) {
        setTracks(snapshotTracks)
        setSelected(new Set(snapshotTracks.map((_, i) => i)))
        setOutputFolderName(snapshot.outputFolderName || '')
        setCurrentPlaylistName(snapshot.playlist_name || session.name || '')
        const cached = await loadSearchCache(session.url, snapshotTracks)
        if (cancelled) return
        setInitialSearches(cached)
      } else {
        fetchPlaylist()
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- refresh manual desde la barra de tabs ----
  useEffect(() => {
    if (prevRefreshTickRef.current === refreshTick) return
    prevRefreshTickRef.current = refreshTick
    fetchPlaylist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  // ---- persistir snapshot de la pestaña ----
  useEffect(() => {
    if (tracks.length === 0) return
    savePlaylistSnapshot(session.key, {
      url: session.url,
      provider: session.provider,
      tracks,
      playlist_name: currentPlaylistName,
      outputFolderName,
    })
  }, [session.key, session.url, session.provider, tracks, currentPlaylistName, outputFolderName])

  // ---- estado descargada/ignorada por track ----
  useEffect(() => {
    if (!session.url) return undefined
    let cancelled = false
    requestJson(`/api/playlist/status?playlist_key=${encodeURIComponent(session.url)}`)
      .then((data) => {
        if (cancelled) return
        const statuses = data.statuses || {}
        setManualDownloadedTracks(new Set(
          Object.entries(statuses).filter(([, info]) => info && info.downloaded).map(([trackKey]) => trackKey)
        ))
        setIgnoredTracks(new Set(
          Object.entries(statuses).filter(([, info]) => info && info.ignored).map(([trackKey]) => trackKey)
        ))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session.url])

  // Limpiar timeouts pendientes de descarga masiva al desmontar (cerrar tab).
  useEffect(() => {
    return () => {
      downloadSelectedTimers.current.forEach(clearTimeout)
      downloadSelectedTimers.current = []
    }
  }, [])

  // ---- guardado rápido: carpeta destino de esta playlist ----
  const quickSaveFolder = currentPlaylistName
    ? (folderOverrides[currentPlaylistName] || currentPlaylistName)
    : ''

  const quickSavePreview = (preview) => {
    if (!quickSaveFolder) return
    const existing = localPlaylists.find(
      (name) => name.toLowerCase() === quickSaveFolder.toLowerCase()
    )
    if (existing) {
      savePreviewToLibrary(preview, existing)
    } else {
      setMissingFolder({
        save: (folder) => savePreviewToLibrary(preview, folder),
        folder: quickSaveFolder,
        playlistName: currentPlaylistName,
      })
    }
  }

  const quickSaveTempFile = useCallback((path) => {
    if (!quickSaveFolder) return false
    const existing = localPlaylists.find(
      (name) => name.toLowerCase() === quickSaveFolder.toLowerCase()
    )
    if (existing) return saveTemporaryPreviewToLibrary(path, existing)
    setMissingFolder({
      save: (folder) => saveTemporaryPreviewToLibrary(path, folder),
      folder: quickSaveFolder,
      playlistName: currentPlaylistName,
    })
    return true
  }, [quickSaveFolder, localPlaylists, saveTemporaryPreviewToLibrary, currentPlaylistName])

  const saveSpotifyPreviewToLibrary = useCallback(async (preview, folderName) => {
    try {
      const data = await requestJson('/api/spotify/preview/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preview_url: preview.previewUrl,
          track_name: preview.trackName,
          artists: preview.artists,
        }),
      })
      await saveTemporaryPreviewToLibrary(data.path, folderName || quickSaveFolder)
    } catch (error) {
      toast.error(`No se pudo guardar el preview de Spotify: ${error.message}`)
    }
  }, [saveTemporaryPreviewToLibrary, quickSaveFolder])

  const embedDownloadCover = useCallback((download, track) => {
    return embedCoverInFile(download.path, track.cover_url)
  }, [embedCoverInFile])

  // ---- reportar meta a la barra de tabs / navbar ----
  const downloadEntries = Object.values(downloads).flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
  const queuedDownloadCount = downloadEntries.filter((d) => d.state === 'encolando').length
  const activeDownloadCount = downloadEntries.filter((d) => d.state === 'descargando').length
  const activeSearchCount = searches.filter(
    (s) => s.searchId && !s.raw?.isComplete && !TERMINAL_SEARCH_STATUSES.includes(String(s.status || '').toLowerCase())
  ).length
  const displayName = currentPlaylistName || session.name || session.url

  useEffect(() => {
    onMeta?.(session.key, {
      name: displayName,
      loading,
      trackCount: tracks.length,
      queued: queuedDownloadCount,
      active: activeDownloadCount,
      searches: activeSearchCount,
      quickSaveFolder,
    })
  }, [session.key, onMeta, displayName, loading, tracks.length, queuedDownloadCount, activeDownloadCount, activeSearchCount, quickSaveFolder])

  // Registrar el quick-save de temporales para que SourceInput/TemporalesPanel
  // puedan delegar en la carpeta de esta playlist cuando es la tab activa.
  useEffect(() => {
    onRegister?.(session.key, { quickSaveTempFile, quickSaveFolder })
  }, [session.key, onRegister, quickSaveTempFile, quickSaveFolder])

  // ---- interacciones de tracks ----
  const copy = (q) =>
    navigator.clipboard.writeText(q).then(() => toast.success('Copiado: ' + q)).catch(() => toast.error('No se pudo copiar'))

  const updateQuery = (i, newQuery) => {
    setTracks((prev) => prev.map((track, index) => index === i ? { ...track, search_query: newQuery } : track))
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
    if (!trackKey) return false
    if (libraryIndex?.[trackKey]) return true
    if (diagnostics?.library_index?.[trackKey]) return true
    return (diagnostics?.downloads || [])
      .filter(isLibraryFile)
      .some((file) => matchesLibraryFile(track, file))
  }

  const toggleManualDownloaded = async (track, trackIndex) => {
    const key = trackIdentity(track)
    const wasManual = manualDownloadedTracks.has(key)
    const downloaded = !wasManual
    if (downloaded) collapseResultsIfNoPreview(trackIndex)
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
        body: JSON.stringify({ playlist_key: session.url, track_key: key, downloaded }),
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
        body: JSON.stringify({ playlist_key: session.url, track_key: key, ignored }),
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

  return (
    <div className={active ? '' : 'hidden'}>
      {error && (
        <div className="mb-6 rounded-md border border-[#6B7280]/30 bg-[#6B7280]/10 px-4 py-2.5 text-sm text-[#6B7280]">
          {error}
        </div>
      )}
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
        quickSaveLabel={quickSaveFolder}
        onQuickSavePreview={quickSavePreview}
        onDiscardPreview={discardActivePreview}
        onCancelPreview={cancelPreview}
        onSaveSpotifyPreview={saveSpotifyPreviewToLibrary}
        storedFileStreamUrl={storedFileStreamUrl}
        storedFileUrl={storedFileUrl}
        onCancelDownload={cancelTrackDownload}
        onEmbedCover={embedDownloadCover}
        onRefreshSearch={refreshSearch}
        onCancelSearch={cancelSearch}
      />
      {missingFolder && (
        <div
          className="fixed inset-0 z-[280] flex items-center justify-center bg-[#000000]/70 p-4 backdrop-blur-sm"
          onClick={() => setMissingFolder(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-[#2C303D] bg-[#12141D] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[#E9EAF0]">
              No encontré la carpeta “{missingFolder.folder}”
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#8D93A6]">
              La playlist “{missingFolder.playlistName}” todavía no tiene carpeta en la biblioteca.
              Podés crearla ahora o ubicar una existente — si ubicás otra, el botón
              “guardar” de esta playlist va a usar siempre esa carpeta.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setMissingFolder(null)}
                className="rounded-full border border-[#3A3F4E] px-4 py-1.5 text-xs font-medium text-[#D5D7DE] transition-colors hover:border-[#FFFFFF]/50 hover:text-[#FFFFFF]"
              >
                cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setRelocateFolder({ save: missingFolder.save, playlistName: missingFolder.playlistName })
                  setMissingFolder(null)
                }}
                className="rounded-full border border-[#3A3F4E] px-4 py-1.5 text-xs font-medium text-[#D5D7DE] transition-colors hover:border-[#FFFFFF]/50 hover:text-[#FFFFFF]"
              >
                elegir otra carpeta
              </button>
              <button
                type="button"
                onClick={() => {
                  missingFolder.save(missingFolder.folder)
                  setMissingFolder(null)
                }}
                className="rounded-full bg-[#1DB954] px-4 py-1.5 text-xs font-semibold text-[#0D0F16] transition-colors hover:bg-[#1ed760]"
              >
                crear y guardar
              </button>
            </div>
          </div>
        </div>
      )}
      <PlaylistSelectModal
        open={Boolean(relocateFolder)}
        playlists={localPlaylists}
        title="Elegir carpeta destino"
        subtitle={relocateFolder ? `Para la playlist “${relocateFolder.playlistName}”` : ''}
        allowEmpty={false}
        onClose={() => setRelocateFolder(null)}
        onSelect={(playlist) => {
          if (relocateFolder && playlist) {
            rememberFolderOverride(relocateFolder.playlistName, playlist)
            relocateFolder.save(playlist)
          }
          setRelocateFolder(null)
        }}
      />
    </div>
  )
}
