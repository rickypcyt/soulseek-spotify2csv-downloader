import { useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Music2, X } from 'lucide-react'

const STEPS = [
  { id: 'downloads', title: 'Carpeta de descargas', icon: Download },
  { id: 'soulseek', title: 'Cuenta de Soulseek', icon: Music2 },
  { id: 'spotify', title: 'Cuenta de Spotify', icon: CheckCircle2 },
]

const inputClass =
  'mt-1 w-full rounded border border-[#2C303D] bg-[#0D0F16] px-2.5 py-2 text-sm text-[#E9EAF0] placeholder-[#565C6E] outline-none transition-colors focus:border-[#FFFFFF]/60'

export default function WelcomeWizard({
  config,
  onChange,
  onSave,
  saving,
  defaultDownloadsDir,
  spotifyAuth,
  onStartSpotifyAuth,
  onDone,
}) {
  const [step, setStep] = useState(0)
  const update = (key, value) => onChange((current) => ({ ...current, [key]: value }))

  const isLast = step === STEPS.length - 1
  const spotifyReady = Boolean(config.spotify_client_id) &&
    (Boolean(config.spotify_client_secret) || Boolean(config.spotify_client_secret_configured))

  const finish = async (connectSpotify) => {
    await onSave()
    if (connectSpotify && spotifyReady) onStartSpotifyAuth()
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0D13]/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-[#2C303D] bg-[#161822] shadow-2xl">
        {/* header */}
        <div className="flex items-start justify-between border-b border-[#2C303D] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#E9EAF0]">Bienvenido a Spotify → Soulseek</h2>
            <p className="mt-0.5 text-xs text-[#8D93A6]">
              Configuración inicial · paso {step + 1} de {STEPS.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onDone}
            title="Configurar más tarde"
            className="rounded p-1 text-[#8D93A6] transition-colors hover:bg-[#FFFFFF]/10 hover:text-[#E9EAF0]"
          >
            <X size={18} />
          </button>
        </div>

        {/* progress */}
        <div className="flex gap-1.5 px-6 pt-4">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-[#7FD8CC]' : 'bg-[#2C303D]'}`}
            />
          ))}
        </div>

        {/* body */}
        <div className="px-6 py-5">
          {step === 0 && (
            <div>
              <h3 className="text-base font-medium text-[#E9EAF0]">¿Dónde guardamos tu música?</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#8D93A6]">
                Aquí se guardarán las canciones que descargues y los previews que conserves en la biblioteca.
              </p>
              <label className="mt-4 block text-sm font-medium text-slate-200">
                Carpeta de descargas
                <input
                  value={config.downloads_dir || ''}
                  onChange={(event) => update('downloads_dir', event.target.value)}
                  placeholder={defaultDownloadsDir || 'C:\\Users\\...\\Music\\Soulseek Downloads'}
                  className={inputClass}
                />
              </label>
              <p className="mt-2 text-xs text-[#8D93A6]">
                Si la dejas vacía se usará: {defaultDownloadsDir || 'la carpeta de música por defecto'}.
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h3 className="text-base font-medium text-[#E9EAF0]">Tu cuenta de Soulseek</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#8D93A6]">
                Se usa para buscar y descargar en la red. Si no tienes cuenta, elige un usuario y contraseña nuevos:
                Soulseek la crea automáticamente en el primer inicio de sesión.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-200">
                  Usuario Soulseek
                  <input
                    value={config.soulseek_username || ''}
                    onChange={(event) => update('soulseek_username', event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-200">
                  Contraseña Soulseek
                  <input
                    type="password"
                    placeholder={config.soulseek_password_configured ? 'guardada' : ''}
                    value={config.soulseek_password || ''}
                    onChange={(event) => update('soulseek_password', event.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-[#8D93A6]">
                La contraseña se guarda en el almacén seguro de Windows, nunca en archivos.
              </p>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 className="text-base font-medium text-[#E9EAF0]">Conecta Spotify</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#8D93A6]">
                Necesario para cargar tus playlists. Crea una app en{' '}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#E9EAF0] underline decoration-dotted underline-offset-2 hover:text-white"
                >
                  developer.spotify.com
                </a>{' '}
                y registra esta Redirect URI:
              </p>
              <code className="mt-2 block rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-[11px] text-[#E9EAF0]">
                http://127.0.0.1:8080/callback
              </code>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-200">
                  Spotify Client ID
                  <input
                    value={config.spotify_client_id || ''}
                    onChange={(event) => update('spotify_client_id', event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-200">
                  Spotify Client Secret
                  <input
                    type="password"
                    placeholder={config.spotify_client_secret_configured ? 'guardado' : ''}
                    value={config.spotify_client_secret || ''}
                    onChange={(event) => update('spotify_client_secret', event.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              {spotifyAuth?.status === 'authenticated' && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-[#7FD8CC]">
                  <CheckCircle2 size={14} /> Spotify conectado.
                </p>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-[#2C303D] px-6 py-4">
          <button
            type="button"
            onClick={onDone}
            className="text-xs text-[#8D93A6] transition-colors hover:text-[#E9EAF0]"
          >
            configurar más tarde
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1 rounded border border-[#2C303D] px-3 py-1.5 text-xs text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
              >
                <ChevronLeft size={14} /> atrás
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="flex items-center gap-1 rounded bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#161822] transition-colors hover:bg-[#E9EAF0]"
              >
                siguiente <ChevronRight size={14} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => finish(false)}
                  disabled={saving}
                  className="rounded border border-[#2C303D] px-3 py-1.5 text-xs text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0] disabled:opacity-50"
                >
                  {saving ? 'guardando…' : 'guardar y terminar'}
                </button>
                <button
                  type="button"
                  onClick={() => finish(true)}
                  disabled={saving || !spotifyReady || spotifyAuth?.status === 'authenticating'}
                  title={spotifyReady ? 'Guardar y autorizar Spotify' : 'Completa Client ID y Client Secret'}
                  className="flex items-center gap-1 rounded bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#161822] transition-colors hover:bg-[#E9EAF0] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {spotifyAuth?.status === 'authenticating' ? 'autorizando…' : 'guardar y conectar Spotify'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
