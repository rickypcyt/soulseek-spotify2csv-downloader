import LibraryTree from './LibraryTree'
import { FONT_MONO, buildFolderTree } from '../constants'

export default function LibraryPanel({
  newLibraryFolderName,
  onNewFolderNameChange,
  onCreateFolder,
  config,
  onRefresh,
  diagnostics,
  libraryFiles,
  libraryFolders,
  dragOverFolder,
  onDragOverFolder,
  onMoveFile,
  storedFileStreamUrl,
  onDeleteFile,
}) {
  return (
    <div className="flex min-h-[calc(100dvh-15rem)] w-full min-w-0 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-[#2C303D] bg-[#161822] p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[#E9EAF0]">Nueva carpeta de playlist</p>
          <p className="mt-0.5 text-[10px] text-[#565C6E]">Crea un destino para arrastrar canciones o previews.</p>
        </div>
        <div className="flex min-w-0 gap-2 sm:w-[min(24rem,55%)]">
          <input
            value={newLibraryFolderName}
            onChange={(event) => onNewFolderNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCreateFolder()
            }}
            placeholder="Nombre de la playlist"
            className="min-w-0 flex-1 rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-xs text-[#E9EAF0] placeholder-[#565C6E] outline-none focus:border-[#FFFFFF]/60"
          />
          <button
            type="button"
            onClick={onCreateFolder}
            disabled={!newLibraryFolderName.trim()}
            className="rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/10 px-3 py-1.5 text-xs text-[#FFFFFF] disabled:cursor-not-allowed disabled:opacity-40"
          >
            crear
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#2C303D]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#2C303D] px-3 py-2">
          <div>
            <h2 className="text-xs text-[#8D93A6]">Biblioteca local</h2>
            <p className="mt-0.5 max-w-[245px] truncate text-[10px] text-[#565C6E]" title={config.downloads_dir}>
              {config.downloads_dir || 'sin configurar'}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
          >
            actualizar
          </button>
        </div>
        <div
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onDragOverFolder(null)
          }}
          onDrop={(event) => {
            event.preventDefault()
            onDragOverFolder(null)
            try {
              const source = JSON.parse(event.dataTransfer.getData('application/x-soulseek-file'))
              if (source?.path) onMoveFile(source, '')
            } catch {}
          }}
          className="min-h-0 flex-1 overflow-y-auto bg-[#0D0F16] p-3 text-[11px] text-[#E9EAF0]"
        >
          {!diagnostics ? (
            <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>cargando…</p>
          ) : libraryFiles.length > 0 || libraryFolders.length > 0 ? (
            <LibraryTree
              node={buildFolderTree(libraryFiles, libraryFolders)}
              fullNode={buildFolderTree(libraryFiles, libraryFolders)}
              dragOverFolder={dragOverFolder}
              onDragOverFolder={onDragOverFolder}
              onMoveFile={onMoveFile}
              storedFileStreamUrl={storedFileStreamUrl}
              onDeleteFile={onDeleteFile}
            />
          ) : (
            <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>la carpeta está vacía</p>
          )}
        </div>
      </div>
    </div>
  )
}
