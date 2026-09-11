import { Download, Pause, Play, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

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

export default function LibraryAudioCard({ file, streamUrl, downloadUrl, onDownload, formatSize, onDelete, dragDir, onMoveStart }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const extension = (file.name.split('.').pop() || 'archivo').toUpperCase()

  const togglePlayback = async () => {
    if (!audioRef.current) return
    if (audioRef.current.paused) {
      try {
        await audioRef.current.play()
        setPlaying(true)
      } catch {}
    } else {
      audioRef.current.pause()
      setPlaying(false)
    }
  }

  const seek = (event) => {
    const nextTime = Number(event.target.value)
    if (audioRef.current) audioRef.current.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  return (
    <div
      draggable={Boolean(dragDir)}
      onDragStart={(event) => {
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current.removeAttribute('src')
          audioRef.current.load()
          setPlaying(false)
        }
        if (dragDir) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify({ dir: dragDir, path: file.path }))
        }
        onMoveStart?.(event)
      }}
      className="w-full min-w-0 cursor-grab rounded-lg border border-[#2C303D] bg-[#161822] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.14)] active:cursor-grabbing"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? `Pausar ${file.name}` : `Reproducir ${file.name}`}
          title={playing ? 'Pausar' : 'Reproducir'}
          className="flex h-8 w-8 min-h-8 min-w-8 shrink-0 aspect-square items-center justify-center rounded-full bg-[#FFFFFF] p-0 text-[#161822] transition-transform hover:scale-105"
        >
          {playing ? <Pause size={14} strokeWidth={2.5} /> : <Play size={14} strokeWidth={2.5} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-[#E9EAF0]" title={file.path}>{file.name}</p>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
            <span>{extension}</span>
            <span className="text-[#565C6E]">·</span>
            <span>{duration ? formatDuration(duration * 1000) : '--:--'}</span>
            <span className="text-[#565C6E]">·</span>
            <span>{formatSize(file.size)}</span>
            <span className="text-[#565C6E]">·</span>
            <span>{formatBitrate(file.size, duration)}</span>
          </div>
        </div>
        {onDownload ? (
          <button
            type="button"
            onClick={() => onDownload(file.path)}
            aria-label={`Descargar ${file.name}`}
            title="Descargar"
            className="flex shrink-0 items-center gap-1 rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
          >
            <Download size={13} strokeWidth={2} />
            <span className="hidden xl:inline">descargar</span>
          </button>
        ) : downloadUrl ? (
          <a
            href={downloadUrl}
            aria-label={`Descargar ${file.name}`}
            title="Descargar"
            className="flex shrink-0 items-center gap-1 rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
          >
            <Download size={13} strokeWidth={2} />
            <span className="hidden xl:inline">descargar</span>
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (audioRef.current) {
              audioRef.current.pause()
              audioRef.current.removeAttribute('src')
              audioRef.current.load()
            }
            onDelete(file.path)
          }}
          aria-label={`Borrar ${file.name}`}
          title="Borrar"
          className="flex h-7 w-7 min-h-7 min-w-7 shrink-0 items-center justify-center rounded border border-[#6B7280]/40 p-0 text-[#8D93A6] transition-colors hover:border-[#6B7280] hover:text-[#E9EAF0]"
        >
          <Trash2 size={13} strokeWidth={2} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>{formatDuration(currentTime * 1000)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
          aria-label="Posición de reproducción"
        />
        <span className="text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>{formatDuration(duration * 1000)}</span>
      </div>
      <audio
        ref={audioRef}
        src={streamUrl}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        className="hidden"
      />
    </div>
  )
}
