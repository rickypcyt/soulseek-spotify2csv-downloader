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
  getOutputFolderPreference,
  loadHistory,
  loadLastPlaylist,
  loadSearchCache,
  loadSearchPreferences,
  saveHistory,
  saveLastPlaylist,
  saveSearchPreferences,
  setOutputFolderPreference,
} from './utils/storage'
import { useConfig } from './hooks/useConfig'
import { useDiagnostics } from './hooks/useDiagnostics'
import { useDownloads } from './hooks/useDownloads'
import { useLibraryOps } from './hooks/useLibraryOps'
import { useLogs } from './hooks/useLogs'
import { usePreview } from './hooks/usePreview'
import { useSearches } from './hooks/useSearches'
import { useSpotifyAuth } from './hooks/useSpotifyAuth'
import { useTabNavigation } from './hooks/useTabNavigation'

function App() {
  const [initialPlaylist] = useState(loadLastPlaylist)
  const [url, setUrl] = useState(() => initialPlaylist.url || '')
  const [outputFolderName, setOutputFolderName] = useState(
    () => getOutputFolderPreference(initialPlaylist.url) ?? initialPlaylist.outputFolderName ?? ''
  )
  const [tracks, setTracks] = useState(() => initialPlaylist.tracks || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [manualDownloadedTracks, setManualDownloadedTracks] = useState(() => new Set())
  const [selected, setSelected] = useState(new Set())
  const [urlHistory, setUrlHistory] = useState(loadHistory)
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([])
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [completedTransfersOpen, setCompletedTransfersOpen] = useState(false)
  const [searchPreferences] = useState(loadSearchPreferences)
  const [pickMode, setPickMode] = useState(() => searchPreferences.pickMode)
  const [formatPref, setFormatPref] = useState(() => searchPreferences.formatPref)
  const logRef = useRef(null)

  // ---- composed hooks ----
  const { navigate, activeTab } = useTabNavigation()
  const { config, setConfig, saveConfig, savingConfig } = useConfig()
  const { diagnostics, fetchDiagnostics } = useDiagnostics()
  const { logs, backendOnline } = useLogs()
  const { spotifyAuth, startSpotifyAuth } = useSpotifyAuth()

  const {
    setSearches, searchTrack, autoSearchAll, refreshSearch, cancelSearch,
    getTrackSearch, expandedSearches, collapsedSearches,
    toggleExpandedSearch, toggleCollapsedSearch, collapseTrackResults, resetSearches,
  } = useSearches({
    tracks,
    url,
    initialAutoSearchDone: (initialPlaylist.tracks || []).length > 0,
    initialSearches: useMemo(
      () => loadSearchCache(initialPlaylist.url || '', initialPlaylist.tracks || []),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    ),
  })

  const { downloads, enqueueDownload, cancelTrackDownload, getTrackDownloads, resetDownloads } = useDownloads({
    tracks,
    outputFolderName,
    fetchDiagnostics,
    collapseTrackResults,
  })

  const {
    activePreview, startPreview, cancelPreview, savePreviewToLibrary, discardActivePreview,
  } = usePreview({ tracks, outputFolderName, fetchDiagnostics })

  const {
    newLibraryFolderName, setNewLibraryFolderName, dragOverLibraryFolder, setDragOverLibraryFolder,
    deleteItem, cleanupAll, cancelTransfer, saveTemporaryPreviewToLibrary, moveLibraryFile, createLibraryFolder,
  } = useLibraryOps({ outputFolderName, fetchDiagnostics })

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
    setOutputFolderPreference(url, outputFolderName)
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
    saveSearchPreferences(pickMode, formatPref)
  }, [pickMode, formatPref])

  // ---- playlist loading ----
  const loadPlaylist = useCallback(async (sourceUrl) => {
    const targetUrl = (sourceUrl || '').trim()
    if (!targetUrl || loading) return
    const savedOutputFolder = getOutputFolderPreference(targetUrl)
    setUrl(targetUrl)
    setOutputFolderName(savedOutputFolder ?? '')
    resetSearches()
    resetDownloads()
    setLoading(true)
    setError('')
    setTracks([])
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
  }, [loading, resetSearches, resetDownloads, setSearches, urlHistory])

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
    list.forEach((i, n) => {
      const s = getTrackSearch(i)
      const results = rankResults(s?.raw?.results || [], s?.query, pickMode, formatPref)
      const best = pickBest(results, pickMode, formatPref)
      if (best) setTimeout(() => enqueueDownload(i, best), n * 400)
    })
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
