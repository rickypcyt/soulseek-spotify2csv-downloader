const LOSSLESS = ['flac', 'wav', 'alac', 'aiff', 'ape']

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function extOf(result) {
  const extension = (result.extension || '').toLowerCase().replace(/^\./, '')
  if (extension) return extension
  const match = (result.filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : ''
}

export function rankResults(results, query = '') {
  if (!Array.isArray(results)) return []

  const queryTokens = normalizeText(query).split(' ').filter((token) => token.length > 1)
  const unique = new Map()

  results.forEach((result) => {
    const filename = result.filename || result.file || result.name || result.path || ''
    const key = `${normalizeText(filename)}|${Number(result.size) || 0}`
    const previous = unique.get(key)
    if (!previous || (Number(result.speed) || 0) > (Number(previous.speed) || 0)) {
      unique.set(key, result)
    }
  })

  return [...unique.values()]
    .map((result) => {
      const name = normalizeText(result.filename || result.file || result.name || result.path)
      const matchedTokens = queryTokens.filter((token) => name.includes(token)).length
      const exactPhrase = normalizeText(query) && name.includes(normalizeText(query)) ? 1 : 0
      return { result, score: exactPhrase * 100 + matchedTokens * 10 }
    })
    .sort((a, b) => b.score - a.score || (Number(b.result.speed) || 0) - (Number(a.result.speed) || 0))
    .map(({ result }) => result)
}

export function pickBest(results, mode = 'quality', formatPref = 'any') {
  if (!Array.isArray(results) || results.length === 0) return null

  let pool = results
  if (formatPref && formatPref !== 'any') {
    const filtered = results.filter((result) => extOf(result) === formatPref)
    if (filtered.length > 0) pool = filtered
  }

  const bitrate = (result) => Number(result.bitrate) || 0
  const speed = (result) => Number(result.speed) || 0
  const length = (result) => Number(result.length) || 0
  const size = (result) => Number(result.size) || 0
  const maxSpeed = Math.max(...pool.map(speed), 1)
  const maxBitrate = Math.max(...pool.map(bitrate), 1)
  const comparators = {
    quality: (a, b) =>
      Number(LOSSLESS.includes(extOf(b))) - Number(LOSSLESS.includes(extOf(a))) ||
      bitrate(b) - bitrate(a) ||
      size(b) - size(a),
    speed: (a, b) => speed(b) - speed(a) || bitrate(b) - bitrate(a),
    longest: (a, b) => length(b) - length(a) || bitrate(b) - bitrate(a),
    balanced: (a, b) =>
      bitrate(b) / maxBitrate + speed(b) / maxSpeed -
      (bitrate(a) / maxBitrate + speed(a) / maxSpeed),
  }

  return [...pool].sort(comparators[mode] || comparators.quality)[0]
}
