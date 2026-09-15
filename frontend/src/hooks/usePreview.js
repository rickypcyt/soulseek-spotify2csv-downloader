import { useCallback, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { request, requestJson } from '../api/client'
import { trackIdentity } from '../utils/spotify'

function previewKey(username, filename) {
  return `${username}|${filename}`
}

export function usePreview({ tracks, outputFolderName, playlistKey, fetchDiagnostics }) {
  const [previews, setPreviews] = useState({})
  const previewTimers = useRef({})
  const previewFolders = useRef({})

  const stopPreviewTimer = useCallback((key) => {
    if (previewTimers.current[key]) {
      clearInterval(previewTimers.current[key])
      delete previewTimers.current[key]
    }
  }, [])

  const updatePreview = useCallback((key, preview) => {
    setPreviews((current) => ({ ...current, [key]: preview }))
  }, [])

  const cancelPreview = useCallback(async (res) => {
    const key = previewKey(res.username, res.filename)
    stopPreviewTimer(key)
    setPreviews((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    try {
      await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: res.username, filename: res.filename }),
      })
    } catch {}
  }, [stopPreviewTimer])

  const savePreviewToLibrary = useCallback(async (preview, folderName = '') => {
    if (!preview?.path || preview.savedPath) return
    const key = previewKey(preview.username, preview.filename)
    const targetFolder = folderName.trim() || previewFolders.current[key]?.trim() || outputFolderName.trim()
    if (!targetFolder) {
      toast.info('Elige una carpeta de playlist para guardar el preview')
      return
    }
    try {
      const data = await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: preview.path,
          folder_name: targetFolder,
          playlist_key: playlistKey,
          track_key: preview.trackKey,
          track_name: preview.trackName,
          artists: preview.artists,
          cover_url: preview.coverUrl,
        }),
      })
      updatePreview(key, { ...preview, savedPath: data.path })
      fetchDiagnostics()
      toast.success('Preview guardado en la biblioteca')
    } catch (err) {
      toast.error('No se pudo guardar el preview: ' + err.message)
    }
  }, [outputFolderName, playlistKey, fetchDiagnostics, updatePreview])

  const discardActivePreview = useCallback(async (preview) => {
    if (!preview?.path || preview.savedPath) return
    const key = previewKey(preview.username, preview.filename)
    try {
      await requestJson('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: preview.path, dir: 'previews' }),
      })
      await fetchDiagnostics()
      stopPreviewTimer(key)
      setPreviews((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      toast.success('Preview descartado y eliminado')
    } catch (err) {
      toast.error('No se pudo descartar el preview: ' + err.message)
    }
  }, [fetchDiagnostics, stopPreviewTimer])

  const startPreview = useCallback(async (res, trackIndex, folderName = '') => {
    const key = previewKey(res.username, res.filename)
    const existing = previews[key]
    if (existing && !existing.error && existing.state !== 'completado') return
    stopPreviewTimer(key)
    previewFolders.current[key] = folderName.trim()
    const base = {
      username: res.username,
      filename: res.filename,
      trackKey: trackIdentity(tracks[trackIndex]),
      trackName: tracks[trackIndex]?.track_name,
      artists: tracks[trackIndex]?.artists,
      coverUrl: tracks[trackIndex]?.cover_url,
      size: res.size,
    }
    updatePreview(key, {
      ...base,
      state: 'encolando',
      transferState: 'queued',
      percent: 0,
      path: null,
      error: null,
    })
    try {
      const r = await request('/api/preview_audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: res.username, filename: res.filename, size: res.size }),
      })
      const data = await r.json()
      if (data.error) {
        updatePreview(key, {
          ...base,
          state: data.status === 'offline' ? 'offline' : data.status === 'unavailable' ? 'no_disponible' : 'error',
          percent: 0,
          path: null,
          error: data.error,
        })
        return
      }
      updatePreview(key, {
        ...base,
        state: 'descargando',
        transferState: 'starting',
        percent: 0,
        path: null,
        error: null,
      })
      previewTimers.current[key] = setInterval(async () => {
        try {
          const st = await request(`/api/preview/status?username=${encodeURIComponent(res.username)}&filename=${encodeURIComponent(res.filename)}`)
          const d = await st.json()
          const percent = d.percentComplete ?? 0
          const transferState = String(d.state || 'Unknown')
          const transferSpeed = Number(d.currentSpeed || d.averageSpeed || 0)
          const bytesRemaining = Number(d.bytesRemaining || 0)
          if (d.path) {
            stopPreviewTimer(key)
            updatePreview(key, { ...base, state: 'completado', transferState, percent, bytesRemaining, transferSpeed, path: d.path, error: null })
          } else if (String(d.state || '').toLowerCase().includes('offline') || String(d.error || '').toLowerCase().includes('offline') || d.state === 'error' || d.state === 'Errored' || d.state === 'Cancelled') {
            stopPreviewTimer(key)
            const isOffline = String(d.state || '').toLowerCase().includes('offline') || String(d.error || '').toLowerCase().includes('offline')
            updatePreview(key, { ...base, state: isOffline ? 'offline' : 'error', transferState, percent, bytesRemaining, transferSpeed, path: null, error: d.error || d.state })
          } else {
            updatePreview(key, { ...base, state: 'descargando', transferState, percent, bytesRemaining, transferSpeed, path: null, error: null })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      updatePreview(key, { ...base, state: 'error', path: null, error: err.message })
    }
  }, [previews, tracks, stopPreviewTimer, updatePreview])

  return {
    previews,
    startPreview,
    cancelPreview,
    savePreviewToLibrary,
    discardActivePreview,
    stopPreviewTimer,
  }
}
