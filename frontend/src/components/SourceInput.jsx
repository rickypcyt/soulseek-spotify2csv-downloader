import { FONT_MONO } from '../constants'

export default function SourceInput({
  url,
  onUrlChange,
  loading,
  onSubmit,
  onLoadSpotifyPlaylists,
  spotifyAuthStatus,
  outputFolderName,
  onOutputFolderChange,
  urlHistory,
  onSelectHistory,
  onClearHistory,
}) {
  return (
    <section className="mb-8 rounded-xl border border-slate-600 bg-slate-800 p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-100">1. Cargar fuente de búsqueda</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">Pega un enlace de Spotify o escribe directamente lo que quieres buscar en Soulseek.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8D93A6]"
            style={{ fontFamily: FONT_MONO }}
          >
            fuente
          </span>
          <input
            type="text"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Pega una URL de Spotify o escribe artista - canción"
            list="url-history"
            className="w-full rounded-md border border-[#2C303D] bg-[#161822] py-2.5 pl-11 pr-3 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60"
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
          {loading ? 'Cargando playlist…' : 'Cargar playlist'}
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
      <div className="mt-4 rounded-md border border-[#2C303D] bg-[#161822] p-3">
        <label className="block text-sm font-medium text-slate-200" htmlFor="output-folder-name">
          Destino de las descargas
        </label>
        <p className="mt-1 text-xs leading-relaxed text-[#8D93A6]">
          Se propone automáticamente el nombre de la playlist y puedes modificarlo. Si lo dejas vacío, las descargas se quedan en temporales; los previews solo se guardan en una playlist cuando eliges una carpeta.
        </p>
        <input
          id="output-folder-name"
          type="text"
          value={outputFolderName}
          onChange={(event) => onOutputFolderChange(event.target.value)}
          placeholder="Vacío = temporales"
          className="mt-2 w-full rounded-md border border-[#2C303D] bg-[#0D0F16] px-3 py-2 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none focus:border-[#FFFFFF]/60"
        />
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
    </section>
  )
}
