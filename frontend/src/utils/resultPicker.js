const LOSSLESS = ['flac', 'wav', 'alac', 'aiff', 'ape']

export function extOf(result) {
  const extension = (result.extension || '').toLowerCase().replace(/^\./, '')
  if (extension) return extension
  const match = (result.filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : ''
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
