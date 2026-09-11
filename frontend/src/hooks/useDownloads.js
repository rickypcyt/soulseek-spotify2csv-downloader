import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { request } from '../api/client'
import { getSpotifyTrackId } from '../utils/spotify'

export function useDownloads({ tracks, outputFolderName, fetchDiagnostics, collapseTrackResults }) {
  const [downloads, setDownloads] = useState({})
  const downloadTimers = useRef({})
  const downloadToastIds = useRef({})
  const downloadTaskSequence = useRef(0)

  useEffect(() => {
    return () => {
      Object.values(downloadTimers.current).forEach(clearInterval)
    }
  }, [])

  const stopDownloadTimer = useCallback((taskId) => {
    if (downloadTimers.current[taskId]) {
      clearInterval(downloadTimers.current[taskId])
      delete downloadTimers.current[taskId]
    }
  }, [])

  const getTrackDownloads = useCallback((i) => {
    const value = downloads[i]
    if (Array.isArray(value)) return value
    return value ? [value] : []
  }, [downloads])

  const updateDownloadTask = useCallback((i, taskId, patch) =>
    setDownloads((prev) => {
      const current = Array.isArray(prev[i]) ? prev[i] : prev[i] ? [prev[i]] : []
      return {
        ...prev,
        [i]: current.map((task) => task.id === taskId ? { ...task, ...patch } : task),
      }
    })
  , [])

  const enqueueDownload = useCallback(async (i, res) => {
    if (!res) return
    const downloadFolderName = outputFolderName.trim()
    const taskId = `${i}-${downloadTaskSequence.current++}`
    const task = {
      id: taskId,
      username: res.username,
      filename: res.filename,
      size: res.size,
      folder_name: downloadFolderName,
      state: 'encolando',
      percent: 0,
      path: null,
      error: null,
    }
    setDownloads((prev) => {
      const current = Array.isArray(prev[i]) ? prev[i] : prev[i] ? [prev[i]] : []
      return { ...prev, [i]: [...current, task] }
    })
    const downloadToastId = toast.loading(`Descargando ${res.filename}`)
    downloadToastIds.current[taskId] = downloadToastId
    try {
      const r = await request('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: res.username,
          filename: res.filename,
          size: res.size,
          folder_name: downloadFolderName,
          track_key: getSpotifyTrackId(tracks[i]?.spotify_url),
          track_name: tracks[i]?.track_name,
          artists: tracks[i]?.artists,
        }),
      })
      const data = await r.json()
      if (data.error) {
        updateDownloadTask(i, taskId, { state: 'error', error: data.error })
        toast.update(downloadToastId, { render: `Error de descarga: ${data.error}`, type: 'error', isLoading: false, autoClose: 5000 })
        delete downloadToastIds.current[taskId]
        return
      }
      updateDownloadTask(i, taskId, { state: 'descargando' })
      downloadTimers.current[taskId] = setInterval(async () => {
        try {
          const st = await request(
            `/api/download/status?username=${encodeURIComponent(res.username)}&filename=${encodeURIComponent(res.filename)}&folder_name=${encodeURIComponent(downloadFolderName)}`
          )
          const d = await st.json()
          const downloadState = String(d.state || '').toLowerCase()
          const percentComplete = Number(d.percentComplete || 0)
          const isCancelled = downloadState.includes('cancelled') || downloadState.includes('canceled')
          const isComplete = !isCancelled && (Boolean(d.path) || percentComplete >= 100 || ['completed', 'complete', 'succeeded', 'finished'].some((state) => downloadState.includes(state)))
          if (isComplete) {
            stopDownloadTimer(taskId)
            updateDownloadTask(i, taskId, { state: 'completado', path: d.path || null, percent: 100 })
            collapseTrackResults(i)
            toast.update(downloadToastId, { render: `Descarga completada: ${res.filename}`, type: 'success', isLoading: false, autoClose: 3500 })
            delete downloadToastIds.current[taskId]
            fetchDiagnostics()
          } else if (isCancelled || downloadState === 'error' || downloadState === 'errored' || downloadState === 'cancelled') {
            stopDownloadTimer(taskId)
            const error = d.error || d.state
            updateDownloadTask(i, taskId, isCancelled ? { state: 'cancelado', error } : { state: 'error', error })
            toast.update(downloadToastId, {
              render: isCancelled ? `Descarga cancelada: ${res.filename}` : `Error de descarga: ${error}`,
              type: isCancelled ? 'info' : 'error',
              isLoading: false,
              autoClose: 4000,
            })
            delete downloadToastIds.current[taskId]
          } else {
            updateDownloadTask(i, taskId, { percent: d.percentComplete || 0 })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      updateDownloadTask(i, taskId, { state: 'error', error: err.message })
      toast.update(downloadToastId, { render: `Error de descarga: ${err.message}`, type: 'error', isLoading: false, autoClose: 5000 })
      delete downloadToastIds.current[taskId]
    }
  }, [tracks, outputFolderName, fetchDiagnostics, collapseTrackResults, updateDownloadTask, stopDownloadTimer])

  const cancelTrackDownload = useCallback(async (taskId) => {
    const task = Object.values(downloads).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).find((item) => item.id === taskId)
    stopDownloadTimer(taskId)
    if (!task) return
    const trackIndex = Number(taskId.split('-')[0])
    updateDownloadTask(trackIndex, taskId, { state: 'cancelado', error: 'Cancelado por el usuario' })
    const downloadToastId = downloadToastIds.current[taskId]
    if (downloadToastId) {
      toast.update(downloadToastId, { render: `Cancelando descarga: ${task.filename}`, type: 'info', isLoading: false, autoClose: 2500 })
      delete downloadToastIds.current[taskId]
    }
    try {
      const response = await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: task.username, filename: task.filename }),
      })
      if (!response.ok) throw new Error(`slskd ${response.status}`)
      toast.success(`Descarga cancelada: ${task.filename}`)
    } catch (err) {
      toast.error(`No se pudo cancelar la descarga: ${err.message}`)
    }
  }, [downloads, stopDownloadTimer, updateDownloadTask])

  const resetDownloads = useCallback(() => {
    Object.values(downloadTimers.current).forEach(clearInterval)
    downloadTimers.current = {}
    setDownloads({})
  }, [])

  return { downloads, enqueueDownload, cancelTrackDownload, getTrackDownloads, resetDownloads }
}
