import { useMemo, useState } from 'react'
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
  coverByPath,
  coverSourceByPath,
  onEmbedCover,
  onSearchCover,
  onRenameFile,
  onConvertFlac,
  onMoveToPlaylist,
  movePlaylists = [],
  onRevealFile,
  bpmByPath,
  onSyncBpm,
  onUpdateBpm,
  metadataByPath,
  onUpdateMetadata,
  onSearchMetadata,
  dragOverFolder,
  onDragOverFolder,
  onMoveFile,
  storedFileStreamUrl,
  onDeleteFile,
}) {
  const [librarySearch, setLibrarySearch] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const normalizedSearch = librarySearch.trim().toLowerCase()
  const filteredLibraryFiles = useMemo(() => normalizedSearch
    ? libraryFiles.filter((file) => file.path.toLowerCase().includes(normalizedSearch))
    : libraryFiles, [libraryFiles, normalizedSearch])
  const filteredLibraryFolders = useMemo(() => normalizedSearch
    ? libraryFolders.filter((folder) => folder.toLowerCase().includes(normalizedSearch))
    : libraryFolders, [libraryFolders, normalizedSearch])

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] w-full min-w-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#2C303D]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#2C303D] px-3 py-2">
          <div>
            <h2 className="text-xs text-[#8D93A6]">Biblioteca local</h2>
            <p className="mt-0.5 max-w-[245px] truncate text-[10px] text-[#565C6E]" title={config.downloads_dir}>
              {config.downloads_dir || 'sin configurar'}
            </p>
          </div>
          <input
            type="search"
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            placeholder="buscar en biblioteca"
            aria-label="Buscar en la biblioteca local"
            className="min-w-0 rounded border border-[#2C303D] bg-[#0D0F16] px-2.5 py-1.5 text-xs text-[#E9EAF0] placeholder-[#565C6E] outline-none focus:border-[#FFFFFF]/60 sm:w-56"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNewFolderOpen((open) => !open)}
              className="rounded border border-[#FFFFFF]/40 px-2 py-1 text-[10px] text-[#E9EAF0] transition-colors hover:bg-[#FFFFFF]/10"
            >
              nueva playlist
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="rounded border border-[#2C303D] px-2 py-1 text-[10px] text-[#8D93A6] transition-colors hover:border-[#FFFFFF]/40 hover:text-[#E9EAF0]"
            >
              actualizar
            </button>
          </div>
        </div>
        {newFolderOpen && (
          <div className="flex shrink-0 items-center gap-2 border-b border-[#2C303D] bg-[#161822] px-3 py-2">
            <input
              autoFocus
              value={newLibraryFolderName}
              onChange={(event) => onNewFolderNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCreateFolder()
                  setNewFolderOpen(false)
                }
              }}
              placeholder="Nombre de la playlist"
              className="min-w-0 flex-1 rounded border border-[#2C303D] bg-[#0D0F16] px-2 py-1.5 text-xs text-[#E9EAF0] placeholder-[#565C6E] outline-none focus:border-[#FFFFFF]/60"
            />
            <button
              type="button"
              onClick={() => {
                onCreateFolder()
                setNewFolderOpen(false)
              }}
              disabled={!newLibraryFolderName.trim()}
              className="rounded border border-[#FFFFFF]/40 px-3 py-1.5 text-xs text-[#FFFFFF] disabled:cursor-not-allowed disabled:opacity-40"
            >
              crear
            </button>
            <button type="button" onClick={() => setNewFolderOpen(false)} className="text-xs text-[#8D93A6] hover:text-[#E9EAF0]">
              cancelar
            </button>
          </div>
        )}
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
          ) : filteredLibraryFiles.length > 0 || filteredLibraryFolders.length > 0 ? (
            <LibraryTree
              node={buildFolderTree(filteredLibraryFiles, filteredLibraryFolders)}
              fullNode={buildFolderTree(filteredLibraryFiles, filteredLibraryFolders)}
              dragOverFolder={dragOverFolder}
              onDragOverFolder={onDragOverFolder}
              onMoveFile={onMoveFile}
              storedFileStreamUrl={storedFileStreamUrl}
              onDeleteFile={onDeleteFile}
              coverByPath={coverByPath}
              coverSourceByPath={coverSourceByPath}
              onEmbedCover={onEmbedCover}
              onSearchCover={onSearchCover}
              onRenameFile={onRenameFile}
              onConvertFlac={onConvertFlac}
              onMoveToPlaylist={onMoveToPlaylist}
              movePlaylists={movePlaylists}
              onRevealFile={onRevealFile}
              bpmByPath={bpmByPath}
              onSyncBpm={onSyncBpm}
              onUpdateBpm={onUpdateBpm}
              metadataByPath={metadataByPath}
              onUpdateMetadata={onUpdateMetadata}
              onSearchMetadata={onSearchMetadata}
            />
          ) : (
            <p className="text-[#8D93A6]" style={{ fontFamily: FONT_MONO }}>
              {normalizedSearch ? 'no se encontraron archivos' : 'la carpeta está vacía'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
