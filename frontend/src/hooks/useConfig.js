import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { requestJson } from '../api/client'

const SECRET_FIELDS = ['spotify_client_secret', 'slskd_api_key', 'soulseek_password']

export function useConfig() {
  const [config, setConfig] = useState({})
  const [savingConfig, setSavingConfig] = useState(false)

  useEffect(() => {
    requestJson('/api/config')
      .then((data) => setConfig(data))
      .catch(() => {})
  }, [])

  const saveConfig = useCallback(async () => {
    setSavingConfig(true)
    try {
      const data = { ...config }
      for (const secret of SECRET_FIELDS) {
        if (!data[secret]) delete data[secret]
      }
      const saved = await requestJson('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setConfig(saved)
      toast.success('Configuración guardada')
    } catch (err) {
      toast.error('Error al guardar configuración: ' + err.message)
    } finally {
      setSavingConfig(false)
    }
  }, [config])

  return { config, setConfig, saveConfig, savingConfig }
}
