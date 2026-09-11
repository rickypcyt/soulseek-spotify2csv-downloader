export function StatusDot({ ok }) {
  return (
    <span className="relative flex h-2 w-2">
      {ok && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFFFFF] opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${ok ? 'bg-[#FFFFFF]' : 'bg-[#6B7280]'}`}
      />
    </span>
  )
}

export function Chip({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-[#21242F] text-[#8D93A6] border-[#2C303D]',
    amber: 'bg-[#FFFFFF]/10 text-[#FFFFFF] border-[#FFFFFF]/30',
    teal: 'bg-[#FFFFFF]/10 text-[#FFFFFF] border-[#FFFFFF]/30',
    coral: 'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/30',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${tones[tone]}`}
      style={{ fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace" }}
    >
      {children}
    </span>
  )
}

export function TrackCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Cargando canción"
      className="animate-pulse rounded-lg border border-[#2C303D] bg-[#161822] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-[#2C303D]" />
          <div className="h-3 w-1/2 rounded bg-[#21242F]" />
        </div>
        <div className="h-7 w-7 shrink-0 rounded-full bg-[#2C303D]" />
      </div>
      <div className="mt-4 h-3 w-2/5 rounded bg-[#21242F]" />
      <div className="mt-3 h-9 rounded-md bg-[#21242F]" />
      <span className="sr-only">Cargando canción…</span>
    </div>
  )
}

export function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-[#2C303D] bg-[#0D0F16] px-3 py-2 text-[10px] text-[#8D93A6]" style={{ fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace" }}>
      <span>página {page} de {pages} · {total} archivos</span>
      <div className="flex gap-1">
        <button disabled={page === 1} onClick={() => onChange(page - 1)} className="rounded border border-[#2C303D] px-2 py-1 disabled:opacity-30">anterior</button>
        <button disabled={page === pages} onClick={() => onChange(page + 1)} className="rounded border border-[#2C303D] px-2 py-1 disabled:opacity-30">siguiente</button>
      </div>
    </div>
  )
}

export function StatusItem({ label, description, ready, pending = false, readyLabel = 'Correcto' }) {
  const state = pending ? 'Pendiente' : ready ? readyLabel : 'Revisar'
  const color = pending
    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    : ready
      ? 'border-blue-400/40 bg-blue-400/10 text-blue-200'
      : 'border-red-400/40 bg-red-400/10 text-red-200'
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{label}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{description}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${color}`}>{state}</span>
      </div>
    </div>
  )
}
