import { useEffect, useRef } from 'react'
import { useAuth, useClerk } from '@clerk/react'
import { setTokenGetter, setSessionExpiredHandler } from './lib/api'

// Bridges Clerk's session token into the plain-fetch api client (lib/api.ts),
// which isn't a React component and can't call hooks directly. Must be
// mounted inside <ClerkProvider>.
export function AuthBridge() {
  const { getToken, isSignedIn } = useAuth()
  const { signOut } = useClerk()

  // Read at call time, not captured when the handler is registered — the
  // handler is registered once but fires much later, and whether there's a
  // session to expire can have changed by then.
  const isSignedInRef = useRef(isSignedIn)
  isSignedInRef.current = isSignedIn

  useEffect(() => {
    setTokenGetter(opts => getToken(opts))
    // A 401 that survives a forced-fresh token means the session is actually
    // gone (expired/revoked), not just a stale local cache — sign out so
    // <ProtectedLayout/> picks it up and redirects to sign-in, rather than
    // leaving the app stuck on a generic "can't reach the API" error.
    //
    // Guarded on actually being signed in: a 401 while signed OUT is the
    // expected answer, not an expired session. Calling signOut() there is
    // worse than useless — during an in-progress sign-in it tears down the
    // attempt Clerk is holding (email submitted, awaiting the code), which
    // restarts the flow and sends a second verification email.
    setSessionExpiredHandler(async () => {
      if (!isSignedInRef.current) return
      await signOut()
    })
  }, [getToken, signOut])
  return null
}
