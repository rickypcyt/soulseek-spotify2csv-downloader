export default function SettingsPanel({ config, onChange, onSave, saving }) {
  const update = (key, value) => onChange((current) => ({ ...current, [key]: value }))

  return (
    <details className="mb-6 rounded-lg border border-[#2C303D] bg-[#161822]">
      <summary className="cursor-pointer px-4 py-3 text-sm text-[#E9EAF0]">
        configuración local
      </summary>
      <form
        className="grid grid-cols-1 gap-3 border-t border-[#2C303D] p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <label className="text-xs text-[#8D93A6]">
          Spotify Client ID
          <input
            value={config.spotify_client_id || ''}
            onChange={(event) => update('spotify_client_id', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-xs text-[#8D93A6]">
          Spotify Client Secret
          <input
            type="password"
            placeholder={config.spotify_client_secret_configured ? 'guardado' : ''}
            value={config.spotify_client_secret || ''}
            onChange={(event) => update('spotify_client_secret', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-xs text-[#8D93A6]">
          URL de slskd
          <input
            value={config.slskd_url || ''}
            onChange={(event) => update('slskd_url', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-xs text-[#8D93A6]">
          API key de slskd
          <input
            type="password"
            placeholder={config.slskd_api_key_configured ? 'guardada' : ''}
            value={config.slskd_api_key || ''}
            onChange={(event) => update('slskd_api_key', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-xs text-[#8D93A6]">
          Usuario Soulseek
          <input
            value={config.soulseek_username || ''}
            onChange={(event) => update('soulseek_username', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-xs text-[#8D93A6]">
          Contraseña Soulseek
          <input
            type="password"
            placeholder={config.soulseek_password_configured ? 'guardada' : ''}
            value={config.soulseek_password || ''}
            onChange={(event) => update('soulseek_password', event.target.value)}
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-xs text-[#8D93A6]">
          Ruta de slskd.exe
          <input
            value={config.slskd_path || ''}
            onChange={(event) => update('slskd_path', event.target.value)}
            placeholder="C:\\...\\slskd.exe"
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <label className="text-xs text-[#8D93A6] sm:col-span-2">
          Carpeta de descargas
          <input
            value={config.downloads_dir || ''}
            onChange={(event) => update('downloads_dir', event.target.value)}
            placeholder="C:\\Users\\...\\Music"
            className="mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-sm text-[#E9EAF0]"
          />
        </label>
        <div className="flex items-center justify-between sm:col-span-2">
          <p className="text-[11px] text-[#565C6E]">
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
