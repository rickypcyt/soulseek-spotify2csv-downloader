import { useEffect, useRef } from 'react'

/**
 * Runs `fetcher` immediately and then every `intervalMs` milliseconds.
 * The fetcher is kept in a ref so the interval always calls the latest closure
 * without re-subscribing.
 */
export function usePolling(fetcher, intervalMs) {
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    const initialFetch = setTimeout(() => fetcherRef.current(), 0)
    const iv = setInterval(() => fetcherRef.current(), intervalMs)
    return () => {
      clearTimeout(initialFetch)
      clearInterval(iv)
    }
  }, [intervalMs])
}
