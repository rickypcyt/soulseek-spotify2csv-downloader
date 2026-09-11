import { useCallback, useState } from 'react'
import { requestJson } from '../api/client'
import { usePolling } from './usePolling'

export function useDiagnostics() {
  const [diagnostics, setDiagnostics] = useState(null)

  const fetchDiagnostics = useCallback(async () => {
    try {
      setDiagnostics(await requestJson('/api/diagnostics'))
    } catch {}
  }, [])

  usePolling(fetchDiagnostics, 10000)

  return { diagnostics, fetchDiagnostics }
}
