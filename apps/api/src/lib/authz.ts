import { getAuth } from '@clerk/express'
import type { Request } from 'express'
import { getClientById } from './clients'

// Comma-separated Clerk user IDs (e.g. "user_2abc,user_2def") with full
// cross-tenant access — your team, not clients. Simple allowlist for now;
// upgrade to a Clerk org-role/system-role check once real client orgs exist.
const SUPERADMIN_USER_IDS = (process.env.SUPERADMIN_USER_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export interface Identity {
  userId: string
  orgId: string | null
  orgRole: string | null
  isSuperadmin: boolean
}

// Resolves the authenticated identity from a Clerk session, or null if the
// request is unauthenticated. Requires clerkMiddleware() to run first.
export function getIdentity(req: Request): Identity | null {
  const auth = getAuth(req)
  if (!auth.userId) return null
  return {
    userId: auth.userId,
    orgId: auth.orgId ?? null,
    orgRole: auth.orgRole ?? null,
    isSuperadmin: SUPERADMIN_USER_IDS.includes(auth.userId)
  }
}

// Seat management (invite/remove/change role) is limited to org admins —
// regular members can see the team but not change it. Superadmins can manage
// any client's team from the console.
export function canManageTeam(identity: Identity): boolean {
  return identity.isSuperadmin || identity.orgRole === 'org:admin'
}

// Can this identity read/write the given client's data? Superadmins can
// access any client; everyone else must belong to the Clerk Org that owns it.
export async function canAccessClient(identity: Identity, clientId: string): Promise<boolean> {
  if (identity.isSuperadmin) return true
  if (!identity.orgId) return false
  const client = await getClientById(clientId)
  return !!client && client.clerkOrgId === identity.orgId
}
