import { clerkClient } from '@clerk/express'
import { getClientById } from './clients'

// Resolves real Clerk user info (name/email) for display and @mention
// notifications. The app itself only tracks a Clerk userId + isSuperadmin
// boolean — this is the one place we go to Clerk for the human-readable bits.

const SUPERADMIN_USER_IDS = (process.env.SUPERADMIN_USER_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

export interface MentionableUser {
  id: string
  name: string
  isSuperadmin: boolean
}

function displayName(u: { firstName?: string | null; lastName?: string | null; emailAddresses?: { emailAddress: string }[] }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  if (full) return full
  return u.emailAddresses?.[0]?.emailAddress ?? 'Unknown user'
}

// Short-lived in-process cache — comment lists can repeat the same handful of
// authors many times; Clerk lookups are per-request otherwise.
const nameCache = new Map<string, { name: string; expires: number }>()
const CACHE_MS = 5 * 60 * 1000

export async function getDisplayNames(userIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(userIds)].filter(Boolean)
  const now = Date.now()
  const need = unique.filter(id => !nameCache.has(id) || nameCache.get(id)!.expires < now)

  if (need.length) {
    try {
      const res = await clerkClient.users.getUserList({ userId: need, limit: need.length })
      for (const u of res.data) nameCache.set(u.id, { name: displayName(u), expires: now + CACHE_MS })
    } catch (err) {
      console.error('[users] getUserList failed', err instanceof Error ? err.message : err)
    }
    // Anything Clerk didn't return (deleted user, etc.) still gets a cached fallback.
    for (const id of need) if (!nameCache.has(id)) nameCache.set(id, { name: 'Unknown user', expires: now + CACHE_MS })
  }

  return Object.fromEntries(unique.map(id => [id, nameCache.get(id)?.name ?? 'Unknown user']))
}

export async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const u = await clerkClient.users.getUser(userId)
    return u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null
  } catch (err) {
    console.error('[users] getUser failed', err instanceof Error ? err.message : err)
    return null
  }
}

// Everyone who can meaningfully be @mentioned on a request: the Hyperbole team
// (SUPERADMIN_USER_IDS) plus the client's own org members (if they have a real
// Clerk org). This is what backs the "@" picker in the comment composer.
export async function getMentionableUsers(clientId: string): Promise<MentionableUser[]> {
  const results: MentionableUser[] = []

  if (SUPERADMIN_USER_IDS.length) {
    const names = await getDisplayNames(SUPERADMIN_USER_IDS)
    for (const id of SUPERADMIN_USER_IDS) results.push({ id, name: names[id] ?? 'Hyperbole Digital', isSuperadmin: true })
  }

  const client = await getClientById(clientId)
  if (client?.clerkOrgId) {
    try {
      const memberships = await clerkClient.organizations.getOrganizationMembershipList({ organizationId: client.clerkOrgId, limit: 100 })
      for (const m of memberships.data) {
        const u = m.publicUserData
        if (!u?.userId) continue
        const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
        results.push({ id: u.userId, name: full || u.identifier || 'Team member', isSuperadmin: false })
      }
    } catch (err) {
      console.error('[users] getOrganizationMembershipList failed', err instanceof Error ? err.message : err)
    }
  }

  // De-dupe (a superadmin could theoretically also be in the org list).
  const seen = new Set<string>()
  return results.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
}
