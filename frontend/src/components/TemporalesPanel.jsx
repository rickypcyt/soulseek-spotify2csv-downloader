import LibraryAudioCard from './LibraryAudioCard'
import { FONT_MONO, formatSize } from '../constants'

export default function TemporalesPanel({
  diagnostics,
  onCleanupAll,
  previewFiles = [],
  storedFileStreamUrl,
  onSaveTemporaryPreview,
  quickSaveLabel = '',
  onQuickSave,
  localPlaylists = [],
  onSearchCover,
  onRevealFile,
  onDeleteFile,
}) {
  return (
    <div className="flex w-full min-w-0 flex-col rounded-lg border border-[#2C303D]">
      <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
        <h2 className="text-xs text-[#8D93A6]">temporales</h2>
        <button
          onClick={onCleanupAll}
          className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
        >
          limpiar todo
        </button>
      </div>
      <div className="bg-[#0D0F16] p-3 text-[11px] text-[#E9EAF0]">
        {!diagnostics ? (
          <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>cargando…</p>
        ) : (
          <div className="space-y-3">
            {diagnostics.previews?.length > 0 && (
              <div>
                <p className="mb-1 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>previews</p>
                <div className="grid grid-cols-2 gap-3">
                  {previewFiles.map((f) => (
                    <div key={f.path} className="min-w-0">
                      <LibraryAudioCard
                        file={{ ...f, name: f.path.split('/').pop() || f.path }}
                        streamUrl={storedFileStreamUrl('previews', f.path)}
                        coverUrl={`/api/library/cover?dir=previews&path=${encodeURIComponent(f.path)}`}
                        onDownload={onSaveTemporaryPreview}
                        quickSaveLabel={quickSaveLabel}
                        onQuickSave={onQuickSave}
                        downloadPlaylists={localPlaylists}
                        onSearchCover={onSearchCover}
                        onRevealFile={onRevealFile}
                        downloadLabel="guardar en otra carpeta"
                        layout="horizontal"
                        formatSize={formatSize}
                        dragDir="previews"
                        onDelete={(path) => {
                          if (confirm(`¿Borrar ${path}?`)) onDeleteFile(path, 'previews')
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {diagnostics.previews?.length === 0 && (
              <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>sin temporales</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
