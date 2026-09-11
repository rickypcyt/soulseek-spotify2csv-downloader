import { CheckCircle2, Clock3 } from 'lucide-react'
import { Chip } from './ui'
import SearchResults from './SearchResults'
import SpotifyEmbed from './SpotifyEmbed'
import { FONT_MONO, RESULTS_PER_TRACK, formatDuration } from '../constants'

export default function TrackCard({
  track,
  index,
  selected,
  onToggleSelect,
  actualDownloaded,
  manuallyDownloaded,
  onToggleManualDownloaded,
  trackDownloads,
  spotifyTrackId,
  search,
  expandedSearches,
  onToggleExpandedSearch,
  collapsedSearches,
  onToggleCollapsedSearch,
  onUpdateQuery,
  onCopy,
  onSearchTrack,
  pickMode,
  formatPref,
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
  embedOpen,
  onToggleEmbed,
}) {
  const t = track
  const i = index
  const downloaded = actualDownloaded || manuallyDownloaded || trackDownloads.some((download) => download.state === 'completado')

  return (
    <div
      key={i}
      className={`group relative overflow-hidden fade-in rounded-lg border border-[#2C303D] bg-[#161822] p-4 ${downloaded ? 'border-[#6B7280]/60' : ''}`}
      style={{ animationDelay: `${i * 40}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(i)}
            title="Seleccionar pista"
            className="h-3.5 w-3.5 cursor-pointer accent-white"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="mb-1 flex h-7 w-7 items-center justify-center rounded-md bg-[#0D0F16] text-xs text-[#8D93A6]"
            style={{ fontFamily: FONT_MONO }}
            aria-label={`Track ${i + 1}`}
          >
            {String(i + 1).padStart(2, '0')}
          </div>
          <h3 className="truncate text-[15px] font-medium leading-tight text-[#E9EAF0]">
            {t.track_name}
          </h3>
          <p className="truncate text-xs text-[#8D93A6]">
            {t.artists}
            {t.album ? ` · ${t.album}` : ''}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
            <Clock3 size={13} strokeWidth={1.8} aria-hidden="true" />
            <span>{formatDuration(t.duration_ms)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggleManualDownloaded(t, i)}
          disabled={actualDownloaded}
          aria-pressed={manuallyDownloaded}
          aria-label={actualDownloaded ? 'La canción ya está descargada' : manuallyDownloaded ? 'Quitar marca de descargada' : 'Marcar como descargada'}
          title={actualDownloaded ? 'Detectada en la biblioteca' : manuallyDownloaded ? 'Quitar marca de descargada' : 'Marcar como descargada'}
          className={`flex h-7 min-h-7 shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] transition-colors ${downloaded
            ? 'border-[#7FD8CC]/40 text-[#7FD8CC] hover:border-[#7FD8CC]/70'
            : 'border-[#2C303D] text-[#8D93A6] hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]'} disabled:cursor-default disabled:opacity-100`}
        >
          <CheckCircle2 size={13} strokeWidth={2} />
          <span className="hidden sm:inline">{downloaded ? 'descargada' : 'marcar descargada'}</span>
        </button>
      </div>

      {trackDownloads.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {trackDownloads.map((download) => (
            <span key={download.id}>
              {download.state === 'encolando' && <Chip tone="amber">encolando · {download.filename}</Chip>}
              {download.state === 'descargando' && <Chip tone="amber">descargando {Math.round(download.percent || 0)}% · {download.filename}</Chip>}
              {download.state === 'completado' && <Chip tone="teal">descargado{download.path ? ` · ${download.path}` : ''}</Chip>}
              {download.state === 'cancelado' && <Chip tone="neutral">cancelado · {download.filename}</Chip>}
              {download.state === 'error' && <Chip tone="coral">error · {download.error}</Chip>}
            </span>
          ))}
        </div>
      )}

      {(spotifyTrackId || t.spotify_preview) && (
        <SpotifyEmbed
          trackId={spotifyTrackId}
          previewUrl={t.spotify_preview}
          open={embedOpen}
          onToggle={onToggleEmbed}
        />
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={t.search_query}
          onChange={(e) => onUpdateQuery(i, e.target.value)}
          placeholder="artista - canción para buscar en Soulseek"
          className="min-w-0 flex-1 rounded border border-[#2C303D] bg-[#0D0F16] px-2.5 py-1.5 text-xs text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
          style={{ fontFamily: FONT_MONO }}
        />
        <button
          onClick={() => onCopy(t.search_query)}
          title="Copiar búsqueda"
          className="shrink-0 rounded border border-[#2C303D] px-2.5 py-1.5 text-xs text-[#8D93A6] transition-colors hover:border-[#3A3F4E] hover:text-[#E9EAF0]"
        >
          copiar
        </button>
        <button
          onClick={() => onSearchTrack(i, t.search_query)}
          className="shrink-0 rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-2.5 py-1.5 text-xs text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20"
        >
          buscar
        </button>
      </div>

      {search && (
        <div className="mt-3 border-t border-[#2C303D] pt-3">
          <SearchResults
            search={search}
            limit={RESULTS_PER_TRACK}
            pickMode={pickMode}
            formatPref={formatPref}
            expanded={expandedSearches.has(search.searchId)}
            onToggleExpanded={onToggleExpandedSearch}
            collapsed={collapsedSearches.has(search.searchId)}
            onToggleCollapsed={onToggleCollapsedSearch}
            trackDownloaded={downloaded}
            trackDownloads={trackDownloads}
            activePreview={activePreview}
            onStartPreview={(res) => onStartPreview(res, i)}
            onSavePreview={onSavePreview}
            onDiscardPreview={onDiscardPreview}
            onCancelPreview={onCancelPreview}
            storedFileStreamUrl={storedFileStreamUrl}
            storedFileUrl={storedFileUrl}
            onCancelDownload={onCancelDownload}
            onRefreshSearch={onRefreshSearch}
            onCancelSearch={onCancelSearch}
          />
        </div>
      )}
      {downloaded && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#10121A]/70 p-4 text-center backdrop-blur-[2px] transition-[backdrop-filter] duration-200 group-hover:backdrop-blur-0">
          <div className="flex max-w-[90%] flex-col items-center gap-1.5">
            <p className="max-w-full truncate text-sm font-semibold text-[#E9EAF0]" title={t.track_name}>{t.track_name}</p>
            <p className="max-w-full truncate text-xs text-[#8D93A6]" title={t.artists}>{t.artists || 'Artista desconocido'}</p>
            <span className="mt-1 rounded border border-[#8D93A6]/50 bg-[#161822]/90 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-[#D5D7DE]">
              Este track ya se ha descargado
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
