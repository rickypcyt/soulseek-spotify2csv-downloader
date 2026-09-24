import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListMusic, Search, X } from 'lucide-react'

// Modal flotante estilo Spotify para elegir la playlist/carpeta destino.
// Se monta con portal en document.body para que ningún contenedor con
// overflow/transform la recorte.
export default function PlaylistSelectModal({
  open,
  playlists = [],
  title = 'Guardar en biblioteca',
  subtitle,
  onClose,
  onSelect,
  allowEmpty = true,
}) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const filtered = playlists.filter((playlist) =>
    playlist.toLowerCase().includes(search.trim().toLowerCase())
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-[#000000]/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[#2C303D] bg-[#12141D] shadow-[0_24px_64px_rgba(0,0,0,0.6)] sm:max-w-md sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#2C303D] px-4 py-3.5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#E9EAF0]">{title}</h3>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-[#8D93A6]" title={subtitle}>{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8D93A6] transition-colors hover:bg-[#FFFFFF]/10 hover:text-[#E9EAF0]"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="border-b border-[#2C303D] px-4 py-3">
          <div className="flex items-center gap-2 rounded-full border border-[#2C303D] bg-[#0D0F16] px-3 py-2 transition-colors focus-within:border-[#1DB954]/70">
            <Search size={14} strokeWidth={2} className="shrink-0 text-[#565C6E]" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar playlist…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.map((playlist) => (
            <button
              key={playlist}
              type="button"
              onClick={() => onSelect(playlist)}
              className="group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[#FFFFFF]/[0.07]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[#1B1E2A] text-[#1DB954] transition-colors group-hover:bg-[#1DB954]/15">
                <ListMusic size={18} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#E9EAF0]" title={playlist}>
                {playlist}
              </span>
              <span className="rounded-full border border-[#1DB954]/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#1DB954] opacity-0 transition-opacity group-hover:opacity-100">
                elegir
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-[#8D93A6]">No se encontraron playlists.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#2C303D] px-4 py-3">
          {allowEmpty ? (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="text-xs text-[#8D93A6] underline-offset-2 transition-colors hover:text-[#E9EAF0] hover:underline"
            >
              guardar sin playlist
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#3A3F4E] px-4 py-1.5 text-xs font-medium text-[#D5D7DE] transition-colors hover:border-[#FFFFFF]/50 hover:text-[#FFFFFF]"
          >
            cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
