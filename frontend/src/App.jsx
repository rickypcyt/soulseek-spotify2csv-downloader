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
import PlaylistSession from './components/PlaylistSession'
import PlaylistTabBar from './components/PlaylistTabBar'
import RecommendConfig from './components/RecommendConfig'
import SettingsPanel from './components/SettingsPanel'
import SourceInput from './components/SourceInput'
import TemporalesPanel from './components/TemporalesPanel'
import TransfersPanel from './components/TransfersPanel'
import WelcomeWizard from './components/WelcomeWizard'
import { FONT_BODY, isCompletedTransfer, isLibraryFile } from './constants'
import {
  loadHistory,
  loadLastPlaylist,
  loadPlaylistTabs,
  loadSearchPreferences,
  saveHistory,
  savePlaylistTabs,
  deletePlaylistSnapshot,
  saveSearchPreferences,
} from './utils/storage'
import { useConfig } from './hooks/useConfig'
import { useDiagnostics } from './hooks/useDiagnostics'
import { useLibraryIndex } from './hooks/useLibraryIndex'
import { useLibraryOps } from './hooks/useLibraryOps'
import { useLogs } from './hooks/useLogs'
import { useSpotifyAuth } from './hooks/useSpotifyAuth'
import { useTabNavigation } from './hooks/useTabNavigation'

const playlistTabKey = (provider, url) => `${provider || 'spotify'}::${url}`

