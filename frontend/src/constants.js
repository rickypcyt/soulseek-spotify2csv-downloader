// ---- design tokens -------------------------------------------------------
export const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"
export const FONT_BODY = "'IBM Plex Sans', 'Segoe UI', sans-serif"

// ---- UI tuning -----------------------------------------------------------
export const RESULTS_PER_TRACK = 5
export const PREVIEW_PAGE_SIZE = 12

// ---- drag & drop ---------------------------------------------------------
export const FILE_DRAG_TYPE = 'application/x-soulseek-file'

export function isLibraryFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes(FILE_DRAG_TYPE)
}

// ---- formatting -----------------------------------------------------------
export function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '--:--'
  const total = Math.floor(Number(ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatResultDuration(result) {
  const raw = result.duration_ms ?? result.length ?? result.duration ?? result.durationSeconds
  if (raw == null || raw === '') return null
  if (typeof raw === 'string' && raw.includes(':')) {
    const parts = raw.split(':').map(Number)
    if (parts.every(Number.isFinite)) return parts.join(':')
  }
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return formatDuration(result.duration_ms != null ? numeric : numeric * 1000)
}

export function formatSize(bytes) {
  if (bytes == null || bytes === 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = Number(bytes)
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(2)} ${units[i]}`
}

export function formatSpeed(bps) {
  if (!bps) return ''
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let n = Number(bps)
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(1)} ${units[i]}`
}

// ---- library helpers ------------------------------------------------------
export function isLibraryFile(file) {
  const firstFolder = file.path.split('/').filter(Boolean)[0]?.toLowerCase()
  return firstFolder !== 'temp' && firstFolder !== '.incomplete'
}

export function isPlayableFile(file) {
  return /\.(flac|mp3|m4a|aac|ogg|opus|wav|webm)$/i.test(file.name || file.path)
}

export function buildFolderTree(files, folderPaths = []) {
  const root = { folders: {}, files: [] }
  folderPaths.filter(Boolean).forEach((path) => {
    let folder = root
    path.split('/').filter(Boolean).forEach((part) => {
      folder.folders[part] ||= { folders: {}, files: [] }
      folder = folder.folders[part]
    })
  })
  files
    .filter(isLibraryFile)
    .forEach((file) => {
      const parts = file.path.split('/').filter(Boolean)
      if (parts.length === 0) return
      const name = parts.pop()
      let folder = root
      parts.forEach((part) => {
        folder.folders[part] ||= { folders: {}, files: [] }
        folder = folder.folders[part]
      })
      folder.files.push({ ...file, name })
    })
  return root
}

export function getFolderStats(node) {
  return Object.values(node.folders).reduce(
    (total, folder) => {
      const nested = getFolderStats(folder)
      return { files: total.files + nested.files, size: total.size + nested.size }
    },
    {
      files: node.files.filter(isPlayableFile).length,
      size: node.files.reduce((total, file) => total + (Number(file.size) || 0), 0),
    },
  )
}

// ---- transfer status ------------------------------------------------------
export function isCompletedTransfer(transfer) {
  const state = String(transfer.state || '').toLowerCase()
  const terminalStates = ['completed', 'complete', 'succeeded', 'finished', 'cancelled', 'canceled', 'failed', 'error']
  return Number(transfer.percentComplete) >= 100 || terminalStates.some((terminalState) => state.includes(terminalState))
}
