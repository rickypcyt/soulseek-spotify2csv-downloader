import { useCallback, useState } from 'react'
import { toast } from 'react-toastify'
import { request, requestJson } from '../api/client'

export function useLibraryOps({ outputFolderName, fetchDiagnostics }) {
  const [newLibraryFolderName, setNewLibraryFolderName] = useState('')
  const [dragOverLibraryFolder, setDragOverLibraryFolder] = useState(null)

  const deleteItem = useCallback(async (path, dir) => {
    try {
      const response = await request('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dir }),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || 'No se pudo borrar el archivo')
      await fetchDiagnostics()
      toast.success('Archivo eliminado')
    } catch (err) {
      toast.error(`No se pudo borrar: ${err.message}`)
    }
  }, [fetchDiagnostics])

  const cleanupAll = useCallback(async () => {
    if (!confirm('¿Borrar todos los temporales e incompletos?')) return
    try {
      await request('/api/cleanup', { method: 'POST' })
      fetchDiagnostics()
      toast.success('Temporales e incompletos eliminados')
    } catch (err) {
      toast.error('No se pudieron limpiar los temporales: ' + err.message)
    }
  }, [fetchDiagnostics])

  const cancelTransfer = useCallback(async (username, filename) => {
    try {
      const response = await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, filename }),
      })
      if (!response.ok) throw new Error(`slskd ${response.status}`)
      await fetchDiagnostics()
      toast.success(`Transferencia cancelada: ${filename}`)
    } catch (err) {
      toast.error(`No se pudo cancelar la transferencia: ${err.message}`)
    }
  }, [fetchDiagnostics])

  const saveTemporaryPreviewToLibrary = useCallback(async (path, folderName = '') => {
    const targetFolder = folderName.trim() || outputFolderName.trim()
    if (!targetFolder) {
      toast.info('Escribe una carpeta de playlist para mover el preview')
      return false
    }
    try {
      await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folder_name: targetFolder }),
      })
      await fetchDiagnostics()
      toast.success('Preview movido a la biblioteca')
      return true
    } catch (err) {
      toast.error('No se pudo mover a la biblioteca: ' + err.message)
      return false
    }
  }, [outputFolderName, fetchDiagnostics])

  const movePreviewToFolder = useCallback(async (path, targetFolder) => {
    try {
      await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folder_name: targetFolder }),
      })
      await fetchDiagnostics()
      toast.success(`Preview movido a ${targetFolder}`)
    } catch (err) {
      toast.error('No se pudo mover el preview al playlist: ' + err.message)
    }
  }, [fetchDiagnostics])

  const renameLibraryFile = useCallback(async (path, { preview = false } = {}) => {
    const endpoint = preview ? '/api/library/rename/preview' : '/api/library/rename'
    try {
      const data = await requestJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (!preview) {
        await fetchDiagnostics()
        toast.success(`Archivo renombrado: ${data.path}`)
      }
      return data
    } catch (err) {
      if (!preview) {
        toast.error('No se pudo renombrar el archivo: ' + err.message)
      } else {
        throw err
      }
    }
  }, [fetchDiagnostics])

  const moveLibraryFile = useCallback(async (source, targetFolder) => {
    if (source.dir === 'previews') {
      await movePreviewToFolder(source.path, targetFolder)
      return
    }
    try {
      await requestJson('/api/library/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_dir: source.dir,
          source_path: source.path,
          target_folder: targetFolder,
        }),
      })
      await fetchDiagnostics()
      toast.success(`Archivo movido${targetFolder ? ` a ${targetFolder}` : ''}`)
    } catch (err) {
      toast.error('No se pudo mover el archivo: ' + err.message)
    }
  }, [movePreviewToFolder, fetchDiagnostics])

  const createLibraryFolder = useCallback(async () => {
    const folderName = newLibraryFolderName.trim()
    if (!folderName) return
    try {
      await requestJson('/api/library/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_name: folderName }),
      })
      setNewLibraryFolderName('')
      await fetchDiagnostics()
      toast.success(`Playlist creada: ${folderName}`)
    } catch (err) {
      toast.error('No se pudo crear la carpeta: ' + err.message)
    }
  }, [newLibraryFolderName, fetchDiagnostics])

  return {
    newLibraryFolderName,
    setNewLibraryFolderName,
    dragOverLibraryFolder,
    setDragOverLibraryFolder,
    deleteItem,
    cleanupAll,
    cancelTransfer,
    saveTemporaryPreviewToLibrary,
    moveLibraryFile,
    renameLibraryFile,
    createLibraryFolder,
  }
}
