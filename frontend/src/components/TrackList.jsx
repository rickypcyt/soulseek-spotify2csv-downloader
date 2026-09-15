import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Checkbox, TrackCardSkeleton } from './ui'
import TrackCard from './TrackCard'

export default function TrackList({
  tracks,
  localPlaylists,
  formatFilters,
  loading,
  selected,
  onSelectAll,
  onDownloadSelected,
  onAutoSearchAll,
  getTrackSearch,
  isTrackDownloaded,
  manualDownloadedTracks,
  ignoredTracks,
  trackIdentity,
  getTrackDownloads,
  getSpotifyTrackId,
  onToggleSelect,
  onToggleManualDownloaded,
  onToggleIgnored,
  onUpdateQuery,
  onCopy,
  onSearchTrack,
  pickMode,
  formatPref,
  expandedSearches,
  onToggleExpandedSearch,
  collapsedSearches,
  onToggleCollapsedSearch,
  previews,
  onStartPreview,
  onSavePreview,
  onDiscardPreview,
  onCancelPreview,
  storedFileStreamUrl,
  storedFileUrl,
  onCancelDownload,
  onEmbedCover,
  onRefreshSearch,
  onCancelSearch,
}) {
  const [activeEmbedIndex, setActiveEmbedIndex] = useState(null)

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="Cargando pistas">
        {Array.from({ length: 6 }, (_, index) => <TrackCardSkeleton key={index} />)}
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-[#2C303D] text-center text-sm text-[#565C6E]">
        <p>Pegá el link de una playlist para ver sus pistas acá.</p>
      </div>
    )
  }

  const isDownloaded = (t, i) =>
    isTrackDownloaded(t) ||
    manualDownloadedTracks.has(trackIdentity(t)) ||
    getTrackDownloads(i).some((d) => d.state === 'completado')

  const isIgnored = (t) => ignoredTracks.has(trackIdentity(t))

  const indexed = tracks.map((t, i) => ({ track: t, index: i, downloaded: isDownloaded(t, i), ignored: isIgnored(t) }))
  const ignoredList = indexed.filter((item) => item.ignored && !item.downloaded)
  const pendingTracks = indexed.filter((item) => !item.downloaded && !item.ignored)
  const downloadedTracks = indexed.filter((item) => item.downloaded)
  const downloadedCount = downloadedTracks.length
  const ignoredCount = ignoredList.length

  const renderCard = (item) => {
    const { track: t, index: i } = item
    return (
      <TrackCard
        key={i}
        track={t}
        index={i}
        localPlaylists={localPlaylists}
        formatFilters={formatFilters}
        selected={selected.has(i)}
        onToggleSelect={onToggleSelect}
        actualDownloaded={isTrackDownloaded(t)}
        manuallyDownloaded={manualDownloadedTracks.has(trackIdentity(t))}
        onToggleManualDownloaded={onToggleManualDownloaded}
        ignored={ignoredTracks.has(trackIdentity(t))}
        onToggleIgnored={onToggleIgnored}
        trackDownloads={getTrackDownloads(i)}
        spotifyTrackId={getSpotifyTrackId(t.spotify_url)}
        search={getTrackSearch(i)}
        expandedSearches={expandedSearches}
        onToggleExpandedSearch={onToggleExpandedSearch}
        collapsedSearches={collapsedSearches}
        onToggleCollapsedSearch={onToggleCollapsedSearch}
        onUpdateQuery={onUpdateQuery}
        onCopy={onCopy}
        onSearchTrack={onSearchTrack}
        pickMode={pickMode}
        formatPref={formatPref}
        previews={previews}
        onStartPreview={onStartPreview}
        onSavePreview={onSavePreview}
        onDiscardPreview={onDiscardPreview}
        onCancelPreview={onCancelPreview}
        storedFileStreamUrl={storedFileStreamUrl}
        storedFileUrl={storedFileUrl}
        onCancelDownload={onCancelDownload}
        onEmbedCover={onEmbedCover}
        onRefreshSearch={onRefreshSearch}
        onCancelSearch={onCancelSearch}
        embedOpen={activeEmbedIndex === i}
        onToggleEmbed={() => setActiveEmbedIndex(activeEmbedIndex === i ? null : i)}
      />
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-[#8D93A6]">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={selected.size === tracks.length && tracks.length > 0}
              indeterminate={selected.size > 0 && selected.size < tracks.length}
              onChange={(checked) => onSelectAll(checked)}
              title="Seleccionar todas"
            />
            {selected.size} de {tracks.length} seleccionada{selected.size === 1 ? '' : 's'}
          </label>
          <span className="text-[#565C6E]">·</span>
          <span>{tracks.length} en total · {pendingTracks.length} pendientes · {downloadedCount} descargadas{ignoredCount > 0 ? ` · ${ignoredCount} ignoradas` : ''}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onDownloadSelected}
            disabled={selected.size === 0}
            className="rounded bg-[#FFFFFF] px-2.5 py-1 text-xs font-medium text-[#161822] transition-colors hover:bg-[#f0b25c] disabled:cursor-not-allowed disabled:opacity-40"
          >
            descargar seleccionadas
          </button>
          <button
            onClick={onAutoSearchAll}
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

      {/* Descargadas (colapsable) */}
      {downloadedTracks.length > 0 && (
        <details className="group mb-6 rounded-lg border border-[#2C303D] bg-[#0D0F16]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[#7FD8CC] [&::-webkit-details-marker]:hidden">
            <span>Descargadas · {downloadedCount}</span>
            <ChevronDown size={14} className="shrink-0 transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-[#2C303D] p-3 xl:grid-cols-2">
            {downloadedTracks.map(renderCard)}
          </div>
        </details>
      )}

      {/* Ignoradas (colapsable) */}
      {ignoredCount > 0 && (
        <details className="group mb-6 rounded-lg border border-[#2C303D] bg-[#0D0F16]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[#8D93A6] [&::-webkit-details-marker]:hidden">
            <span>Ignoradas · {ignoredCount}</span>
            <ChevronDown size={14} className="shrink-0 transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-[#2C303D] p-3 xl:grid-cols-2">
            {ignoredList.map(renderCard)}
          </div>
        </details>
      )}

      {/* Pendientes */}
      {pendingTracks.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-[#8D93A6]">
            Pendientes · {pendingTracks.length}
          </h3>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {pendingTracks.map(renderCard)}
          </div>
        </div>
      )}
    </>
  )
}
