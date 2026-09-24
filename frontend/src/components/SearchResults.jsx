import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Clock3 } from 'lucide-react'
import { requestJson } from '../api/client'
import { Chip } from './ui'
import PlaylistSelectModal from './PlaylistSelectModal'
import SearchActions from './SearchActions'
import { FONT_MONO, RESULTS_PER_TRACK, formatResultDuration, formatSize, formatSpeed } from '../constants'
import { extOf, pickBest, rankResults } from '../utils/resultPicker'

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.ceil(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const remainingSeconds = total % 60
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function previewStatusLabel(preview) {
  const rawState = String(preview.transferState || '').toLowerCase()
  if (preview.state === 'encolando' || ['queued', 'queue', 'pending'].some((state) => rawState.includes(state))) {
    return 'en cola · esperando conexión'
  }
  if (['connecting', 'initializing', 'requested', 'negotiating'].some((state) => rawState.includes(state))) {
    return `conectando · ${Math.round(preview.percent || 0)}%`
  }
  if (rawState.includes('downloading') || rawState.includes('transferring')) {
    const speed = preview.transferSpeed ? formatSpeed(preview.transferSpeed) : 'sin velocidad todavía'
    const eta = preview.bytesRemaining && preview.transferSpeed
      ? formatEta(preview.bytesRemaining / preview.transferSpeed)
      : null
    return `descargando ${Math.round(preview.percent || 0)}% · ${speed}${eta ? ` · quedan ${eta}` : ''}`
  }
  if (rawState === 'unknown' || !rawState || rawState === 'starting') {
    return `consultando estado · ${Math.round(preview.percent || 0)}%`
  }
  return `${preview.transferState} · ${Math.round(preview.percent || 0)}%`
}

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
  localPlaylists = [],
  formatFilters = [],
  previews = {},
  onStartPreview,
  onSavePreview,
  quickSaveLabel,
  onQuickSavePreview,
  onDiscardPreview,
  onCancelPreview,
  storedFileStreamUrl,
  storedFileUrl,
  onCancelDownload,
  onRefreshSearch,
  onCancelSearch,
}) {
  const s = search
  const usernameKey = useMemo(() => [...new Set(
    (s.raw?.results || []).map((result) => result.username).filter(Boolean)
  )].sort().join("\u001f"), [s.raw?.results])
  const [presences, setPresences] = useState({})
  const [openSavePlaylistMenu, setOpenSavePlaylistMenu] = useState(null)
  const audioRef = useRef(null)

  useEffect(() => {
    const usernames = usernameKey ? usernameKey.split("\u001f") : []
    if (!usernames.length) return undefined
    let cancelled = false
    requestJson('/api/soulseek/users/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames }),
    }).then((data) => {
      if (!cancelled) setPresences((previous) => ({ ...previous, ...(data.statuses || {}) }))
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [usernameKey])

  if (!s.raw) {
    return (
      <div className="px-1 py-2 text-sm text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
        <p>esperando resultados&hellip;</p>
        <SearchActions searchId={s.searchId} onRefresh={onRefreshSearch} onCancel={onCancelSearch} />
      </div>
    )
  }
  const allResults = rankResults(s.raw.results || [], s.query, pickMode, formatPref, formatFilters)
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
    !s.raw?.isComplete &&
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

  const results = allResults
  const bestPick = pickBest(allResults, pickMode, formatPref, formatFilters)
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
          {total} resultado(s){total > 2 ? ' · scroll para ver más' : ''}
        </p>
      <div className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
      {results.map((res, i) => {
        const resultDownload = getDownloadForResult(res)
        const activePreview = previews[`${res.username}|${res.filename}`]
        const isThisPreview = Boolean(activePreview)
        const isBusy = activePreview && !activePreview.error && activePreview.state !== 'completado'
        const progress = Math.min(100, Math.max(0, Number(resultDownload?.percent || 0)))
        const remainingBytes = Number(res.size) * (1 - progress / 100)
        const eta = resultDownload?.state === 'completado'
          ? null
          : formatEta(remainingBytes / Number(res.speed))
        const presence = presences[res.username] || 'desconocido'
        const presenceTitle = eta
          ? `Usuario ${presence} · descarga aproximada: ${eta}`
          : `Usuario ${presence}`
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
            {res.username && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3A3F4E] bg-[#161822] px-2.5 py-1 leading-none">
                <span
                  aria-label={presenceTitle}
                  title={presenceTitle}
                  className={`h-2 w-2 rounded-full ${presences[res.username] === 'Online'
                    ? 'bg-emerald-400'
                    : presences[res.username] === 'Away'
                      ? 'bg-amber-400'
                      : presences[res.username] === 'Offline'
                        ? 'bg-slate-500'
                        : 'bg-slate-600'
                  }`}
                />
                @{res.username}
              </span>
            )}
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
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => onStartPreview(res)}
              disabled={isBusy}
              className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Descargar
            </button>
            {isThisPreview && activePreview.state !== 'completado' && activePreview.state !== 'error' && (
              <>
                {activePreview.state === 'encolando' && <Chip tone="amber">{previewStatusLabel(activePreview)}</Chip>}
                {activePreview.state === 'descargando' && <Chip tone="amber">{previewStatusLabel(activePreview)}</Chip>}
                <button
                  onClick={() => onCancelPreview(res)}
                  className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
          {isThisPreview && (
            <div className="mt-2">

              {activePreview.state === 'completado' && activePreview.path && (
                <>
                  <audio
                    ref={audioRef}
                    controls
                    src={activePreview.savedPath
                      ? storedFileStreamUrl('downloads', activePreview.savedPath)
                      : `/api/preview/stream?path=${encodeURIComponent(activePreview.path)}`}
                    className="mt-1 h-8 w-full"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickSaveLabel && !activePreview.savedPath && (
                      <button
                        onClick={() => {
                          audioRef.current?.pause()
                          audioRef.current?.removeAttribute('src')
                          audioRef.current?.load()
                          onQuickSavePreview(activePreview)
                        }}
                        title={`Guardar directo en la carpeta “${quickSaveLabel}”`}
                        className="max-w-56 truncate rounded border border-[#1DB954]/50 px-2 py-1 text-[11px] font-medium text-[#1DB954] transition-colors hover:bg-[#1DB954]/10"
                      >
                        Guardar en {quickSaveLabel}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (localPlaylists.length > 0 && !activePreview.savedPath) {
                          setOpenSavePlaylistMenu(activePreview.filename)
                        } else {
                          audioRef.current?.pause()
                          audioRef.current?.removeAttribute('src')
                          audioRef.current?.load()
                          onSavePreview(activePreview)
                        }
                      }}
                      disabled={Boolean(activePreview.savedPath)}
                      className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[11px] font-medium text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10 disabled:cursor-default disabled:opacity-60"
                    >
                      {activePreview.savedPath ? 'Guardado en biblioteca' : 'guardar en otra carpeta'}
                    </button>
                    <PlaylistSelectModal
                      open={openSavePlaylistMenu === activePreview.filename}
                      playlists={localPlaylists}
                      subtitle={activePreview.filename}
                      onClose={() => setOpenSavePlaylistMenu(null)}
                      onSelect={(playlist) => {
                        audioRef.current?.pause()
                        audioRef.current?.removeAttribute('src')
                        audioRef.current?.load()
                        setOpenSavePlaylistMenu(null)
                        if (playlist) onSavePreview(activePreview, playlist)
                        else onSavePreview(activePreview)
                      }}
                    />
                    {!activePreview.savedPath && (
                      <button
                        onClick={() => {
                          audioRef.current?.pause()
                          audioRef.current?.removeAttribute('src')
                          audioRef.current?.load()
                          onDiscardPreview(activePreview)
                        }}
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
              {activePreview.state === 'offline' && (
                <Chip tone="amber">usuario offline · inténtalo más tarde</Chip>
              )}
              {activePreview.state === 'no_disponible' && (
                <Chip tone="amber">usuario no disponible</Chip>
              )}
              {activePreview.state === 'error' && (
                <Chip tone="coral">error · {activePreview.error}</Chip>
              )}

            </div>
          )}
          {resultDownload && (
            <div className="mt-2">
              {resultDownload.state === 'encolando' && <Chip tone="queued">encolando</Chip>}
              {resultDownload.state === 'descargando' && (
                <Chip tone="active">descargando {Math.round(resultDownload.percent || 0)}%</Chip>
              )}
              {resultDownload.state === 'completado' && resultDownload.path && (
                <Chip tone="teal">guardado · {resultDownload.path}</Chip>
              )}
              {resultDownload.state === 'cancelado' && <Chip tone="neutral">cancelado</Chip>}
              {resultDownload.state === 'offline' && (
                <Chip tone="amber">usuario offline · inténtalo más tarde</Chip>
              )}
              {resultDownload.state === 'no_disponible' && (
                <Chip tone="amber">usuario no disponible</Chip>
              )}
              {resultDownload.state === 'error' && (
                <Chip tone="coral">error · {resultDownload.error}</Chip>
              )}
              {!['completado', 'error', 'cancelado', 'offline', 'no_disponible'].includes(resultDownload.state) && (
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
      </div>
    </details>
  )
}
