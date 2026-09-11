import { useCallback, useState } from 'react'
import { toast } from 'react-toastify'
import { requestJson } from '../api/client'
import { usePolling } from './usePolling'

export function useSpotifyAuth() {
  const [spotifyAuth, setSpotifyAuth] = useState({ status: 'not_configured' })

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

  usePolling(fetchSpotifyAuth, 3000)

  return { spotifyAuth, startSpotifyAuth }
}
