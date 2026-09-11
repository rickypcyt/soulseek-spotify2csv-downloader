import { useCallback, useState } from 'react'
import { requestJson } from '../api/client'
import { usePolling } from './usePolling'

export function useLogs() {
  const [logs, setLogs] = useState([])
  const [backendOnline, setBackendOnline] = useState(true)

  const fetchLogs = useCallback(async () => {
    try {
      setLogs(await requestJson('/api/logs'))
      setBackendOnline(true)
    } catch {
      setBackendOnline(false)
    }
  }, [])

  usePolling(fetchLogs, 5000)

  return { logs, backendOnline, fetchLogs }
}
