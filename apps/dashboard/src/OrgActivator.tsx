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
//
// Mounted globally in main.tsx (inside <ClerkProvider>, above
// <ProtectedLayout>), so this component is on screen during the sign-in flow
// itself, not just after. useOrganizationList subscribes to and polls
// Clerk's client-side session state — calling it at all while Clerk's own
// <SignIn> still has an in-progress attempt (email entered, waiting on a
// code) risks interfering with that attempt's internal state. So the actual
// subscription lives in a child component that isn't even mounted, and
// therefore never calls useOrganizationList, until sign-in is complete —
// gating an effect's BODY on isSignedIn isn't enough, since the hook itself
// still runs on every render regardless of what's inside the effect.
export function OrgActivator() {
  const { isSignedIn } = useAuth()
  if (!isSignedIn) return null
  return <ActivateOrg />
}

function ActivateOrg() {
  const { isLoaded: authLoaded, orgId } = useAuth()
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: true
  })

  useEffect(() => {
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
  }, [authLoaded, listLoaded, setActive, orgId, userMemberships?.data])

  return null
}
