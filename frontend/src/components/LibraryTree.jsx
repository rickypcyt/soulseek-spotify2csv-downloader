import LibraryAudioCard from './LibraryAudioCard'
import {
  FILE_DRAG_TYPE,
  FONT_MONO,
  formatSize,
  getFolderStats,
  isLibraryFileDrag,
  isPlayableFile,
} from '../constants'

export default function LibraryTree({
  node,
  level = 0,
  fullNode = node,
  folderPath = '',
  dragOverFolder,
  onDragOverFolder,
  onMoveFile,
  storedFileStreamUrl,
  onDeleteFile,
}) {
  const folders = Object.entries(node.folders).sort(([a], [b]) => a.localeCompare(b))
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className={level > 0 ? 'ml-3 space-y-3 border-l-2 border-[#3A3F4E] pl-3' : 'grid grid-cols-1 gap-3 md:grid-cols-2'}>
      {folders.map(([name, folder]) => {
        const sourceFolder = fullNode.folders[name] || folder
        const stats = getFolderStats(sourceFolder)
        const destinationFolder = folderPath ? `${folderPath}/${name}` : name
        return (
          <details
            key={name}
            open={level === 0}
            onDragEnter={(event) => {
              if (!isLibraryFileDrag(event)) return
              event.preventDefault()
              event.stopPropagation()
              onDragOverFolder(destinationFolder)
            }}
            onDragOver={(event) => {
              if (!isLibraryFileDrag(event)) return
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'move'
              onDragOverFolder(destinationFolder)
            }}
            onDragLeave={(event) => {
              event.stopPropagation()
              if (!event.currentTarget.contains(event.relatedTarget)) {
                onDragOverFolder(null)
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onDragOverFolder(null)
              try {
                const source = JSON.parse(event.dataTransfer.getData(FILE_DRAG_TYPE))
                if (source?.path) onMoveFile(source, destinationFolder)
              } catch {}
            }}
            className={`min-w-0 overflow-hidden rounded-xl border bg-[#161822] shadow-[0_8px_22px_rgba(0,0,0,0.12)] transition-[opacity,border-color,background-color,box-shadow] duration-150 ${dragOverFolder === destinationFolder ? 'border-[#FFFFFF] bg-[#FFFFFF]/20 opacity-50 shadow-[0_0_0_2px_rgba(255,255,255,0.22),0_12px_30px_rgba(0,0,0,0.24)]' : 'border-[#343949]'}`}
          >
            <summary className="group list-none flex cursor-pointer items-center gap-3 px-4 py-3 text-[#E9EAF0] hover:bg-[#1A1D28] [&::-webkit-details-marker]:hidden">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#3A3F4E] bg-[#0D0F16] text-[#8D93A6]" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180">
                  <path d="M4 6.25 8 10l4-3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-[0.14em] text-[#8D93A6]">playlist</span>
                <span className="mt-0.5 block break-words text-sm font-semibold leading-snug" title={name}>{name}</span>
              </span>
              {dragOverFolder === destinationFolder && (
                <span className="shrink-0 rounded-full border border-[#FFFFFF]/60 bg-[#FFFFFF]/10 px-2 py-1 text-[10px] font-medium text-[#FFFFFF]">soltar aquí</span>
              )}
              <span className="shrink-0 rounded-full border border-[#3A3F4E] px-2 py-1 text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
                {stats.files} canciones · {formatSize(stats.size)}
              </span>
            </summary>
            <div className="border-t border-[#2C303D] bg-[#0D0F16] p-3">
              <LibraryTree
                node={folder}
                level={level + 1}
                fullNode={sourceFolder}
                folderPath={destinationFolder}
                dragOverFolder={dragOverFolder}
                onDragOverFolder={onDragOverFolder}
                onMoveFile={onMoveFile}
                storedFileStreamUrl={storedFileStreamUrl}
                onDeleteFile={onDeleteFile}
              />
            </div>
          </details>
        )
      })}
      {files.map((file) => (
        isPlayableFile(file) ? (
          <LibraryAudioCard
            key={file.path}
            file={file}
            streamUrl={storedFileStreamUrl('downloads', file.path)}
            formatSize={formatSize}
            dragDir="downloads"
            onDelete={(path) => {
              if (confirm(`¿Borrar ${path}?`)) onDeleteFile(path, 'downloads')
            }}
          />
        ) : (
          <div key={file.path} className="w-full min-w-0 rounded-lg border border-[#2C303D] bg-[#161822] p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#E9EAF0]" title={file.path}>{file.name}</span>
              <span className="shrink-0 text-[10px] text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>{formatSize(file.size)}</span>
              <button
                onClick={() => {
                  if (confirm(`¿Borrar ${file.path}?`)) onDeleteFile(file.path, 'downloads')
                }}
                className="shrink-0 rounded border border-[#6B7280]/40 px-2 py-1 text-[10px] text-[#8D93A6] hover:border-[#6B7280] hover:text-[#E9EAF0]"
              >
                borrar
              </button>
            </div>
          </div>
        )
      ))}
    </div>
  )
}