function App() {
  const [bootstrapped, setBootstrapped] = useState(false)
  const [inputUrl, setInputUrl] = useState('')
  const [searchProvider, setSearchProvider] = useState('spotify')
  const [urlHistory, setUrlHistory] = useState([])
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([])
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false)
  // Carpeta elegida manualmente para una playlist (override del nombre).
  const [folderOverrides, setFolderOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem('playlist_folder_overrides') || '{}') } catch { return {} }
  })

  const [completedTransfersOpen, setCompletedTransfersOpen] = useState(false)
  const [pickMode, setPickMode] = useState('quality')
  const [formatPref, setFormatPref] = useState('any')
  const [formatFilters, setFormatFilters] = useState(['mp3', 'wav', 'aiff', 'flac'])
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => localStorage.getItem('welcome_dismissed') === '1'
  )
  // ---- playlist tabs ----
  const [playlistTabs, setPlaylistTabs] = useState([])
  const [activePlaylistKey, setActivePlaylistKey] = useState(null)
  const [tabRefreshTicks, setTabRefreshTicks] = useState({})
  const [sessionMeta, setSessionMeta] = useState({})
  const [seededSnapshots, setSeededSnapshots] = useState({})
  const sessionHandlers = useRef({})
  const logRef = useRef(null)

  // Cargar estado inicial desde SQLite (vía API) al montar
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tabsData, playlist, history, prefs] = await Promise.all([
        loadPlaylistTabs(),
        loadLastPlaylist(),
        loadHistory(),
        loadSearchPreferences(),
      ])
      if (cancelled) return
      if (tabsData.tabs.length > 0) {
        setPlaylistTabs(tabsData.tabs)
        const active = tabsData.tabs.some((t) => t.key === tabsData.active)
          ? tabsData.active
          : tabsData.tabs[0].key
        setActivePlaylistKey(active)
        const activeTab = tabsData.tabs.find((t) => t.key === active)
        if (activeTab) setInputUrl(activeTab.url)
      } else if (playlist.url) {
        // Migración: la última playlist abierta se convierte en la primera tab.
        const key = playlistTabKey(playlist.provider || 'spotify', playlist.url)
        const tab = { key, url: playlist.url, provider: playlist.provider || 'spotify', name: playlist.playlist_name || '' }
        setPlaylistTabs([tab])
        setActivePlaylistKey(key)
        setInputUrl(playlist.url)
        setSeededSnapshots({ [key]: playlist })
      }
      setUrlHistory(history)
      setPickMode(prefs.pickMode)
      setFormatPref(prefs.formatPref)
      setFormatFilters(prefs.formatFilters)
      setBootstrapped(true)
    })()
    return () => { cancelled = true }
  }, [])

  // ---- composed hooks ----
  const { navigate, activeTab } = useTabNavigation()
  const { config, setConfig, saveConfig, savingConfig, configLoaded } = useConfig()
  const { diagnostics, fetchDiagnostics } = useDiagnostics()
  const libraryActive = Object.values(sessionMeta).some(
    (m) => (m?.queued || 0) + (m?.active || 0) + (m?.searches || 0) > 0
  ) || (diagnostics?.transfers || []).some((t) => !isCompletedTransfer(t))
  const { libraryIndex, fetchLibraryIndex } = useLibraryIndex({ active: libraryActive })
  const { logs, backendOnline } = useLogs()
  const { spotifyAuth, startSpotifyAuth } = useSpotifyAuth()

  const {
    newLibraryFolderName, setNewLibraryFolderName, dragOverLibraryFolder, setDragOverLibraryFolder,
    deleteItem, cleanupAll, cancelTransfer, saveTemporaryPreviewToLibrary, moveLibraryFile, renameLibraryFile, createLibraryFolder,
  } = useLibraryOps({ fetchDiagnostics })

  // ---- playlist tabs ----
  const openPlaylist = useCallback((rawUrl, provider) => {
    const target = (rawUrl || '').trim()
    if (!target) return
    const key = playlistTabKey(provider, target)
    setPlaylistTabs((prev) => {
      if (prev.some((t) => t.key === key)) return prev
      return [...prev, { key, url: target, provider: provider || 'spotify', name: '' }]
    })
    setActivePlaylistKey(key)
    setInputUrl(target)
  }, [])

  const selectPlaylistTab = useCallback((key) => {
    setActivePlaylistKey(key)
    const tab = playlistTabs.find((t) => t.key === key)
    if (tab) setInputUrl(tab.url)
    if (activeTab !== 'main') navigate('/')
  }, [playlistTabs, activeTab, navigate])

  const closePlaylistTab = useCallback((key) => {
    const index = playlistTabs.findIndex((t) => t.key === key)
    const next = playlistTabs.filter((t) => t.key !== key)
    if (activePlaylistKey === key) {
      const fallback = next[Math.min(Math.max(index, 0), next.length - 1)]
      setActivePlaylistKey(fallback ? fallback.key : null)
      setInputUrl(fallback ? fallback.url : '')
    }
    setPlaylistTabs(next)
    delete sessionHandlers.current[key]
    setSessionMeta((prev) => {
      const nextMeta = { ...prev }
      delete nextMeta[key]
      return nextMeta
    })
    deletePlaylistSnapshot(key)
  }, [playlistTabs, activePlaylistKey])

  const refreshPlaylistTab = useCallback((key) => {
    setTabRefreshTicks((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }))
  }, [])

  const handleSessionMeta = useCallback((key, meta) => {
    setSessionMeta((prev) => {
      const current = prev[key]
      if (current
        && current.name === meta.name
        && current.loading === meta.loading
        && current.trackCount === meta.trackCount
        && current.queued === meta.queued
        && current.active === meta.active
        && current.searches === meta.searches
        && current.quickSaveFolder === meta.quickSaveFolder) {
        return prev
      }
      return { ...prev, [key]: meta }
    })
  }, [])

  const handleSessionRegister = useCallback((key, handlers) => {
    sessionHandlers.current[key] = handlers
  }, [])

  const handleHistoryAdd = useCallback((entry) => {
    if (!entry?.url) return
    setUrlHistory((prev) => {
      const next = [entry, ...prev.filter((item) => item.url !== entry.url)]
      queueMicrotask(() => saveHistory(next))
      return next
    })
  }, [])

  // Persistir tabs abiertas + activa.
  useEffect(() => {
    if (!bootstrapped) return
    savePlaylistTabs(playlistTabs, activePlaylistKey)
  }, [bootstrapped, playlistTabs, activePlaylistKey])

  // ---- effects ----
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    if (!bootstrapped) return
    saveSearchPreferences(pickMode, formatPref, formatFilters)
  }, [bootstrapped, pickMode, formatPref, formatFilters])

  // ---- playlist loading / picking ----
  const preview = (event) => {
    event.preventDefault()
    openPlaylist(inputUrl, searchProvider)
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

  const convertLibraryFileToFlac = useCallback(async (path) => {
    try {
      await requestJson('/api/library/convert-flac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      await Promise.all([fetchDiagnostics(), fetchLibraryIndex()])
      toast.success('Archivo convertido a FLAC')
    } catch (error) {
      toast.error(`No se pudo convertir a FLAC: ${error.message}`)
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

  const selectHistory = async (selectedUrl) => {
    const saved = urlHistory.find((item) => item.url === selectedUrl)
    if (saved) setInputUrl(saved.url)
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

  const validateSoulseek = useCallback(async (username, password) => {
    const data = await requestJson('/api/config/validate-soulseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    fetchDiagnostics()
    return data
  }, [fetchDiagnostics])

  const rememberFolderOverride = (playlistName, folder) => {
    setFolderOverrides((current) => {
      const next = { ...current, [playlistName]: folder }
      try { localStorage.setItem('playlist_folder_overrides', JSON.stringify(next)) } catch {}
      return next
    })
  }

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

  // Guardado rápido de temporales desde SourceInput: usa la carpeta de la tab activa.
  const activeSessionMeta = activePlaylistKey ? sessionMeta[activePlaylistKey] : null
  const quickSaveTempFromInput = (path) => {
    const handler = sessionHandlers.current[activePlaylistKey]
    if (!handler) return false
    return handler.quickSaveTempFile(path)
  }

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
  const queuedDownloadCount = Object.values(sessionMeta).reduce((sum, m) => sum + (m?.queued || 0), 0)
  const activeDownloadCount = Object.values(sessionMeta).reduce((sum, m) => sum + (m?.active || 0), 0)
  const pendingDownloadCount = queuedDownloadCount + activeDownloadCount
  const activeSearchCount = Object.values(sessionMeta).reduce((sum, m) => sum + (m?.searches || 0), 0)
  const transfers = diagnostics?.transfers || []
  const activeTransfers = transfers.filter((transfer) => !isCompletedTransfer(transfer))
  const completedTransfers = transfers.filter(isCompletedTransfer)

  return (
    <div
      className="min-h-screen bg-[#10121A] text-[#E9EAF0]"
      style={{ fontFamily: FONT_BODY }}
    >
      <div className="w-full px-5 py-8 sm:px-10 sm:py-10">
        {/* Barra superior fija: navegación + tabs de playlists siempre visibles */}
        <div className="sticky top-0 z-30 mb-8 bg-[#10121A] pb-2">
          <AppNavbar
            activeTab={activeTab}
            navigate={navigate}
            libraryCount={libraryFiles.length}
            pendingDownloadCount={pendingDownloadCount}
            queuedDownloadCount={queuedDownloadCount}
            activeDownloadCount={activeDownloadCount}
            activeSearchCount={activeSearchCount}
          />
          <PlaylistTabBar
            tabs={playlistTabs}
            activeKey={activePlaylistKey}
            meta={sessionMeta}
            onSelect={selectPlaylistTab}
            onClose={closePlaylistTab}
            onRefresh={refreshPlaylistTab}
          />
        </div>

        {activeTab === 'main' && (
          <>
            <SourceInput
              url={inputUrl}
              onUrlChange={setInputUrl}
              loading={false}
              onSubmit={preview}
              onLoadSpotifyPlaylists={loadSpotifyPlaylists}
              spotifyAuthStatus={spotifyAuth.status}
              searchProvider={searchProvider}
              onSearchProviderChange={setSearchProvider}
              urlHistory={urlHistory}
              onSelectHistory={selectHistory}
              onClearHistory={clearHistory}
              onDownloadCompleted={fetchDiagnostics}
              localPlaylists={localPlaylists}
              quickSaveLabel={activeSessionMeta?.quickSaveFolder || ''}
              onQuickSaveTemp={quickSaveTempFromInput}
              onSaveTemp={saveTemporaryPreviewToLibrary}
              onDeleteTemp={(path) => deleteItem(path, 'previews')}
              storedFileStreamUrl={storedFileStreamUrl}
              storedFileUrl={storedFileUrl}
              onRevealFile={(path) => revealFile(path, 'previews')}
            />
            <PlaylistPicker
              open={playlistPickerOpen}
              playlists={spotifyPlaylists}
              onClose={() => setPlaylistPickerOpen(false)}
              onSelect={(playlistUrl) => {
                setPlaylistPickerOpen(false)
                openPlaylist(playlistUrl, 'spotify')
              }}
            />
          </>
        )}

        {(activeTab === 'settings' || activeTab === 'main') && (
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
            onValidateSoulseek={validateSoulseek}
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
          {/* Las sesiones quedan montadas aunque cambies de tab para que las
              búsquedas y descargas sigan en segundo plano. */}
          <div className={`min-w-0 ${activeTab === 'main' ? '' : 'hidden'}`}>
            {playlistTabs.map((tab) => (
              <PlaylistSession
                key={tab.key}
                session={tab}
                active={activeTab === 'main' && tab.key === activePlaylistKey}
                refreshTick={tabRefreshTicks[tab.key] || 0}
                initialSnapshot={seededSnapshots[tab.key]}
                onMeta={handleSessionMeta}
                onRegister={handleSessionRegister}
                onHistoryAdd={handleHistoryAdd}
                config={config}
                diagnostics={diagnostics}
                libraryIndex={libraryIndex}
                fetchDiagnostics={fetchDiagnostics}
                localPlaylists={localPlaylists}
                folderOverrides={folderOverrides}
                rememberFolderOverride={rememberFolderOverride}
                pickMode={pickMode}
                formatPref={formatPref}
                formatFilters={formatFilters}
                saveTemporaryPreviewToLibrary={saveTemporaryPreviewToLibrary}
                embedCoverInFile={embedCoverInFile}
                storedFileUrl={storedFileUrl}
                storedFileStreamUrl={storedFileStreamUrl}
              />
            ))}
          </div>

          {/* monitor column */}
          <div className={`${activeTab === 'main' ? 'hidden' : activeTab === 'logs' ? 'min-w-0 grid grid-cols-1 gap-4' : 'min-w-0 grid grid-cols-1 gap-4'}`}>
            <div className={`${activeTab === 'library' ? 'flex min-w-0 h-64' : 'hidden'}`}>
              <TransfersPanel
                diagnostics={diagnostics}
                activeTransfers={activeTransfers}
                completedTransfers={completedTransfers}
                completedTransfersOpen={completedTransfersOpen}
                onToggleCompletedTransfers={setCompletedTransfersOpen}
                onCancelTransfer={cancelTransfer}
              />
            </div>

            <div className={`${activeTab === 'library' ? 'flex min-w-0' : 'hidden'}`}>
              <TemporalesPanel
                diagnostics={diagnostics}
                onCleanupAll={cleanupAll}
                previewFiles={previewFiles}
                storedFileStreamUrl={storedFileStreamUrl}
                onSaveTemporaryPreview={saveTemporaryPreviewToLibrary}
                quickSaveLabel={activeSessionMeta?.quickSaveFolder || ''}
                onQuickSave={quickSaveTempFromInput}
                localPlaylists={localPlaylists}
                onSearchCover={(path) => searchAndEmbedCover(path, 'previews')}
                onRevealFile={(path) => revealFile(path, 'previews')}
                onDeleteFile={deleteItem}
              />
            </div>

            <div className={`${activeTab === 'logs' ? 'flex min-w-0' : 'hidden'}`}>
              <LogsPanel ref={logRef} logs={logs} backendOnline={backendOnline} />
            </div>

            <div className={`${activeTab === 'library' ? 'flex min-w-0' : 'hidden'}`}>
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
                onConvertFlac={convertLibraryFileToFlac}
                movePlaylists={localPlaylists}
                onMoveToPlaylist={(path, folder) => moveLibraryFile({ dir: 'downloads', path }, folder)}
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
          </div>
        </div>
        <AppFooter />
        {(() => {
          const setupIncomplete = !config.downloads_dir || !config.soulseek_username ||
            !config.spotify_client_id || !config.spotify_client_secret_configured
          const showWelcome = configLoaded && setupIncomplete && !welcomeDismissed
          return showWelcome && (
            <WelcomeWizard
              config={config}
              onChange={setConfig}
              onSave={saveConfig}
              saving={savingConfig}
              defaultDownloadsDir={diagnostics?.configuration?.downloads?.path}
              spotifyAuth={spotifyAuth}
              onStartSpotifyAuth={startSpotifyAuth}
              onDone={() => {
                localStorage.setItem('welcome_dismissed', '1')
                setWelcomeDismissed(true)
              }}
            />
          )
        })()}
        <ToastContainer
          position="top-right"
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
