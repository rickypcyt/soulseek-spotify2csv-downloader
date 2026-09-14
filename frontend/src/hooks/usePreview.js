import { useCallback, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { request, requestJson } from '../api/client'
import { getSpotifyTrackId } from '../utils/spotify'

export function usePreview({ tracks, outputFolderName, fetchDiagnostics }) {
  const [activePreview, setActivePreview] = useState(null)
  const previewTimer = useRef(null)

  const stopPreviewTimer = useCallback(() => {
    if (previewTimer.current) {
      clearInterval(previewTimer.current)
      previewTimer.current = null
    }
  }, [])

  const cancelPreview = useCallback(async (res) => {
    stopPreviewTimer()
    setActivePreview(null)
    try {
      await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: res.username, filename: res.filename }),
      })
    } catch {}
  }, [stopPreviewTimer])

  const savePreviewToLibrary = useCallback(async () => {
    if (!activePreview?.path || activePreview.savedPath) return
    if (!outputFolderName.trim()) {
      toast.info('Escribe una carpeta de playlist para guardar el preview')
      return
    }
    try {
      const data = await requestJson('/api/preview/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: activePreview.path,
          folder_name: outputFolderName,
          track_key: activePreview.trackKey,
          track_name: activePreview.trackName,
          artists: activePreview.artists,
          cover_url: activePreview.coverUrl,
        }),
      })
      setActivePreview((current) => ({ ...current, savedPath: data.path }))
      fetchDiagnostics()
      toast.success('Preview guardado en la biblioteca')
    } catch (err) {
      toast.error('No se pudo guardar el preview: ' + err.message)
    }
  }, [activePreview, outputFolderName, fetchDiagnostics])

  const discardActivePreview = useCallback(async () => {
    if (!activePreview?.path || activePreview.savedPath) return
    try {
      await requestJson('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activePreview.path, dir: 'previews' }),
      })
      await fetchDiagnostics()
      setActivePreview(null)
      toast.success('Preview descartado y eliminado')
    } catch (err) {
      toast.error('No se pudo descartar el preview: ' + err.message)
    }
  }, [activePreview, fetchDiagnostics])

  const startPreview = useCallback(async (res, trackIndex) => {
    if (activePreview && !activePreview.error && activePreview.state !== 'completado') {
      return
    }
    stopPreviewTimer()
    setActivePreview({
      username: res.username,
      filename: res.filename,
      trackKey: getSpotifyTrackId(tracks[trackIndex]?.spotify_url),
      trackName: tracks[trackIndex]?.track_name,
      artists: tracks[trackIndex]?.artists,
      coverUrl: tracks[trackIndex]?.cover_url,
      size: res.size,
      state: 'encolando',
      percent: 0,
      path: null,
      error: null,
    })
    try {
      const r = await request('/api/preview_audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: res.username,
          filename: res.filename,
          size: res.size,
        }),
      })
      const data = await r.json()
      if (data.error) {
        setActivePreview({
          username: res.username,
          filename: res.filename,
          trackKey: getSpotifyTrackId(tracks[trackIndex]?.spotify_url),
          trackName: tracks[trackIndex]?.track_name,
          artists: tracks[trackIndex]?.artists,
          size: res.size,
          state: 'error',
          percent: 0,
          path: null,
          error: data.error,
        })
        return
      }
      setActivePreview({
        username: res.username,
        filename: res.filename,
        size: res.size,
        state: 'descargando',
        percent: 0,
        path: null,
        error: null,
      })
      previewTimer.current = setInterval(async () => {
        try {
          const st = await request(
            `/api/preview/status?username=${encodeURIComponent(res.username)}&filename=${encodeURIComponent(res.filename)}`
          )
          const d = await st.json()
          const percent = d.percentComplete ?? 0
          if (d.path) {
            stopPreviewTimer()
            setActivePreview({
              username: res.username,
              filename: res.filename,
              trackKey: getSpotifyTrackId(tracks[trackIndex]?.spotify_url),
              trackName: tracks[trackIndex]?.track_name,
              artists: tracks[trackIndex]?.artists,
              size: res.size,
              state: 'completado',
              percent,
              path: d.path,
              error: null,
            })
          } else if (d.state === 'error' || d.state === 'Errored' || d.state === 'Cancelled') {
            stopPreviewTimer()
            setActivePreview({
              username: res.username,
              filename: res.filename,
              size: res.size,
              state: 'error',
              percent,
              path: null,
              error: d.error || d.state,
            })
          } else {
            setActivePreview({
              username: res.username,
              filename: res.filename,
              size: res.size,
              state: 'descargando',
              percent,
              path: null,
              error: null,
            })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      setActivePreview({
        username: res.username,
        filename: res.filename,
        size: res.size,
        state: 'error',
        path: null,
        error: err.message,
      })
    }
  }, [activePreview, tracks, stopPreviewTimer])

  return {
    activePreview,
    startPreview,
    cancelPreview,
    savePreviewToLibrary,
    discardActivePreview,
    stopPreviewTimer,
  }
}
