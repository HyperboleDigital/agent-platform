import { Outlet } from 'react-router-dom'
import { useAuth, RedirectToSignIn } from '@clerk/react'

export function ProtectedLayout() {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) return null // avoid a flash-redirect before Clerk resolves the session
  if (!isSignedIn) return <RedirectToSignIn />

  return <Outlet />
}
