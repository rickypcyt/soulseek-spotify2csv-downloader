import { getSpotifyTrackId } from './spotify'

const HISTORY_KEY = 'spotifyUrlHistory'
const OUTPUT_FOLDER_PREFERENCES_KEY = 'soulseekOutputFolderPreferences'
const SEARCH_PREFERENCES_KEY = 'soulseekSearchPreferences'
const LAST_PLAYLIST_KEY = 'lastPlaylist'

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

export function loadHistory() {
  try {
    return normalizeHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'))
  } catch {
    return []
  }
}

export function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(normalizeHistory(history).slice(0, 20)))
}

// ---- search preferences ----------------------------------------------------
export function loadSearchPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(SEARCH_PREFERENCES_KEY) || 'null')
    return {
      pickMode: PICK_MODES.includes(saved?.pickMode) ? saved.pickMode : 'quality',
      formatPref: FORMAT_PREFS.includes(saved?.formatPref) ? saved.formatPref : 'any',
    }
  } catch {
    return { pickMode: 'quality', formatPref: 'any' }
  }
}

export function saveSearchPreferences(pickMode, formatPref) {
  try {
    localStorage.setItem(SEARCH_PREFERENCES_KEY, JSON.stringify({ pickMode, formatPref }))
  } catch {}
}

// ---- last playlist ---------------------------------------------------------
export function loadLastPlaylist() {
  try {
    return JSON.parse(localStorage.getItem(LAST_PLAYLIST_KEY) || 'null') || {}
  } catch {
    return {}
  }
}

export function saveLastPlaylist(playlist) {
  localStorage.setItem(LAST_PLAYLIST_KEY, JSON.stringify(playlist))
}

// ---- output folder preferences ---------------------------------------------
export function loadOutputFolderPreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem(OUTPUT_FOLDER_PREFERENCES_KEY) || '{}')
    return preferences && typeof preferences === 'object' ? preferences : {}
  } catch {
    return {}
  }
}

export function getOutputFolderPreference(url) {
  if (!url) return undefined
  const preferences = loadOutputFolderPreferences()
  return Object.prototype.hasOwnProperty.call(preferences, url) ? preferences[url] : undefined
}

export function setOutputFolderPreference(url, folderName) {
  if (!url) return
  const preferences = loadOutputFolderPreferences()
  preferences[url] = folderName
  localStorage.setItem(OUTPUT_FOLDER_PREFERENCES_KEY, JSON.stringify(preferences))
}

// ---- search cache ----------------------------------------------------------
function searchCacheKey(url) {
  return `soulseekSearchCache:${encodeURIComponent(url || '')}`
}

export function loadSearchCache(url, tracks) {
  if (!url) return []
  try {
    const cached = JSON.parse(localStorage.getItem(searchCacheKey(url)) || 'null')
    if (!cached || Date.now() - cached.savedAt > SEARCH_CACHE_TTL_MS) return []
    return (cached.searches || [])
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

export function saveSearchCache(url, searches) {
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
    localStorage.setItem(searchCacheKey(url), JSON.stringify({ savedAt: Date.now(), searches: cacheable }))
  } catch {}
}
