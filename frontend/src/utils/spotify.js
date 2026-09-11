export function getSpotifyTrackId(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/track\/([a-zA-Z0-9]+)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function matchesLibraryFile(track, file) {
  const title = normalizeSearchText(track.track_name)
  const path = normalizeSearchText(file.path)
  return Boolean(title && path.includes(title))
}

export function trackIdentity(track) {
  return getSpotifyTrackId(track.spotify_url)
    || `${normalizeSearchText(track.artists)}:${normalizeSearchText(track.track_name)}`
}
