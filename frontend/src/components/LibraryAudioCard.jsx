import { Download, FileDown, FilePenLine, FolderOpen, ImagePlus, Music, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'react-toastify'

const FILE_DRAG_TYPE = 'application/x-soulseek-file'
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '--:--'
  const total = Math.floor(Number(ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBitrate(bytes, durationSeconds) {
  if (!bytes || !durationSeconds || !Number.isFinite(durationSeconds)) return '-- kbps'
  return `${Math.round((Number(bytes) * 8) / durationSeconds / 1000)} kbps`
}

export default function LibraryAudioCard({ file, streamUrl, downloadUrl, onDownload, downloadLabel = 'descargar', formatSize, onDelete, dragDir, onMoveStart, coverUrl, coverSourceUrl, onEmbedCover, onSearchCover, onRenameFile, onRevealFile, bpm, metadata = {}, onUpdateMetadata, onSearchMetadata, downloadPlaylists = [], layout = 'horizontal' }) {
  const audioRef = useRef(null)
  const [duration, setDuration] = useState(0)
  const [coverFailed, setCoverFailed] = useState(false)
  const [coverRefresh, setCoverRefresh] = useState(0)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [metadataDraft, setMetadataDraft] = useState({ trackName: '', artists: '' })
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [renamePreview, setRenamePreview] = useState(null)
  const isVertical = layout === 'vertical'
  const extension = (file.name.split('.').pop() || 'archivo').toUpperCase()
  const downloadTitle = downloadLabel === 'guardar en biblioteca'
    ? 'Guardar este preview en la biblioteca local'
    : 'Descargar este archivo al equipo'

  const stopAudio = () => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.removeAttribute('src')
    audioRef.current.load()
  }

  const coverImgUrl = coverUrl ? `${coverUrl}${coverUrl.includes('?') ? '&' : '?'}v=${coverRefresh}` : ''

  const coverContent = coverUrl && !coverFailed ? (
    <img
      key={coverImgUrl}
      src={coverImgUrl}
      alt=""
      onError={() => setCoverFailed(true)}
      className={isVertical ? 'h-16 w-16 shrink-0 rounded object-cover' : 'h-10 w-10 min-h-10 min-w-10 shrink-0 rounded object-cover'}
    />
  ) : (
    <span className={isVertical ? 'flex h-16 w-16 shrink-0 items-center justify-center rounded bg-[#0D0F16] text-[#565C6E]' : 'flex h-10 w-10 min-h-10 min-w-10 shrink-0 items-center justify-center rounded bg-[#0D0F16] text-[#565C6E]'}>
      <Music size={isVertical ? 28 : 16} strokeWidth={2} />
    </span>
  )

  const bpmDisplay = bpm ? (
    <>
      <span className="text-[#565C6E]">·</span>
      <span style={{ fontFamily: FONT_MONO }}>{Math.round(Number(bpm))} BPM</span>
    </>
  ) : null

  const metadataContent = (
    <div className="min-w-0 flex-1">
      <p className="break-words [overflow-wrap:anywhere] text-[12px] font-medium leading-snug text-[#E9EAF0]" title={file.path}>{file.name}</p>
      <div className="mt-0.5 space-y-0.5">
        <p className="break-words [overflow-wrap:anywhere] text-[10px] leading-snug text-[#8D93A6]" title={metadata.trackName?.trim() || 'no name'}>
          {metadata.trackName?.trim() || 'no name'}
        </p>
        <p className="break-words [overflow-wrap:anywhere] text-[10px] leading-snug text-[#8D93A6]" title={metadata.artists?.trim() || 'no artist'}>
          {metadata.artists?.trim() || 'no artist'}
        </p>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
        <span>{extension}</span>
        <span className="text-[#565C6E]">·</span>
        <span>{duration ? formatDuration(duration * 1000) : '--:--'}</span>
        <span className="text-[#565C6E]">·</span>
        <span>{formatSize(file.size)}</span>
        <span className="text-[#565C6E]">·</span>
        <span>{formatBitrate(file.size, duration)}</span>
        {bpmDisplay}
      </div>
    </div>
  )

  const deleteButton = (
    <button
      type="button"
      onClick={() => {
        stopAudio()
        onDelete(file.path)
      }}
      aria-label={`Borrar ${file.name}`}
      title="Borrar"
      className="flex h-7 w-7 !min-h-7 min-w-7 shrink-0 items-center justify-center rounded !p-0 border border-[#6B7280]/40 text-[#8D93A6] transition-colors hover:border-[#6B7280] hover:text-[#E9EAF0]"
    >
      <Trash2 size={13} strokeWidth={2} />
    </button>
  )

  const coverButton = coverSourceUrl || onSearchCover ? (
    <button
      type="button"
      onClick={async () => {
        if (coverSourceUrl) await onEmbedCover?.(file.path, coverSourceUrl)
        else await onSearchCover?.(file.path)
        setCoverFailed(false)
        setCoverRefresh(Date.now())
      }}
      aria-label={`${coverUrl && !coverFailed ? 'Actualizar' : 'Buscar y añadir'} portada de ${file.name}`}
      title={coverUrl && !coverFailed ? 'Actualizar portada desde Spotify' : 'Buscar portada en Spotify y añadirla al archivo'}
      className="flex h-7 w-7 !min-h-7 min-w-7 shrink-0 items-center justify-center rounded !p-0 border border-[#FFFFFF]/40 text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
    >
      <ImagePlus size={13} strokeWidth={2} />
    </button>
  ) : (
    <button
      type="button"
      disabled
      aria-label={`No hay portada relacionada para ${file.name}`}
      title="No hay portada de Spotify asociada a este archivo"
      className="flex h-7 w-7 !min-h-7 min-w-7 shrink-0 cursor-not-allowed items-center justify-center rounded !p-0 border border-[#2C303D] text-[#565C6E] opacity-60"
    >
      <ImagePlus size={13} strokeWidth={2} />
    </button>
  )

  const metadataButton = onUpdateMetadata ? (
    <button
      type="button"
      onClick={() => {
        setMetadataDraft({ trackName: metadata.trackName || file.name.replace(/\.[^.]+$/, ''), artists: metadata.artists || '' })
        setEditingMetadata(true)
      }}
      aria-label={`Modificar metadata de ${file.name}`}
      title="Modificar título y artista"
      className="flex h-7 w-7 !min-h-7 min-w-7 shrink-0 items-center justify-center rounded !p-0 border border-[#2C303D] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
    >
      <FilePenLine size={13} strokeWidth={2} />
    </button>
  ) : null

  const metadataSearchButton = onSearchMetadata ? (
    <button
      type="button"
      onClick={() => onSearchMetadata(file.path)}
      aria-label={`Buscar y guardar metadata de ${file.name}`}
      title="Buscar metadata en Spotify y guardarla en el archivo"
      className="flex h-7 w-7 !min-h-7 min-w-7 shrink-0 items-center justify-center rounded !p-0 border border-[#2C303D] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
    >
      <FileDown size={13} strokeWidth={2} />
    </button>
  ) : null

  const renameButton = onRenameFile ? (
    <button
      type="button"
      onClick={async () => {
        try {
          const data = await onRenameFile(file.path, { preview: true })
          setRenamePreview(data)
        } catch (err) {
          toast.error('No se pudo previsualizar el renombre: ' + err.message)
        }
      }}
      aria-label={`Renombrar archivo con metadata: ${file.name}`}
      title="Renombrar archivo: Nombre - Artista"
      className="flex h-7 w-7 !min-h-7 min-w-7 shrink-0 items-center justify-center rounded !p-0 border border-[#2C303D] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
    >
      <Pencil size={13} strokeWidth={2} />
    </button>
  ) : null

  const metadataEditor = editingMetadata ? (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input
        value={metadataDraft.trackName}
        onChange={(event) => setMetadataDraft((current) => ({ ...current, trackName: event.target.value }))}
        placeholder="Nombre"
        className="min-w-32 flex-1 rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1 text-[10px] text-[#E9EAF0] outline-none focus:border-[#FFFFFF]/60"
      />
      <input
        value={metadataDraft.artists}
        onChange={(event) => setMetadataDraft((current) => ({ ...current, artists: event.target.value }))}
        placeholder="Artista"
        className="min-w-32 flex-1 rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1 text-[10px] text-[#E9EAF0] outline-none focus:border-[#FFFFFF]/60"
      />
      <button
        type="button"
        onClick={() => {
          if (metadataDraft.trackName.trim()) {
            onUpdateMetadata?.(file.path, metadataDraft.trackName.trim(), metadataDraft.artists.trim())
            setEditingMetadata(false)
          }
        }}
        className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF]"
      >
        guardar
      </button>
      <button type="button" onClick={() => setEditingMetadata(false)} className="rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6]">
        cancelar
      </button>
    </div>
  ) : null

  const revealButton = onRevealFile ? (
    <button
      type="button"
      onClick={() => onRevealFile(file.path)}
      aria-label={`Mostrar carpeta de ${file.name}`}
      title="Mostrar archivo en el explorador"
      className="flex h-7 w-7 !min-h-7 min-w-7 shrink-0 items-center justify-center rounded !p-0 border border-[#2C303D] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
    >
      <FolderOpen size={13} strokeWidth={2} />
    </button>
  ) : null

  const downloadButton = onDownload ? (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (downloadPlaylists.length > 0) setDownloadMenuOpen((open) => !open)
          else onDownload(file.path)
        }}
        aria-label={`${downloadLabel} ${file.name}`}
        title={downloadTitle}
        className="flex !min-h-7 shrink-0 items-center gap-1 rounded border border-[#FFFFFF]/40 !px-2 !py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
      >
        <Download size={13} strokeWidth={2} />
        <span className="hidden xl:inline">{downloadLabel}</span>
      </button>
      {downloadMenuOpen && downloadPlaylists.length > 0 && (
        <div className="absolute bottom-full left-0 z-[100] mb-1 max-h-60 min-w-52 overflow-hidden rounded-lg border border-[#343949] bg-[#161822] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
          <div className="border-b border-[#2C303D] bg-[#161822] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-[#8D93A6]">elegir playlist</div>
          <div className="max-h-48 overflow-y-auto p-1.5">
            {downloadPlaylists.map((playlist) => (
              <button
                key={playlist}
                type="button"
                onClick={() => {
                  setDownloadMenuOpen(false)
                  onDownload(file.path, playlist)
                }}
                className="block w-full rounded-md px-2.5 py-2 text-left text-xs text-[#E9EAF0] transition-colors hover:bg-[#FFFFFF]/10"
              >
                <span className="block truncate" title={playlist}>{playlist}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : downloadUrl ? (
    <a
      href={downloadUrl}
      aria-label={`Descargar ${file.name}`}
      title="Descargar este archivo al equipo"
      className="flex !min-h-7 shrink-0 items-center gap-1 rounded border border-[#2C303D] !px-2 !py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
    >
      <Download size={13} strokeWidth={2} />
      <span className="hidden xl:inline">descargar</span>
    </a>
  ) : null

  const renamePreviewModal = renamePreview ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0F16]/80 p-4" onClick={() => setRenamePreview(null)}>
      <div className="w-full max-w-md rounded-lg border border-[#2C303D] bg-[#161822] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.35)]" onClick={(event) => event.stopPropagation()}>
        <h4 className="mb-3 text-sm font-medium text-[#E9EAF0]">Previsualizar renombre</h4>
        <div className="space-y-2 rounded border border-[#2C303D] bg-[#0D0F16] p-3 text-xs text-[#8D93A6]">
          <p className="break-words [overflow-wrap:anywhere]"><span className="text-[#565C6E]">Archivo:</span> {renamePreview.filename}</p>
          <p><span className="text-[#565C6E]">Título:</span> {renamePreview.track_name}</p>
          <p><span className="text-[#565C6E]">Artista:</span> {renamePreview.artists}</p>
          <p><span className="text-[#565C6E]">Álbum:</span> {renamePreview.album || '—'}</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setRenamePreview(null)}
            className="rounded border border-[#2C303D] px-3 py-1.5 text-xs text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
          >
            cancelar
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                setRenamePreview(null)
                await onRenameFile(file.path)
              } catch (err) {
                toast.error('No se pudo renombrar: ' + err.message)
              }
            }}
            className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-3 py-1.5 text-xs text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20"
          >
            confirmar
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
    <div
      draggable={Boolean(dragDir)}
      onDragStart={(event) => {
        stopAudio()
        if (dragDir) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify({ dir: dragDir, path: file.path }))
        }
        onMoveStart?.(event)
      }}
      className={`w-full min-w-0 cursor-grab rounded-lg border border-[#2C303D] bg-[#161822] ${isVertical ? 'p-3' : 'p-2'} shadow-[0_8px_24px_rgba(0,0,0,0.14)] active:cursor-grabbing`}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className={isVertical ? 'flex min-w-0 items-start gap-3' : 'flex min-w-0 items-center gap-2'}>
          {coverContent}
          {metadataContent}
        </div>
        {metadataEditor}
        <div className="flex min-w-0 items-center gap-2">
          <audio
            ref={audioRef}
            src={streamUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            className="h-8 min-w-0 flex-1"
          />
          {deleteButton}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {coverButton}
          {metadataButton}
          {metadataSearchButton}
          {renameButton}
          {revealButton}
          {downloadButton}
        </div>
      </div>
    </div>
    {renamePreviewModal}
  </>
  )
}
