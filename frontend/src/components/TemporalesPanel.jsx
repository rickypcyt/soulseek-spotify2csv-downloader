import { ChevronDown } from 'lucide-react'
import LibraryAudioCard from './LibraryAudioCard'
import TransferRow from './TransferRow'
import { Pagination } from './ui'
import { FONT_MONO, PREVIEW_PAGE_SIZE, formatSize } from '../constants'

export default function TemporalesPanel({
  diagnostics,
  activeTransfers,
  completedTransfers,
  completedTransfersOpen,
  onToggleCompletedTransfers,
  onCleanupAll,
  onCancelTransfer,
  visiblePreviewFiles,
  previewFilesCount,
  currentPreviewPage,
  onPreviewPageChange,
  storedFileStreamUrl,
  onSaveTemporaryPreview,
  localPlaylists = [],
  onSearchCover,
  onRevealFile,
  onDeleteFile,
}) {
  return (
    <div className="flex min-h-[calc(100dvh-9rem)] w-full min-w-0 flex-col rounded-lg border border-[#2C303D]">
      <div className="flex items-center justify-between border-b border-[#2C303D] px-3 py-2">
        <h2 className="text-xs text-[#8D93A6]">temporales</h2>
        <button
          onClick={onCleanupAll}
          className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#FFFFFF] transition-colors hover:bg-[#FFFFFF]/10"
        >
          limpiar todo
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#0D0F16] p-3 text-[11px] text-[#E9EAF0]">
        {!diagnostics ? (
          <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>cargando…</p>
        ) : (
          <div className="space-y-3">
            {activeTransfers.length > 0 && (
              <div>
                <p className="mb-1 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>slskd · activos</p>
                <div className="space-y-1">
                  {activeTransfers.map((transfer, index) => (
                    <TransferRow key={`${transfer.username}-${transfer.filename}-${index}`} transfer={transfer} index={index} onCancel={onCancelTransfer} />
                  ))}
                </div>
              </div>
            )}
            {completedTransfers.length > 0 && (
              <details
                open={completedTransfersOpen}
                onToggle={(event) => onToggleCompletedTransfers(event.currentTarget.open)}
                className="group rounded border border-[#2C303D] bg-[#161822]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[#8D93A6] [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2" style={{ fontFamily: FONT_MONO }}>
                    <span>slskd · finalizados</span>
                    <span className="rounded-full border border-[#3A3F4E] px-1.5 py-0.5 text-[10px] text-[#E9EAF0]">{completedTransfers.length}</span>
                  </span>
                  <ChevronDown size={13} className="transition-transform duration-150 group-open:rotate-180" />
                </summary>
                {completedTransfersOpen && (
                  <div className="space-y-1 border-t border-[#2C303D] px-2 py-1.5">
                    {completedTransfers.map((transfer, index) => (
                      <TransferRow key={`${transfer.username}-${transfer.filename}-${index}`} transfer={transfer} index={index} completed onCancel={onCancelTransfer} />
                    ))}
                  </div>
                )}
              </details>
            )}
            {diagnostics.previews?.length > 0 && (
              <div>
                <p className="mb-1 text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>previews</p>
                <div className="space-y-3">
                  {visiblePreviewFiles.map((f) => (
                    <LibraryAudioCard
                      key={f.path}
                      file={{ ...f, name: f.path.split('/').pop() || f.path }}
                      streamUrl={storedFileStreamUrl('previews', f.path)}
                      coverUrl={`/api/library/cover?dir=previews&path=${encodeURIComponent(f.path)}`}
                      onDownload={onSaveTemporaryPreview}
                      downloadPlaylists={localPlaylists}
                      onSearchCover={onSearchCover}
                      onRevealFile={onRevealFile}
                      downloadLabel="guardar en biblioteca"
                      layout="horizontal"
                      formatSize={formatSize}
                      dragDir="previews"
                      onDelete={(path) => {
                        if (confirm(`¿Borrar ${path}?`)) onDeleteFile(path, 'previews')
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            {diagnostics.previews?.length === 0 &&
              diagnostics.transfers?.length === 0 && (
                <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>sin temporales</p>
              )}
          </div>
        )}
      </div>
      <Pagination page={currentPreviewPage} total={previewFilesCount} pageSize={PREVIEW_PAGE_SIZE} onChange={onPreviewPageChange} />
    </div>
  )
}
