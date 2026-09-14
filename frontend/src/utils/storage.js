import { requestJson, request } from '../api/client'
import { getSpotifyTrackId } from './spotify'

const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const PICK_MODES = ['quality', 'speed', 'longest', 'balanced']
const FORMAT_PREFS = ['any', 'flac', 'mp3', 'ogg', 'm4a']

// ---- history ---------------------------------------------------------------
export function getHistoryLabel(url, index) {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const id = parts.at(-1)
    return id ? `Playlist ${index + 1} · ${id}` : `Playlist guardada ${index + 1}`
  } catch {
    return `Playlist guardada ${index + 1}`
  }
}

export function normalizeHistory(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const item = typeof entry === 'string' ? { url: entry } : entry
      if (!item?.url) return null
      return {
        url: item.url,
        name: item.name || item.title || getHistoryLabel(item.url, index),
      }
    })
    .filter(Boolean)
}

export async function loadHistory() {
  try {
    return normalizeHistory(await requestJson('/api/storage/history'))
  } catch {
    return []
  }
}

export async function saveHistory(history) {
  try {
    await request('/api/storage/history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: normalizeHistory(history).slice(0, 20) }),
    })
  } catch {}
}

export async function clearHistory() {
  try {
    await request('/api/storage/history', { method: 'DELETE' })
  } catch {}
}

// ---- search preferences ----------------------------------------------------
export async function loadSearchPreferences() {
  try {
    const saved = await requestJson('/api/storage/search-preferences')
    return {
      pickMode: PICK_MODES.includes(saved?.pickMode) ? saved.pickMode : 'quality',
      formatPref: FORMAT_PREFS.includes(saved?.formatPref) ? saved.formatPref : 'any',
    }
  } catch {
    return { pickMode: 'quality', formatPref: 'any' }
  }
}

export async function saveSearchPreferences(pickMode, formatPref) {
  try {
    await request('/api/storage/search-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickMode, formatPref }),
    })
  } catch {}
}

// ---- last playlist ---------------------------------------------------------
export async function loadLastPlaylist() {
  try {
    return await requestJson('/api/storage/playlist')
  } catch {
    return {}
  }
}

export async function saveLastPlaylist(playlist) {
  try {
    await request('/api/storage/playlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playlist),
    })
  } catch {}
}

// ---- output folder preferences ---------------------------------------------
export async function getOutputFolderPreference(url) {
  if (!url) return undefined
  try {
    const data = await requestJson(`/api/storage/output-folder?playlist_url=${encodeURIComponent(url)}`)
    return data.folderName ?? undefined
  } catch {
    return undefined
  }
}

export async function setOutputFolderPreference(url, folderName) {
  if (!url) return
  try {
    await request('/api/storage/output-folder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist_url: url, folder_name: folderName || '' }),
    })
  } catch {}
}

// ---- search cache ----------------------------------------------------------
export async function loadSearchCache(url, tracks) {
  if (!url) return []
  try {
    const data = await requestJson(`/api/storage/search-cache?playlist_url=${encodeURIComponent(url)}`)
    const searches = data.searches || []
    return searches
      .map((search) => {
        const trackIndex = tracks.findIndex((track) =>
          (search.trackKey && getSpotifyTrackId(track.spotify_url) === search.trackKey) ||
          track.search_query === search.query
        )
        return trackIndex < 0
          ? null
          : {
              ...search,
              trackIndex,
              searchId: null,
              status: 'completed',
              cached: true,
            }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function saveSearchCache(url, searches) {
  if (!url) return
  try {
    const cacheable = searches
      .filter((search) => search.raw)
      .map((search) => ({
        ...search,
        raw: {
          ...search.raw,
          results: Array.isArray(search.raw.results) ? search.raw.results.slice(0, 100) : [],
        },
      }))
    await request('/api/storage/search-cache', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist_url: url, searches: cacheable }),
    })
  } catch {}
}
