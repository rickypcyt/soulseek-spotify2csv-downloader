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
      const data = await requestJson('/api/spotify/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Reautorizar fuerza el flujo completo (pantalla de Spotify incluida);
        // conectar reusa el token cacheado si todavía es válido.
        body: JSON.stringify({ force: spotifyAuthRef.current.status === 'authenticated' }),
      })
      setSpotifyAuth(data)
      // El backend abre el navegador una vez que el servidor de callback ya
      // escucha; abrir aquí también duplicaría pestañas.
      toast.info('Autorizando… si el navegador no se abre solo, usá el link mostrado.')
    } catch (err) {
      toast.error('No se pudo iniciar Spotify: ' + err.message)
    }
  }, [])

  // Intervalo dinámico: rápido mientras autentica, lento en estados estables.
  // El efecto depende del estado actual: si startSpotifyAuth pasa a
  // 'authenticating' mientras había un timer lento pendiente, el efecto se
  // reinicia y empieza a pollear rápido de inmediato.
  const authenticating = spotifyAuth.status === 'authenticating'
  useEffect(() => {
    let cancelled = false
    let timer = null
    const delay = authenticating ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS

    const tick = async () => {
      await fetchSpotifyAuth()
      if (!cancelled) timer = setTimeout(tick, delay)
    }

    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [authenticating, fetchSpotifyAuth])

  return { spotifyAuth, startSpotifyAuth }
}
