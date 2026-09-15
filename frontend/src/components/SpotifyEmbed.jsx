import { useState } from 'react'

export default function SpotifyEmbed({
  trackId,
  spotifyUrl,
  previewUrl,
  open,
  onToggle,
  trackName,
  artists,
  localPlaylists = [],
  onSaveToLibrary,
}) {
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  if (!trackId && !previewUrl) return null

  const embedUrl = trackId
    ? `https://open.spotify.com/embed/track/${trackId}?utm_source=generator`
    : null

  return (
    <div className="mt-3">
      {open && embedUrl ? (
        <iframe
          src={embedUrl}
          title="Reproductor de Spotify"
          width="100%"
          height="152"
          frameBorder="0"
          allowFullScreen
          style={{ border: 0, borderRadius: '8px' }}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      ) : previewUrl ? (
        <div className="flex items-center gap-2">
          <audio
            controls
            src={previewUrl}
            preload="metadata"
            className="h-8 min-w-0 flex-1"
          />
          {trackId && (
            <button
              type="button"
              onClick={onToggle}
              title="Abrir embed completo de Spotify"
              className="shrink-0 rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
            >
              Spotify
            </button>
          )}
          {onSaveToLibrary && localPlaylists.length > 0 && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSaveMenuOpen((openMenu) => !openMenu)}
                title="Guardar preview en la biblioteca"
                className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
              >
                guardar
              </button>
              {saveMenuOpen && (
                <div className="absolute bottom-full right-0 z-[100] mb-1 max-h-60 min-w-52 overflow-hidden rounded-lg border border-[#343949] bg-[#161822] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
                  <div className="border-b border-[#2C303D] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-[#8D93A6]">elegir playlist</div>
                  <div className="max-h-48 overflow-y-auto p-1.5">
                    {localPlaylists.map((playlist) => (
                      <button
                        key={playlist}
                        type="button"
                        onClick={() => {
                          setSaveMenuOpen(false)
                          onSaveToLibrary({ previewUrl, trackName, artists }, playlist)
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
          )}
        </div>
      ) : embedUrl ? (
        <iframe
          src={embedUrl}
          title="Reproductor de Spotify"
          width="100%"
          height="152"
          frameBorder="0"
          allowFullScreen
          style={{ border: 0, borderRadius: '8px' }}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      ) : null}
      {spotifyUrl && (
        <a
          href={spotifyUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[10px] text-[#8D93A6] underline-offset-2 hover:text-[#E9EAF0] hover:underline"
        >
          Abrir en Spotify
        </a>
      )}
    </div>
  )
}
