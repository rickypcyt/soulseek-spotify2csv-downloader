export default function RecommendConfig({
  pickMode,
  onPickModeChange,
  formatPref,
  onFormatPrefChange,
}) {
  return (
    <section className="mb-6 rounded-xl border border-[#2C303D] bg-[#161822] p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#E9EAF0]">Configuración del track recomendado</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#8D93A6]">
            Define qué resultado se marca como recomendado antes de revisar y descargar. Esta preferencia se guarda en este navegador.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[#8D93A6]">
            <span className="sr-only">Criterio del recomendado</span>
            <select
              value={pickMode}
              onChange={(event) => onPickModeChange(event.target.value)}
              title="Criterio del track recomendado"
              className="rounded border border-[#2C303D] bg-[#0D0F16] px-2.5 py-2 text-xs text-[#E9EAF0] outline-none focus:border-[#FFFFFF]/60"
            >
              <option value="quality">mejor calidad</option>
              <option value="speed">más rápido</option>
              <option value="longest">más largo</option>
              <option value="balanced">balanceado</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[#8D93A6]">
            <span className="sr-only">Formato preferido</span>
            <select
              value={formatPref}
              onChange={(event) => onFormatPrefChange(event.target.value)}
              title="Formato preferido del recomendado"
              className="rounded border border-[#2C303D] bg-[#0D0F16] px-2.5 py-2 text-xs text-[#E9EAF0] outline-none focus:border-[#FFFFFF]/60"
            >
              <option value="any">cualquier formato</option>
              <option value="flac">FLAC</option>
              <option value="mp3">MP3</option>
              <option value="ogg">OGG</option>
              <option value="m4a">M4A</option>
            </select>
          </label>
        </div>
      </div>
    </section>
  )
}
