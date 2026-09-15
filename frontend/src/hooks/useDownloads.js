import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { request } from '../api/client'
import { trackIdentity } from '../utils/spotify'

const DEFAULT_MAX_CONCURRENT = 4
const MAX_CONCURRENT_LIMIT = 8

export function useDownloads({ tracks, outputFolderName, playlistKey, maxConcurrent = DEFAULT_MAX_CONCURRENT, fetchDiagnostics, collapseTrackResults }) {
  const [downloads, setDownloads] = useState({})
  const downloadTimers = useRef({})
  const downloadToastIds = useRef({})
  const downloadTaskSequence = useRef(0)
  const pendingDownloads = useRef([])
  const activeDownloadIds = useRef(new Set())
  const downloadResolvers = useRef({})
  const pumpDownloadsRef = useRef(() => {})

  useEffect(() => {
    const timers = downloadTimers.current
    const resolvers = downloadResolvers.current
    const pending = pendingDownloads.current
    const active = activeDownloadIds.current
    return () => {
      Object.values(timers).forEach(clearInterval)
      Object.values(resolvers).forEach((resolve) => resolve())
      pending.length = 0
      active.clear()
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

  const finishDownload = useCallback((taskId) => {
    stopDownloadTimer(taskId)
    const resolve = downloadResolvers.current[taskId]
    if (resolve) {
      resolve()
      delete downloadResolvers.current[taskId]
    }
    activeDownloadIds.current.delete(taskId)
    pumpDownloadsRef.current()
  }, [stopDownloadTimer])

  const startDownload = useCallback(async (i, res, taskId, downloadFolderName) => {
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
          playlist_key: playlistKey,
          track_key: trackIdentity(tracks[i]),
          track_name: tracks[i]?.track_name,
          artists: tracks[i]?.artists,
          cover_url: tracks[i]?.cover_url,
        }),
      })
      const data = await r.json()
      if (!r.ok || data.error) {
        const error = data.error || `HTTP ${r.status}`
        const state = data.status === 'offline' ? 'offline' : data.status === 'unavailable' ? 'no_disponible' : 'error'
        const message = state === 'offline' ? `Usuario offline: ${res.username}` : state === 'no_disponible' ? `Usuario no disponible: ${res.username}` : `Error de descarga: ${error}`
        updateDownloadTask(i, taskId, { state, error })
        toast.update(downloadToastId, { render: message, type: state === 'error' ? 'error' : 'info', isLoading: false, autoClose: 5000 })
        delete downloadToastIds.current[taskId]
        finishDownload(taskId)
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
          const errorText = String(d.error || d.state || '')
          const isOffline = errorText.toLowerCase().includes('offline')
          const isComplete = !isCancelled && !isOffline && (Boolean(d.path) || percentComplete >= 100 || ['completed', 'complete', 'succeeded', 'finished'].some((state) => downloadState.includes(state)))
          if (isComplete) {
            updateDownloadTask(i, taskId, {
              state: 'completado',
              path: d.path || null,
              coverUrl: d.path ? `/api/library/cover?path=${encodeURIComponent(d.path)}` : null,
              percent: 100,
            })
            collapseTrackResults(i)
            toast.update(downloadToastId, { render: `Descarga completada: ${res.filename}`, type: 'success', isLoading: false, autoClose: 3500 })
            delete downloadToastIds.current[taskId]
            fetchDiagnostics()
            finishDownload(taskId)
          } else if (isCancelled || isOffline || downloadState === 'error' || downloadState === 'errored' || downloadState === 'cancelled') {
            const error = d.error || d.state
            const state = isCancelled ? 'cancelado' : isOffline ? 'offline' : 'error'
            updateDownloadTask(i, taskId, { state, error })
            toast.update(downloadToastId, {
              render: isCancelled ? `Descarga cancelada: ${res.filename}` : isOffline ? `Usuario offline: ${res.username}` : `Error de descarga: ${error}`,
              type: isCancelled || isOffline ? 'info' : 'error',
              isLoading: false,
              autoClose: 4000,
            })
            delete downloadToastIds.current[taskId]
            finishDownload(taskId)
          } else {
            updateDownloadTask(i, taskId, { percent: d.percentComplete || 0 })
          }
        } catch {}
      }, 2000)
    } catch (err) {
      updateDownloadTask(i, taskId, { state: 'error', error: err.message })
      toast.update(downloadToastId, { render: `Error de descarga: ${err.message}`, type: 'error', isLoading: false, autoClose: 5000 })
      delete downloadToastIds.current[taskId]
      finishDownload(taskId)
    }
  }, [tracks, playlistKey, fetchDiagnostics, collapseTrackResults, updateDownloadTask, finishDownload])

  const pumpDownloads = useCallback(() => {
    const limit = Math.max(1, Math.min(MAX_CONCURRENT_LIMIT, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT))
    while (activeDownloadIds.current.size < limit && pendingDownloads.current.length > 0) {
      const next = pendingDownloads.current.shift()
      if (!next) break
      activeDownloadIds.current.add(next.taskId)
      startDownload(next.index, next.result, next.taskId, next.folderName)
    }
  }, [maxConcurrent, startDownload])

  useEffect(() => {
    pumpDownloadsRef.current = pumpDownloads
    pumpDownloads()
  }, [pumpDownloads])

  const enqueueDownload = useCallback((i, res) => {
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
    pendingDownloads.current.push({ index: i, result: res, taskId, folderName: downloadFolderName })
    pumpDownloadsRef.current()
  }, [outputFolderName])

  const cancelTrackDownload = useCallback(async (taskId) => {
    const task = Object.values(downloads).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).find((item) => item.id === taskId)
    if (!task) return
    const queuedIndex = pendingDownloads.current.findIndex((item) => item.taskId === taskId)
    if (queuedIndex >= 0) {
      pendingDownloads.current.splice(queuedIndex, 1)
      stopDownloadTimer(taskId)
    }
    const trackIndex = Number(taskId.split('-')[0])
    updateDownloadTask(trackIndex, taskId, { state: 'cancelado', error: 'Cancelado por el usuario' })
    const downloadToastId = downloadToastIds.current[taskId]
    if (downloadToastId) {
      toast.update(downloadToastId, { render: `Cancelando descarga: ${task.filename}`, type: 'info', isLoading: false, autoClose: 2500 })
      delete downloadToastIds.current[taskId]
    }
    if (!activeDownloadIds.current.has(taskId)) {
      pumpDownloadsRef.current()
      return
    }
    try {
      const response = await request('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: task.username, filename: task.filename }),
      })
      if (!response.ok) throw new Error(`slskd ${response.status}`)
      finishDownload(taskId)
      toast.success(`Descarga cancelada: ${task.filename}`)
    } catch (err) {
      toast.error(`No se pudo cancelar la descarga: ${err.message}`)
    }
  }, [downloads, stopDownloadTimer, updateDownloadTask, finishDownload])

  const resetDownloads = useCallback(() => {
    Object.values(downloadTimers.current).forEach(clearInterval)
    downloadTimers.current = {}
    pendingDownloads.current = []
    activeDownloadIds.current.clear()
    setDownloads({})
  }, [])

  return { downloads, enqueueDownload, cancelTrackDownload, getTrackDownloads, resetDownloads }
}
