import { LoaderCircle, RefreshCw, X } from 'lucide-react'

const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"

export default function PlaylistTabBar({ tabs, activeKey, meta = {}, onSelect, onClose, onRefresh }) {
  if (tabs.length === 0) return null
  return (
    <div
      className="mt-1 flex items-center gap-1 overflow-x-auto rounded-lg border border-[#2C303D] bg-[#161822] px-1.5 py-1.5"
      role="tablist"
      aria-label="Playlists abiertas"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey
        const info = meta[tab.key] || {}
        const label = info.name || tab.name || tab.url
        const busy = Boolean(info.loading)
        const activity = (info.queued || 0) + (info.active || 0) + (info.searches || 0)
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            className={`group flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? 'bg-[#2C303D] font-medium text-[#E9EAF0]'
                : 'border border-transparent text-[#8D93A6] hover:border-[#2C303D] hover:bg-[#1A1D28] hover:text-[#E9EAF0]'
            }`}
            onClick={() => onSelect(tab.key)}
            title={tab.url}
          >
            {busy
              ? <LoaderCircle size={12} className="shrink-0 animate-spin text-[#7FD8CC]" />
              : activity > 0
                ? <LoaderCircle size={12} className="shrink-0 animate-spin text-[#565C6E]" />
                : null}
            <span style={{ fontFamily: FONT_MONO }}>
              {label}
            </span>
            {typeof info.trackCount === 'number' && info.trackCount > 0 && (
              <span className="shrink-0 rounded-full border border-[#3A3F4E] px-1.5 py-px text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
                {info.trackCount}
              </span>
            )}
            <button
              type="button"
              title="Refrescar playlist"
              aria-label={`Refrescar ${label}`}
              onClick={(event) => {
                event.stopPropagation()
                onRefresh(tab.key)
              }}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[#3A3F4E] hover:text-[#FFFFFF] ${isActive ? 'text-[#8D93A6]' : 'text-[#565C6E]'}`}
            >
              <RefreshCw size={11} />
            </button>
            <button
              type="button"
              title="Cerrar pestaña"
              aria-label={`Cerrar ${label}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.key)
              }}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[#3A3F4E] hover:text-[#FFFFFF] ${isActive ? 'text-[#8D93A6]' : 'text-[#565C6E]'}`}
            >
              <X size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
