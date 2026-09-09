export default function SettingsPanel({ config, onChange, onSave, saving }) {
  const update = (key, value) => onChange((current) => ({ ...current, [key]: value }))

  return (
    <details className="mb-8 rounded-xl border border-slate-600 bg-slate-800">
      <summary className="cursor-pointer px-5 py-4 text-base font-semibold text-slate-100">
        Configuración local
      </summary>
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
        <label className="text-sm font-medium text-slate-200">
          URL de slskd
          <input
            value={config.slskd_url || ''}
            onChange={(event) => update('slskd_url', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
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
