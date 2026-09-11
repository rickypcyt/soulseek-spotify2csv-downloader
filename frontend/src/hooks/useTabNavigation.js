import { useEffect, useState } from 'react'
import { tabFromPath } from '../utils/tabs'

export function useTabNavigation() {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (path) => {
    window.history.pushState({}, '', path)
    setCurrentPath(path)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return { currentPath, navigate, activeTab: tabFromPath(currentPath) }
}
