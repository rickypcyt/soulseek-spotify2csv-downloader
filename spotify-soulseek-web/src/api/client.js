export async function requestJson(path, options = {}) {
  const response = await fetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Request failed with status ${response.status}`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

export function request(path, options = {}) {
  return fetch(path, options)
}
