import { useState } from 'react'
import { TrackCardSkeleton } from './ui'
import TrackCard from './TrackCard'

export default function TrackList({
  tracks,
  loading,
  selected,
  onSelectAll,
  onDownloadSelected,
  onAutoSearchAll,
  getTrackSearch,
  isTrackDownloaded,
  manualDownloadedTracks,
  trackIdentity,
  getTrackDownloads,
  getSpotifyTrackId,
  onToggleSelect,
  onToggleManualDownloaded,
  onUpdateQuery,
  onCopy,
  onSearchTrack,
  pickMode,
  formatPref,
  expandedSearches,
  onToggleExpandedSearch,
  collapsedSearches,
  onToggleCollapsedSearch,
  activePreview,
  onStartPreview,
  onSavePreview,
  onDiscardPreview,
  onCancelPreview,
  storedFileStreamUrl,
  storedFileUrl,
  onCancelDownload,
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

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[#8D93A6]">
          <input
            type="checkbox"
            checked={selected.size === tracks.length && tracks.length > 0}
            onChange={(e) => onSelectAll(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-white"
          />
          {selected.size} de {tracks.length} seleccionada
          {selected.size === 1 ? '' : 's'}
        </label>
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {tracks.map((t, i) => (
          <TrackCard
            key={i}
            track={t}
            index={i}
            selected={selected.has(i)}
            onToggleSelect={onToggleSelect}
            actualDownloaded={isTrackDownloaded(t)}
            manuallyDownloaded={manualDownloadedTracks.has(trackIdentity(t))}
            onToggleManualDownloaded={onToggleManualDownloaded}
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
            activePreview={activePreview}
            onStartPreview={onStartPreview}
            onSavePreview={onSavePreview}
            onDiscardPreview={onDiscardPreview}
            onCancelPreview={onCancelPreview}
            storedFileStreamUrl={storedFileStreamUrl}
            storedFileUrl={storedFileUrl}
            onCancelDownload={onCancelDownload}
            onRefreshSearch={onRefreshSearch}
            onCancelSearch={onCancelSearch}
            embedOpen={activeEmbedIndex === i}
            onToggleEmbed={() => setActiveEmbedIndex(activeEmbedIndex === i ? null : i)}
          />
        ))}
      </div>
    </>
  )
}
