import { Github } from 'lucide-react'

const FONT_DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif"
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"
const GITHUB_URL = 'https://github.com/rickypcyt/soulseek-spotify2csv-downloader'
const SLSKD_URL = 'https://github.com/slskd/slskd'

export default function AppFooter() {
  return (
    <footer className="mt-12 border-t border-[#2C303D] pt-7 text-[#8D93A6]" aria-label="Información de la aplicación">
      <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="text-sm font-semibold text-[#E9EAF0]" style={{ fontFamily: FONT_DISPLAY }}>Spotify <span className="text-[#8D93A6]">&rarr;</span> Soulseek</p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-[#8D93A6]">
            Herramienta local para organizar búsquedas y administrar tu biblioteca de audio con más control y transparencia.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-xs text-[#E9EAF0] transition-colors hover:text-[#FFFFFF]"
          >
            <Github size={15} strokeWidth={1.8} />
            <span>Ver el proyecto en GitHub</span>
          </a>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#E9EAF0]" style={{ fontFamily: FONT_MONO }}>Base de datos local</p>
          <p className="mt-2 text-xs leading-relaxed text-[#8D93A6]">
            La base de datos, la configuración, los índices y los registros se guardan localmente en este equipo. Tus archivos permanecen bajo tu control.
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#E9EAF0]" style={{ fontFamily: FONT_MONO }}>Gracias a slskd</p>
          <p className="mt-2 text-xs leading-relaxed text-[#8D93A6]">
            Usamos <a href={SLSKD_URL} target="_blank" rel="noreferrer" className="text-[#E9EAF0] underline decoration-[#565C6E] underline-offset-2 hover:text-[#FFFFFF]">slskd</a> para conectar esta interfaz con Soulseek y gestionar búsquedas, previews y descargas de forma local.
          </p>
        </div>
      </div>
      <div className="mt-7 flex flex-col gap-2 border-t border-[#2C303D] pt-4 text-[10px] text-[#565C6E] sm:flex-row sm:items-center sm:justify-between" style={{ fontFamily: FONT_MONO }}>
        <span>aplicación local · control de tus archivos · sin publicidad</span>
        <span>hecho con herramientas abiertas</span>
      </div>
    </footer>
  )
}
