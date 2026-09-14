import { useCallback, useEffect, useRef, useState } from 'react'
import { requestJson } from '../api/client'

// Poll rápido cuando los logs cambian; lento cuando están estables.
const FAST_INTERVAL_MS = 3000
const SLOW_INTERVAL_MS = 30000

export function useLogs() {
  const [logs, setLogs] = useState([])
  const [backendOnline, setBackendOnline] = useState(true)
  const lastLogsRef = useRef([])

  const fetchLogs = useCallback(async () => {
    try {
      const next = await requestJson('/api/logs')
      // Solo actualizamos estado si el contenido cambió, evitando re-renders inútiles.
      const prev = lastLogsRef.current
      if (next.length !== prev.length || next.some((line, i) => line !== prev[i])) {
        lastLogsRef.current = next
        setLogs(next)
      }
      setBackendOnline(true)
    } catch {
      setBackendOnline(false)
    }
  }, [])

  // Auto-reschedule: rápido tras cambios, lento en reposo.
  useEffect(() => {
    let cancelled = false
    let timer = null
    let changedLastTick = true

    const tick = async () => {
      const before = lastLogsRef.current
      await fetchLogs()
      if (cancelled) return
      const after = lastLogsRef.current
      changedLastTick = after.length !== before.length || after.some((line, i) => line !== before[i])
      const nextDelay = changedLastTick ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
      timer = setTimeout(tick, nextDelay)
    }

    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchLogs])

  return { logs, backendOnline, fetchLogs }
}
