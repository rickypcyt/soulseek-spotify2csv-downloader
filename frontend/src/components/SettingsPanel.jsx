export default function SettingsPanel({ config, onChange, onSave, saving, spotifyAuth, onStartSpotifyAuth, open = false }) {
  const update = (key, value) => onChange((current) => ({ ...current, [key]: value }))

  return (
    <details open={open} className="mb-8 rounded-xl border border-slate-600 bg-slate-800">
      <summary className="cursor-pointer px-5 py-4 text-base font-semibold text-slate-100">
        Configuración local
      </summary>
      <div className="border-t border-slate-600 p-5">
        <div className={`rounded-lg border p-4 ${spotifyAuth?.status === 'authenticated' ? 'border-blue-400/40 bg-blue-400/10' : 'border-slate-600 bg-slate-900/40'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Spotify</h3>
              <p className="mt-1 text-xs text-slate-300">
                {spotifyAuth?.status === 'authenticated'
                  ? 'Spotify está conectado. Puedes cargar playlists privadas.'
                  : spotifyAuth?.status === 'authenticating'
                    ? 'Completa la autorización en la ventana del navegador…'
                    : spotifyAuth?.status === 'not_configured'
                      ? 'Guarda primero Client ID y Client Secret.'
                      : 'Spotify necesita autorización para leer tus playlists.'}
              </p>
              {spotifyAuth?.error && <p className="mt-2 text-xs text-red-200">{spotifyAuth.error}</p>}
            </div>
            <span className="rounded-full border border-slate-500 px-2.5 py-1 text-[11px] text-slate-200">
              {spotifyAuth?.status === 'authenticated' ? 'conectado' : spotifyAuth?.status === 'authenticating' ? 'autorizando…' : 'no conectado'}
            </span>
            <button
              type="button"
              onClick={onStartSpotifyAuth}
              disabled={spotifyAuth?.status === 'authenticating' || !config.spotify_client_id || !config.spotify_client_secret_configured}
              className="rounded bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#161822] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {spotifyAuth?.status === 'authenticated' ? 'reautorizar Spotify' : 'conectar Spotify'}
            </button>
          </div>
        </div>
      </div>
      <form
        className="grid grid-cols-1 gap-5 border-t border-slate-600 p-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <p className="sm:col-span-2 text-sm leading-relaxed text-slate-300">
          Completa estos datos una sola vez para conectar Spotify y Soulseek. Los campos secretos se guardan de forma segura y no se vuelven a mostrar.
        </p>
        <details className="sm:col-span-2 rounded border border-[#2C303D] bg-[#0D0F16] p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-200">¿Cómo consigo las credenciales de Spotify?</summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-[#8D93A6]">
            <li>
              Abre la página oficial de aplicaciones de Spotify:{' '}
              <a
                href="https://developer.spotify.com/documentation/web-api/concepts/apps"
                target="_blank"
                rel="noreferrer"
                className="text-[#E9EAF0] underline decoration-dotted underline-offset-2 hover:text-white"
              >
                developer.spotify.com
              </a>
            </li>
            <li>Inicia sesión con tu cuenta de Spotify Developer y crea una aplicación.</li>
            <li>Copia el <strong className="text-slate-200">Client ID</strong> en el campo de arriba.</li>
            <li>En la aplicación de Spotify, abre <strong className="text-slate-200">Settings</strong> y copia el <strong className="text-slate-200">Client Secret</strong>.</li>
            <li>Añade esta Redirect URI exactamente como está escrita:</li>
          </ol>
          <code className="mt-2 block rounded border border-[#2C303D] bg-[#161822] px-2 py-1.5 text-[11px] text-[#E9EAF0]">http://127.0.0.1:8080/callback</code>
          <p className="mt-3 text-xs leading-relaxed text-[#8D93A6]">
            No compartas el Client Secret ni lo publiques. Después de guardar estos campos, pulsa <strong className="text-slate-200">conectar Spotify</strong> para autorizar tus playlists.
          </p>
        </details>
        <label className="text-sm font-medium text-slate-200">
          Spotify Client ID
          <input
            value={config.spotify_client_id || ''}
            onChange={(event) => update('spotify_client_id', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-sm font-medium text-slate-200">
          Spotify Client Secret
          <input
            type="password"
            placeholder={config.spotify_client_secret_configured ? 'guardado' : ''}
            value={config.spotify_client_secret || ''}
            onChange={(event) => update('spotify_client_secret', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <div className="rounded border border-[#2C303D] bg-[#0D0F16] p-3 text-sm text-slate-200">
          <p className="font-medium">slskd local</p>
          <p className="mt-1 text-xs text-[#8D93A6]">La aplicación usa automáticamente {config.slskd_url || 'http://127.0.0.1:5030'}.</p>
        </div>
        <label className="text-sm font-medium text-slate-200">
          API key de slskd
          <input
            type="password"
            placeholder={config.slskd_api_key_configured ? 'guardada' : ''}
            value={config.slskd_api_key || ''}
            onChange={(event) => update('slskd_api_key', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-sm font-medium text-slate-200">
          Usuario Soulseek
          <input
            value={config.soulseek_username || ''}
            onChange={(event) => update('soulseek_username', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-sm font-medium text-slate-200">
          Contraseña Soulseek
          <input
            type="password"
            placeholder={config.soulseek_password_configured ? 'guardada' : ''}
            value={config.soulseek_password || ''}
            onChange={(event) => update('soulseek_password', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-sm font-medium text-slate-200">
          Ruta de slskd.exe
          <input
            value={config.slskd_path || ''}
            onChange={(event) => update('slskd_path', event.target.value)}
            placeholder="C:\\...\\slskd.exe"
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-sm font-medium text-slate-200 sm:col-span-2">
          Carpeta de descargas
          <input
            value={config.downloads_dir || ''}
            onChange={(event) => update('downloads_dir', event.target.value)}
            placeholder="C:\\Users\\...\\Music"
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between sm:col-span-2">
          <p className="text-sm leading-relaxed text-slate-300">
            Los secretos se guardan en el almacén seguro del sistema y nunca se muestran otra vez.
          </p>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#161822] disabled:opacity-50"
          >
            {saving ? 'guardando…' : 'guardar configuración'}
          </button>
        </div>
      </form>
    </details>
  )
}
