const FONT_DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif"
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"

export default function AppFooter() {
  return (
    <footer className="mt-12 border-t border-[#2C303D] pt-7 text-[#8D93A6]" aria-label="Información de la aplicación">
      <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="text-sm font-semibold text-[#E9EAF0]" style={{ fontFamily: FONT_DISPLAY }}>Spotify <span className="text-[#8D93A6]">&rarr;</span> Soulseek</p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-[#8D93A6]">
            Herramienta local para organizar búsquedas y administrar tu biblioteca de audio con más control y transparencia.
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#E9EAF0]" style={{ fontFamily: FONT_MONO }}>Privacidad</p>
          <p className="mt-2 text-xs leading-relaxed text-[#8D93A6]">
            La configuración, los índices y los registros se guardan localmente en este equipo. Las búsquedas se envían únicamente a los servicios que configures para realizarlas.
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#E9EAF0]" style={{ fontFamily: FONT_MONO }}>Uso responsable</p>
          <p className="mt-2 text-xs leading-relaxed text-[#8D93A6]">
            Descarga y conserva únicamente contenido que tengas derecho a usar. Spotify y Soulseek son servicios independientes; esta herramienta no está afiliada a ellos.
          </p>
        </div>
      </div>
      <div className="mt-7 flex flex-col gap-2 border-t border-[#2C303D] pt-4 text-[10px] text-[#565C6E] sm:flex-row sm:items-center sm:justify-between" style={{ fontFamily: FONT_MONO }}>
        <span>aplicación local · control de tus archivos · sin publicidad</span>
        <span>Privacidad y responsabilidad primero</span>
      </div>
    </footer>
  )
}
