import { useCallback, useEffect, useRef, useState } from 'react'
import { requestJson } from '../api/client'
import { isCompletedTransfer } from '../constants'

// Poll rápido cuando hay transfers activos; lento en reposo.
const FAST_INTERVAL_MS = 3000
const SLOW_INTERVAL_MS = 30000

export function useDiagnostics() {
  const [diagnostics, setDiagnostics] = useState(null)
  const diagnosticsRef = useRef(diagnostics)

  useEffect(() => {
    diagnosticsRef.current = diagnostics
  }, [diagnostics])

  const fetchDiagnostics = useCallback(async () => {
    try {
      setDiagnostics(await requestJson('/api/diagnostics'))
    } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer = null

    const tick = async () => {
      await fetchDiagnostics()
      if (cancelled) return
      const transfers = diagnosticsRef.current?.transfers || []
      const hasActive = transfers.some((transfer) => !isCompletedTransfer(transfer))
      const nextDelay = hasActive ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
      timer = setTimeout(tick, nextDelay)
    }

    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [fetchDiagnostics])

  return { diagnostics, fetchDiagnostics }
}
