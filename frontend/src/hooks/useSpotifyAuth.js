import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { requestJson } from '../api/client'

// Poll rápido solo mientras autentica; casi nulo en estados estables.
const FAST_INTERVAL_MS = 3000
const SLOW_INTERVAL_MS = 60000

export function useSpotifyAuth() {
  const [spotifyAuth, setSpotifyAuth] = useState({ status: 'not_configured' })
  const spotifyAuthRef = useRef(spotifyAuth)

  useEffect(() => {
    spotifyAuthRef.current = spotifyAuth
  }, [spotifyAuth])

  const fetchSpotifyAuth = useCallback(async () => {
    try {
      setSpotifyAuth(await requestJson('/api/spotify/auth/status'))
    } catch {}
  }, [])

  const startSpotifyAuth = useCallback(async () => {
    try {
      setSpotifyAuth(await requestJson('/api/spotify/auth/start', { method: 'POST' }))
      toast.info('Se abrió Spotify en el navegador. Completa la autorización y vuelve aquí.')
    } catch (err) {
      toast.error('No se pudo iniciar Spotify: ' + err.message)
    }
  }, [])

  // Intervalo dinámico: rápido mientras autentica, lento en estados estables.
  useEffect(() => {
    let cancelled = false
    let timer = null

    const tick = async () => {
      await fetchSpotifyAuth()
      if (cancelled) return
      const status = spotifyAuthRef.current.status
      const nextDelay = status === 'authenticating' ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
      timer = setTimeout(tick, nextDelay)
    }

    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchSpotifyAuth])

  return { spotifyAuth, startSpotifyAuth }
}
