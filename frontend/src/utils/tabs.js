export const TAB_PATHS = {
  main: '/',
  settings: '/settings',
  logs: '/logs',
  library: '/library',
}

export function tabFromPath(pathname) {
  const match = Object.entries(TAB_PATHS).find(([, path]) => path === pathname)
  return match ? match[0] : 'main'
}
