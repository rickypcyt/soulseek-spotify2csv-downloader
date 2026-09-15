import { StatusItem } from './ui'

export default function ConfigurationStatus({ config, diagnostics, backendOnline, spotifyAuth, onStartSpotifyAuth }) {
  const status = diagnostics?.configuration
  const hasStatus = Boolean(status)
  const slskdReady = hasStatus
    ? Boolean(status.slskd?.reachable && status.slskd?.apiKeyConfigured)
    : false
  const downloadsReady = hasStatus
    ? Boolean(status.downloads?.exists)
    : Boolean(config?.downloads_dir)

  return (
    <section className="mb-8 rounded-xl border border-slate-600 bg-slate-800 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Estado de la configuración</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Aquí puedes confirmar rápidamente si todo está listo antes de buscar o descargar.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${backendOnline ? 'border-blue-400/40 bg-blue-400/10 text-blue-200' : 'border-red-400/40 bg-red-400/10 text-red-200'}`}>
          Backend: {backendOnline ? 'conectado' : 'sin respuesta'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`rounded-lg border p-4 ${spotifyAuth?.status === 'authenticated' ? 'border-blue-400/40 bg-blue-400/10' : 'border-slate-600 bg-slate-900/40'}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Spotify</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">
                {spotifyAuth?.status === 'authenticated'
                  ? 'Spotify está conectado. Puedes cargar playlists privadas.'
                  : spotifyAuth?.status === 'authenticating'
                    ? 'Completa la autorización en la ventana del navegador…'
                    : spotifyAuth?.status === 'not_configured'
                      ? 'Guarda primero Client ID y Client Secret.'
                      : 'Spotify necesita autorización para leer tus playlists.'}
              </p>
              {spotifyAuth?.error && <p className="mt-2 text-xs text-red-200">{spotifyAuth.error}</p>}
              {spotifyAuth?.status === 'authenticating' && spotifyAuth?.url && (
                <a
                  href={spotifyAuth.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block break-all text-xs text-blue-300 underline"
                >
                  Abrir link de autorización de Spotify
                </a>
              )}
            </div>
            <span className="rounded-full border border-slate-500 px-3 py-1 text-sm text-slate-200">
              {spotifyAuth?.status === 'authenticated' ? 'conectado' : spotifyAuth?.status === 'authenticating' ? 'autorizando…' : 'no conectado'}
            </span>
          </div>
          <button
            type="button"
            onClick={onStartSpotifyAuth}
            disabled={spotifyAuth?.status === 'authenticating' || !config.spotify_client_id || !config.spotify_client_secret_configured}
            className="mt-3 rounded bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#161822] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {spotifyAuth?.status === 'authenticated' ? 'reautorizar Spotify' : 'conectar Spotify'}
          </button>
        </div>
        <StatusItem
          label="Soulseek / slskd"
          description={slskdReady ? `Servicio conectado en ${status.slskd.url}.` : 'El servicio no responde o falta la API key. Revisa slskd.exe y su URL.'}
          ready={slskdReady}
          readyLabel="Conectado"
          pending={!hasStatus}
        />
        <StatusItem
          label="Carpeta de descargas"
          description={downloadsReady ? (status?.downloads?.path || config?.downloads_dir) : 'La carpeta todavía no existe o no está configurada.'}
          ready={downloadsReady}
          pending={!hasStatus}
        />
      </div>
      {status?.slskd && !status.slskd.reachable && (
        <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
          Para habilitar las búsquedas, inicia slskd o configura la ruta de <strong>slskd.exe</strong> en Configuración local y guarda los cambios.
        </p>
      )}
      {config?.slskd_path && status?.slskd && !status.slskd.executableExists && (
        <p className="mt-3 text-sm text-red-200">La ruta configurada de slskd.exe no existe: {config.slskd_path}</p>
      )}
    </section>
  )
}
