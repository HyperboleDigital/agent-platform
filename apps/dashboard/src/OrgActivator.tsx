import { useEffect } from 'react'
import { useAuth, useOrganizationList } from '@clerk/react'
import { mutate } from 'swr'
import { api } from '@/lib/api'

// We run Clerk in "membership optional" mode so our superadmin team can use
// personal accounts (superadmin is a userId allowlist, not org membership).
// The downside: an invited client user lands with NO active organization, so
// the backend sees orgId=null and can't match them to their client — they'd
// see "no account" despite being a member.
//
// This bridges that: if the signed-in user belongs to an org but none is
// active, activate their (single) org so their session carries org_id and the
// backend scopes them correctly. Superadmins are unaffected — their access is
// by allowlist, independent of which org (if any) is active.
export function OrgActivator() {
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth()
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: true
  })

  useEffect(() => {
    // Mounted globally (main.tsx, inside <ClerkProvider> but above
    // <ProtectedLayout>), so without this it was running on the sign-in page
    // itself — calling setActive()/reconcile()/a global SWR revalidate while
    // Clerk's own <SignIn> was mid-flow, which could reset that component's
    // internal step state and restart it (re-sending a verification code,
    // re-prompting for a password). This ONLY ever needs to run post-auth.
    if (!isSignedIn) return
    if (!authLoaded || !listLoaded || !setActive) return
    if (orgId) return // already scoped to an org

    const first = userMemberships?.data?.[0]?.organization
    if (first) {
      void (async () => {
        await setActive({ organization: first.id })
        // Session token now carries org_id — refetch so cached "no account"
        // responses from the pre-activation session are replaced.
        await mutate(() => true, undefined, { revalidate: true })
      })()
      return
    }

    // No memberships at all. They may be an invited client whose org-invite
    // acceptance didn't create the membership (a Clerk SPA quirk). Ask the
    // backend to reconcile via any pending invitation for their email; if it
    // joins them, reload so Clerk picks up the new membership. Guard with a
    // per-session flag so a genuinely account-less user doesn't loop.
    if (sessionStorage.getItem('reconcile-attempted')) return
    sessionStorage.setItem('reconcile-attempted', '1')
    void (async () => {
      try {
        const { orgId: joined } = await api.reconcile()
        if (joined) window.location.reload()
      } catch { /* leave them on the "no account" screen */ }
    })()
  }, [isSignedIn, authLoaded, listLoaded, setActive, orgId, userMemberships?.data])

  return null
}
