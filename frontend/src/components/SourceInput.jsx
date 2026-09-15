import { useState } from 'react'
import { FONT_MONO } from '../constants'

export default function SourceInput({
  url,
  onUrlChange,
  loading,
  onSubmit,
  onLoadSpotifyPlaylists,
  spotifyAuthStatus,
  searchProvider,
  onSearchProviderChange,
  urlHistory,
  onSelectHistory,
  onClearHistory,
  onDownloadCompleted,
}) {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeLoading, setYoutubeLoading] = useState(false)
  const [youtubeMessage, setYoutubeMessage] = useState('')
  const [soundcloudUrl, setSoundcloudUrl] = useState('')
  const [soundcloudLoading, setSoundcloudLoading] = useState(false)
  const [soundcloudMessage, setSoundcloudMessage] = useState('')

  async function handleSoundCloudDownload(event) {
    event.preventDefault()
    if (!soundcloudUrl.trim()) return
    setSoundcloudLoading(true)
    setSoundcloudMessage('')
    try {
      const res = await fetch('/api/soundcloud/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: soundcloudUrl }),
      })
      const data = await res.json()
      if (data.ok) onDownloadCompleted?.()
      setSoundcloudMessage(data.ok ? `Preview descargado en FLAC: ${data.file}` : `Error: ${data.error}`)
    } catch (error) {
      setSoundcloudMessage('Error de red')
    } finally {
      setSoundcloudLoading(false)
    }
  }

  async function handleYouTubeDownload(event) {
    event.preventDefault()
    if (!youtubeUrl.trim()) return
    setYoutubeLoading(true)
    setYoutubeMessage('')
    try {
      const res = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl }),
      })
      const data = await res.json()
      if (data.ok) {
        setYoutubeMessage(`Preview descargado en FLAC: ${data.file}`)
        onDownloadCompleted?.()

      } else {
        setYoutubeMessage(`Error: ${data.error}`)
      }
    } catch (error) {
      setYoutubeMessage('Error de red')
    } finally {
      setYoutubeLoading(false)
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-slate-600 bg-slate-800 p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-100">1. Buscar en Soulseek</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">Pega un enlace de Spotify o escribe directamente lo que quieres buscar en Soulseek.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <select
          value={searchProvider}
          onChange={(event) => onSearchProviderChange(event.target.value)}
          title="Fuente de búsqueda para texto libre"
          aria-label="Fuente de búsqueda"
          className="rounded-md border border-[#2C303D] bg-[#161822] px-3 py-2.5 text-sm text-[#E9EAF0] outline-none focus:border-[#FFFFFF]/60"
        >
          <option value="spotify">Spotify Search</option>
          <option value="soulseek">Soulseek directo</option>
        </select>
        <div className="relative flex-1">
          <input
            type="text"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Pega una URL de Spotify o escribe artista - canción"
            list="url-history"
            className="w-full rounded-md border border-[#2C303D] bg-[#161822] py-2.5 px-3 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
            style={{ fontFamily: FONT_MONO }}
          />
          <datalist id="url-history">
            {urlHistory.map((u, i) => (
              <option key={i} value={u} />
            ))}
          </datalist>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="whitespace-nowrap rounded-md bg-[#FFFFFF] px-5 py-2.5 text-sm font-medium text-[#161822] transition-colors hover:bg-[#f0b25c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </form>
      <div className="mt-4 rounded-md border border-[#2C303D] bg-[#161822] p-3">
        <button
          type="button"
          onClick={onLoadSpotifyPlaylists}
          disabled={spotifyAuthStatus !== 'authenticated'}
          className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-3 py-2 text-xs text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          elegir una playlist de Spotify
        </button>
        <span className="ml-3 text-xs text-[#8D93A6]">
          {spotifyAuthStatus === 'authenticated' ? 'Abre el selector de playlists' : 'Conecta Spotify desde Settings primero'}
        </span>
      </div>
      {urlHistory.length > 0 && (
        <div className="mt-5 border-t border-slate-600 pt-5">
          <label className="block text-sm font-medium text-slate-200" htmlFor="saved-playlists">
            Historial local de playlists
          </label>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Selecciona una playlist por su título para volver a poner su enlace en la barra. Este historial vive en este navegador y usuario.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <select
              id="saved-playlists"
              defaultValue=""
              onChange={(event) => onSelectHistory(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Elegir una playlist guardada…</option>
              {urlHistory.map((saved) => (
                <option key={saved.url} value={saved.url}>
                  {saved.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onClearHistory}
              className="shrink-0 text-sm text-slate-300 underline decoration-dotted underline-offset-2 hover:text-white"
            >
              Borrar historial ({urlHistory.length})
            </button>
          </div>
        </div>
      )}
      <div className="mt-5 rounded-md border border-[#2C303D] bg-[#161822] p-3">
        <div className="mb-2">
          <p className="text-sm font-medium text-slate-100">SoundCloud · FLAC</p>
          <p className="mt-1 text-xs text-slate-400">Descarga tracks con yt-dlp y playlists públicas con lucidadl.</p>
        </div>
        <form onSubmit={handleSoundCloudDownload} className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={soundcloudUrl}
            onChange={(e) => setSoundcloudUrl(e.target.value)}
            placeholder="Pega un enlace de SoundCloud"
            className="w-full rounded-md border border-[#2C303D] bg-[#161822] py-2.5 px-3 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
            style={{ fontFamily: FONT_MONO }}
          />
          <button
            type="submit"
            disabled={soundcloudLoading}
            className="whitespace-nowrap rounded-md bg-[#FFFFFF] px-5 py-2.5 text-sm font-medium text-[#161822] transition-colors hover:bg-[#f0b25c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {soundcloudLoading ? 'Descargando…' : 'Descargar FLAC'}
          </button>
        </form>
        {soundcloudMessage && <p className="mt-2 text-sm text-slate-300">{soundcloudMessage}</p>}
      </div>
      <div className="mt-5 rounded-md border border-[#2C303D] bg-[#161822] p-3">
        <form onSubmit={handleYouTubeDownload} className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="Pega un enlace de YouTube para descargar en FLAC"
            className="w-full rounded-md border border-[#2C303D] bg-[#161822] py-2.5 px-3 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
            style={{ fontFamily: FONT_MONO }}
          />
          <button
            type="submit"
            disabled={youtubeLoading}
            className="whitespace-nowrap rounded-md bg-[#FFFFFF] px-5 py-2.5 text-sm font-medium text-[#161822] transition-colors hover:bg-[#f0b25c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {youtubeLoading ? 'Descargando…' : 'Descargar FLAC'}
          </button>
        </form>
        {youtubeMessage && (
          <p className="mt-2 text-sm text-slate-300">{youtubeMessage}</p>
        )}
      </div>
    </section>
  )
}
