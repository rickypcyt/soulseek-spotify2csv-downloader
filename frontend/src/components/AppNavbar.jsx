import { CheckCircle2, ChevronDown, LoaderCircle } from 'lucide-react'

const TAB_PATHS = {
  main: '/',
  settings: '/settings',
  logs: '/logs',
  library: '/library',
}

const FONT_DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif"
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"

export default function AppNavbar({ activeTab, navigate, libraryCount, pendingDownloadCount, queuedDownloadCount, activeDownloadCount }) {
  return (
    <header className="sticky top-0 z-30 mb-8 rounded-xl border border-[#2C303D] bg-[#161822] px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => navigate(TAB_PATHS.main)}
          className="min-w-0 border-0 bg-transparent p-0 text-left text-[#E9EAF0] hover:bg-transparent"
          aria-label="Ir a Principal"
        >
          <span className="block truncate text-lg leading-tight tracking-tight sm:text-xl" style={{ fontFamily: FONT_DISPLAY, fontWeight: 600 }}>
            Spotify <span className="text-[#8D93A6]">&rarr;</span> Soulseek
          </span>
        </button>

        <nav className="order-3 flex w-full flex-wrap items-center gap-1 border-t border-[#2C303D] pt-3 sm:order-2 sm:flex-nowrap sm:w-auto sm:flex-1 sm:justify-between sm:border-0 sm:pt-0" aria-label="Secciones">
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => navigate(TAB_PATHS.main)}
              aria-current={activeTab === 'main' ? 'page' : undefined}
              className={`shrink-0 rounded-md px-3 py-2 text-xs transition-colors ${activeTab === 'main' ? 'bg-[#2C303D] font-medium text-[#E9EAF0]' : 'border border-transparent text-[#8D93A6] hover:border-[#2C303D] hover:bg-[#1A1D28] hover:text-[#E9EAF0]'}`}
            >
              Principal
            </button>
            <details className="group relative">
              <summary
                onClick={() => navigate(TAB_PATHS.library)}
                className={`flex list-none cursor-pointer items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors [&::-webkit-details-marker]:hidden ${activeTab === 'library' ? 'bg-[#2C303D] font-medium text-[#E9EAF0]' : 'border border-transparent text-[#8D93A6] hover:border-[#2C303D] hover:bg-[#1A1D28] hover:text-[#E9EAF0]'}`}
              >
                Biblioteca
                <ChevronDown size={13} strokeWidth={2} className="transition-transform duration-150 group-open:rotate-180" />
              </summary>
              <div className="absolute left-0 top-full z-40 mt-2 w-64 rounded-lg border border-[#343949] bg-[#161822] p-3 shadow-[0_14px_32px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between border-b border-[#2C303D] pb-2">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>resumen</span>
                  <span className="rounded-full border border-[#3A3F4E] px-2 py-0.5 text-[10px] text-[#E9EAF0]" style={{ fontFamily: FONT_MONO }}>{libraryCount}</span>
                </div>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-[#8D93A6]"><CheckCircle2 size={14} className="text-[#7FD8CC]" /> canciones descargadas</span>
                    <strong className="text-[#E9EAF0]">{libraryCount}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-[#8D93A6]"><LoaderCircle size={14} className={pendingDownloadCount ? 'animate-spin text-[#FFFFFF]' : 'text-[#565C6E]'} /> pendientes o en cola</span>
                    <strong className={pendingDownloadCount ? 'text-[#FFFFFF]' : 'text-[#565C6E]'}>{pendingDownloadCount}</strong>
                  </div>
                  <div className="flex items-center justify-between pl-6 text-[10px] text-[#565C6E]" style={{ fontFamily: FONT_MONO }}>
                    <span>en cola · {queuedDownloadCount}</span>
                    <span>descargando · {activeDownloadCount}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    navigate(TAB_PATHS.library)
                    event.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                  className="mt-3 w-full rounded border border-[#2C303D] px-2 py-1.5 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
                >
                  abrir biblioteca
                </button>
              </div>
            </details>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-[#2C303D] pl-2 sm:border-l sm:pl-2 max-sm:border-l-0 max-sm:pl-0 max-sm:w-full max-sm:justify-end">
            {[['settings', 'Configuración'], ['logs', 'Logs']].map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => navigate(TAB_PATHS[tab])}
                aria-current={activeTab === tab ? 'page' : undefined}
                className={`shrink-0 rounded-md px-3 py-2 text-xs transition-colors ${activeTab === tab ? 'bg-[#2C303D] font-medium text-[#E9EAF0]' : 'border border-transparent text-[#8D93A6] hover:border-[#2C303D] hover:bg-[#1A1D28] hover:text-[#E9EAF0]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </header>
  )
}
