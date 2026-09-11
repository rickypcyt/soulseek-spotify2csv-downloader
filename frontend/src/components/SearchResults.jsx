import { ChevronDown, Clock3 } from 'lucide-react'
import { Chip } from './ui'
import SearchActions from './SearchActions'
import { FONT_MONO, RESULTS_PER_TRACK, formatResultDuration, formatSize, formatSpeed } from '../constants'
import { extOf, pickBest, rankResults } from '../utils/resultPicker'

export default function SearchResults({
  search,
  limit = RESULTS_PER_TRACK,
  pickMode,
  formatPref,
  expanded,
  onToggleExpanded,
  collapsed,
  onToggleCollapsed,
  trackDownloaded,
  trackDownloads,
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
  const s = search

  if (!s.raw) {
    return (
      <div className="px-1 py-2 text-sm text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
        <p>esperando resultados&hellip;</p>
        <SearchActions searchId={s.searchId} onRefresh={onRefreshSearch} onCancel={onCancelSearch} />
      </div>
    )
  }
  const allResults = rankResults(s.raw.results || [], s.query, pickMode, formatPref)
  const total = allResults.length

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
  const bestPick = pickBest(allResults, pickMode, formatPref)
  const isThisPreview = (res) =>
    activePreview &&
    activePreview.username === res.username &&
    activePreview.filename === res.filename
  const getDownloadForResult = (res) => trackDownloads.find((download) =>
    download.username === res.username && download.filename === res.filename
  )

  return (
    <details
      key={`${s.searchId}-${trackDownloaded ? 'descargado' : 'pendiente'}`}
      open={!trackDownloaded && !collapsed}
      onToggle={(event) => {
        const isOpen = event.currentTarget.open
        onToggleCollapsed(s.searchId, isOpen)
      }}
      className="group rounded-md border border-[#2C303D] bg-[#0D0F16]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2.5 py-2 text-[11px] text-[#8D93A6] [&::-webkit-details-marker]:hidden">
        <span style={{ fontFamily: FONT_MONO }}>
          Resultados Soulseek · {total} resultado(s)
        </span>
        <ChevronDown size={14} className="shrink-0 transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="space-y-1.5 border-t border-[#2C303D] p-2.5">
        <p className="text-[11px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
          mostrando {results.length} de {total}
          {total > results.length ? ` · +${total - results.length} más` : ''}
        </p>
      {total > limit && (
        <button
          onClick={() => onToggleExpanded(s.searchId)}
          className="mb-1 rounded border border-[#2C303D] px-2 py-1 text-[11px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
        >
          {expanded ? 'mostrar menos' : `ver los ${total} resultados`}
        </button>
      )}
      {results.map((res, i) => {
        const resultDownload = getDownloadForResult(res)
        return (
        <div
          key={`${res.username || 'unknown'}|${res.filename || res.path || i}|${res.size || 0}`}
          className="fade-in rounded-md border border-[#2C303D] bg-[#0D0F16] p-2.5"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <p className="whitespace-normal break-words [overflow-wrap:anywhere] text-[13px] leading-snug text-[#E9EAF0]" title={res.filename || res.file || res.name || res.path}>
            {res === bestPick && (
              <span className="mr-1.5 rounded bg-[#FFFFFF] px-1 py-0.5 text-[9px] font-semibold text-[#161822]">
                Recomendado
              </span>
            )}
            {res.filename || res.file || res.name || res.path || `Resultado ${i + 1}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
            {res.username && <span className="inline-flex items-center rounded-full border border-[#3A3F4E] bg-[#161822] px-2.5 py-1 leading-none">@{res.username}</span>}
            {extOf(res) && <span className="inline-flex items-center rounded-full border border-[#FFFFFF]/25 bg-[#FFFFFF]/10 px-2.5 py-1 leading-none text-[#E9EAF0]">{extOf(res).toUpperCase()}</span>}
            {res.size ? <span className="inline-flex items-center rounded-full border border-[#3A3F4E] bg-[#161822] px-2.5 py-1 leading-none">{formatSize(res.size)}</span> : null}
            {res.speed ? <span className="inline-flex items-center rounded-full border border-[#3A3F4E] bg-[#161822] px-2.5 py-1 leading-none">{formatSpeed(res.speed)}</span> : null}
            {res.bitrate ? <span className="inline-flex items-center rounded-full border border-[#3A3F4E] bg-[#161822] px-2.5 py-1 leading-none">{Math.round(res.bitrate / 1000)} kbps</span> : null}
            {formatResultDuration(res) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#3A3F4E] bg-[#161822] px-2.5 py-1 leading-none">
                <Clock3 size={12} strokeWidth={1.8} /> duración · {formatResultDuration(res)}
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => onStartPreview(res)}
              disabled={isBusy}
              className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10 disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="mt-1 h-8 w-full"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      onClick={onSavePreview}
                      disabled={Boolean(activePreview.savedPath)}
                      className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10 disabled:cursor-default disabled:opacity-60"
                    >
                      {activePreview.savedPath ? 'Guardado en biblioteca' : 'Guardar en biblioteca'}
                    </button>
                    {!activePreview.savedPath && (
                      <button
                        onClick={onDiscardPreview}
                        className="rounded border border-[#6B7280]/40 px-2 py-1 text-[11px] text-[#8D93A6] transition-colors hover:border-[#6B7280] hover:text-[#E9EAF0]"
                      >
                        descartar archivo
                      </button>
                    )}
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
                  onClick={() => onCancelPreview(res)}
                  className="ml-2 rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
                >
                  Cancelar
                </button>
              )}
            </div>
          )}
          {resultDownload && (
            <div className="mt-2">
              {resultDownload.state === 'encolando' && <Chip tone="amber">encolando</Chip>}
              {resultDownload.state === 'descargando' && (
                <Chip tone="amber">descargando {Math.round(resultDownload.percent || 0)}%</Chip>
              )}
              {resultDownload.state === 'completado' && resultDownload.path && (
                <Chip tone="teal">guardado · {resultDownload.path}</Chip>
              )}
              {resultDownload.state === 'cancelado' && <Chip tone="neutral">cancelado</Chip>}
              {resultDownload.state === 'error' && (
                <Chip tone="coral">error · {resultDownload.error}</Chip>
              )}
              {!['completado', 'error', 'cancelado'].includes(resultDownload.state) && (
                <button
                  onClick={() => onCancelDownload(resultDownload.id)}
                  className="ml-2 rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
                >
                  Cancelar
                </button>
              )}
            </div>
          )}
        </div>
        )
      })}
      </div>
    </details>
  )
}
