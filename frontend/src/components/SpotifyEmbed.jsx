import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import PlaylistSelectModal from './PlaylistSelectModal'

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
  const [reloadKey, setReloadKey] = useState(0)
  if (!trackId && !previewUrl) return null

  const embedUrl = trackId
    ? `https://open.spotify.com/embed/track/${trackId}?utm_source=generator`
    : null

  const reloadPlayer = () => setReloadKey((key) => key + 1)

  const embedFrame = (
    <div className="relative">
      <iframe
        key={reloadKey}
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
      <button
        type="button"
        onClick={reloadPlayer}
        title="Recargar reproductor"
        aria-label="Recargar reproductor"
        className="absolute right-1.5 top-1.5 rounded bg-[#10121A]/80 p-1 text-[#8D93A6] backdrop-blur-sm transition-colors hover:bg-[#2C303D] hover:text-[#FFFFFF]"
      >
        <RefreshCw size={11} />
      </button>
    </div>
  )

  return (
    <div className="mt-3">
      {open && embedUrl ? (
        embedFrame
      ) : previewUrl ? (
        <div className="flex items-center gap-2">
          <audio
            key={reloadKey}
            controls
            src={previewUrl}
            preload="none"
            className="h-8 min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={reloadPlayer}
            title="Recargar preview"
            aria-label="Recargar preview"
            className="shrink-0 rounded border border-[#2C303D] px-1.5 py-1 text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
          >
            <RefreshCw size={11} />
          </button>
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
            <>
              <button
                type="button"
                onClick={() => setSaveMenuOpen(true)}
                title="Guardar preview en la biblioteca"
                className="shrink-0 rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
              >
                guardar
              </button>
              <PlaylistSelectModal
                open={saveMenuOpen}
                playlists={localPlaylists}
                subtitle={[artists, trackName].filter(Boolean).join(' · ')}
                onClose={() => setSaveMenuOpen(false)}
                onSelect={(playlist) => {
                  setSaveMenuOpen(false)
                  onSaveToLibrary({ previewUrl, trackName, artists }, playlist || undefined)
                }}
              />
            </>
          )}
        </div>
      ) : embedUrl ? (
        embedFrame
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
