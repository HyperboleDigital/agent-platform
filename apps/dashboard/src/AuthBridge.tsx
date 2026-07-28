import { useEffect } from 'react'
import { useAuth, useClerk } from '@clerk/react'
import { setTokenGetter, setSessionExpiredHandler } from './lib/api'

// Bridges Clerk's session token into the plain-fetch api client (lib/api.ts),
// which isn't a React component and can't call hooks directly. Must be
// mounted inside <ClerkProvider>.
export function AuthBridge() {
  const { getToken } = useAuth()
  const { signOut } = useClerk()
  useEffect(() => {
    setTokenGetter(opts => getToken(opts))
    // A 401 that survives a forced-fresh token means the session is actually
    // gone (expired/revoked), not just a stale local cache — sign out so
    // <ProtectedLayout/> picks it up and redirects to sign-in, rather than
    // leaving the app stuck on a generic "can't reach the API" error.
    setSessionExpiredHandler(() => signOut())
  }, [getToken, signOut])
  return null
}
