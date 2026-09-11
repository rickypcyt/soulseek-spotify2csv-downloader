import { useState } from 'react'

export default function PlaylistPicker({
  open,
  playlists,
  onClose,
  onSelect,
}) {
  const [search, setSearch] = useState('')
  if (!open) return null
  const filtered = playlists.filter((playlist) =>
    playlist.name.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#10121A]/85 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-[#2C303D] bg-[#161822] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2C303D] p-4">
          <div>
            <h2 className="text-lg font-semibold text-[#E9EAF0]">Tus playlists de Spotify</h2>
            <p className="mt-1 text-xs text-[#8D93A6]">Selecciona una playlist para cargarla en Soulseek.</p>
          </div>
          <button onClick={onClose} className="rounded border border-[#2C303D] px-2 py-1 text-xs text-[#8D93A6] hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]">cerrar</button>
        </div>
        <div className="border-b border-[#2C303D] p-4">
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar playlist…"
            className="w-full rounded-md border border-[#2C303D] bg-[#0D0F16] px-3 py-2 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none focus:border-[#FFFFFF]/60"
          />
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => onSelect(playlist.url)}
                className="rounded-lg border border-[#2C303D] bg-[#0D0F16] px-4 py-3 text-left transition-colors hover:border-[#FFFFFF]/50 hover:bg-[#1A1D28]"
              >
                <p className="truncate text-sm font-medium text-[#E9EAF0]" title={playlist.name}>{playlist.name}</p>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-[#8D93A6]">No se encontraron playlists.</p>
          )}
        </div>
      </div>
    </div>
  )
}
