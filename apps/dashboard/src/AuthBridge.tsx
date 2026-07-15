import { useEffect } from 'react'
import { useAuth } from '@clerk/react'
import { setTokenGetter } from './lib/api'

// Bridges Clerk's session token into the plain-fetch api client (lib/api.ts),
// which isn't a React component and can't call hooks directly. Must be
// mounted inside <ClerkProvider>.
export function AuthBridge() {
  const { getToken } = useAuth()
  useEffect(() => {
    setTokenGetter(() => getToken())
  }, [getToken])
  return null
}
