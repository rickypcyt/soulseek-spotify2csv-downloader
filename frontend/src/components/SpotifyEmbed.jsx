export default function SpotifyEmbed({ trackId, previewUrl, open, onToggle }) {
  if (!trackId && !previewUrl) return null

  return (
    <div className="mt-3">
      {open && trackId ? (
        <iframe
          src={`https://open.spotify.com/embed/track/${trackId}`}
          width="100%"
          height="80"
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
        </div>
      ) : trackId ? (
        <iframe
          src={`https://open.spotify.com/embed/track/${trackId}`}
          width="100%"
          height="80"
          style={{ border: 0, borderRadius: '8px' }}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      ) : null}
    </div>
  )
}
