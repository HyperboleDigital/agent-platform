import { clerkClient } from '@clerk/express'

// Seats are counted as accepted members + still-pending invitations, so a
// client can't queue up 10 invites against a 3-seat limit and blow past it
// as they're accepted. Overridable per-deployment, but 3 is the product rule.
export const SEAT_LIMIT = Number(process.env.TEAM_SEAT_LIMIT ?? 3)

export type TeamRole = 'org:admin' | 'org:member'
const ROLES: TeamRole[] = ['org:admin', 'org:member']

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && ROLES.includes(value as TeamRole)
}

export interface TeamMember {
  id: string // Clerk organization membership id
  userId: string
  email: string | null
  name: string | null
  imageUrl: string | null
  role: TeamRole
  createdAt: string
}

export interface TeamInvitation {
  id: string
  email: string
  role: TeamRole
  createdAt: string
}

export interface TeamOverview {
  members: TeamMember[]
  invitations: TeamInvitation[]
  seatLimit: number
  seatsUsed: number
}

// Thrown for anything the user can fix (bad email, seat limit, last admin).
// Routes map this to a 400 with the message; everything else stays a 500.
export class TeamError extends Error {}

// Where an invited teammate lands. Must be the /sign-up route: Clerk appends
// `__clerk_ticket` here, and only <SignUp> consumes it. Pointing this at the
// dashboard root instead sends the invitee through ProtectedLayout's
// RedirectToSignIn, which strips the query string and loses the ticket.
function invitationRedirectUrl(): string | undefined {
  const origin = (process.env.DASHBOARD_URL?.trim() || process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim())
  return origin ? `${origin.replace(/\/$/, '')}/sign-up` : undefined
}

function normalizeRole(role: string): TeamRole {
  return role === 'org:admin' ? 'org:admin' : 'org:member'
}

function toIso(value: number | string | undefined): string {
  if (typeof value === 'number') return new Date(value).toISOString()
  return value ?? new Date().toISOString()
}

export async function getTeam(orgId: string): Promise<TeamOverview> {
  const [memberships, invitations] = await Promise.all([
    clerkClient.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 }),
    clerkClient.organizations.getOrganizationInvitationList({ organizationId: orgId, status: ['pending'] })
  ])

  const members: TeamMember[] = memberships.data.map(m => {
    const user = m.publicUserData
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ')
    return {
      id: m.id,
      userId: user?.userId ?? '',
      email: user?.identifier ?? null,
      name: name || null,
      imageUrl: user?.imageUrl ?? null,
      role: normalizeRole(m.role),
      createdAt: toIso(m.createdAt)
    }
  })

  // Clerk only marks an invitation `accepted` when the invitee signs up through
  // that exact ticket link. Add someone to the org directly (Dashboard → Add
  // member, or the memberships API) and their earlier invite dangles at
  // `pending` forever — so the same person shows up twice and eats two seats.
  // Treat an invite for an existing member as already fulfilled.
  const memberEmails = new Set(members.map(m => m.email?.toLowerCase()).filter(Boolean))
  const pending: TeamInvitation[] = invitations.data
    .filter(i => !memberEmails.has(i.emailAddress.toLowerCase()))
    .map(i => ({
      id: i.id,
      email: i.emailAddress,
      role: normalizeRole(i.role),
      createdAt: toIso(i.createdAt)
    }))

  return {
    members,
    invitations: pending,
    seatLimit: SEAT_LIMIT,
    seatsUsed: members.length + pending.length
  }
}

export async function inviteMember(
  orgId: string,
  inviterUserId: string,
  email: string,
  role: TeamRole
): Promise<TeamInvitation> {
  const address = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new TeamError('Enter a valid email address')

  const team = await getTeam(orgId)
  if (team.members.some(m => m.email?.toLowerCase() === address)) {
    throw new TeamError('That person is already on the team')
  }
  if (team.invitations.some(i => i.email.toLowerCase() === address)) {
    throw new TeamError('That email already has a pending invite')
  }
  if (team.seatsUsed >= SEAT_LIMIT) {
    throw new TeamError(`Your team is limited to ${SEAT_LIMIT} seats. Remove a member or revoke an invite first.`)
  }

  try {
    const invitation = await clerkClient.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: address,
      role,
      // Clerk requires an inviter who is an org admin. Superadmins acting on a
      // client's behalf aren't org members, so fall back to org-issued invites.
      inviterUserId: team.members.some(m => m.userId === inviterUserId && m.role === 'org:admin')
        ? inviterUserId
        : undefined,
      redirectUrl: invitationRedirectUrl()
    })
    return {
      id: invitation.id,
      email: invitation.emailAddress,
      role: normalizeRole(invitation.role),
      createdAt: toIso(invitation.createdAt)
    }
  } catch (err) {
    // Clerk returns structured errors (already a member, blocked domain, …) —
    // surface the message rather than a bare 500.
    const message = (err as { errors?: { message?: string }[] })?.errors?.[0]?.message
    throw message ? new TeamError(message) : (err as Error)
  }
}

export async function revokeInvitation(orgId: string, invitationId: string, requestingUserId: string): Promise<void> {
  // Clerk rejects requestingUserId unless that user belongs to the org, so a
  // superadmin acting on a client's behalf must revoke as the backend instead
  // (same reason inviteMember conditions inviterUserId).
  const team = await getTeam(orgId)
  const isMember = team.members.some(m => m.userId === requestingUserId)
  try {
    await clerkClient.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId,
      requestingUserId: isMember ? requestingUserId : undefined
    })
  } catch (err) {
    const message = (err as { errors?: { message?: string }[] })?.errors?.[0]?.message
    throw message ? new TeamError(message) : (err as Error)
  }
}

// `allowLastAdmin` is the superadmin override: a CLIENT admin must never
// strand their own team with no one who can manage seats, but the agency
// operator legitimately empties teams (offboarding, resetting a client's
// seats) and can always re-invite via the backend.
export async function removeMember(orgId: string, userId: string, allowLastAdmin = false): Promise<void> {
  const team = await getTeam(orgId)
  const target = team.members.find(m => m.userId === userId)
  if (!target) throw new TeamError('That member is no longer on the team')
  // Never let a team strand itself with no one who can manage seats.
  if (!allowLastAdmin && target.role === 'org:admin' && team.members.filter(m => m.role === 'org:admin').length === 1) {
    throw new TeamError('You can\'t remove the last admin — promote someone else first')
  }
  await clerkClient.organizations.deleteOrganizationMembership({ organizationId: orgId, userId })
}

export async function updateMemberRole(orgId: string, userId: string, role: TeamRole, allowLastAdmin = false): Promise<TeamMember> {
  const team = await getTeam(orgId)
  const target = team.members.find(m => m.userId === userId)
  if (!target) throw new TeamError('That member is no longer on the team')
  if (
    !allowLastAdmin &&
    target.role === 'org:admin' && role !== 'org:admin' &&
    team.members.filter(m => m.role === 'org:admin').length === 1
  ) {
    throw new TeamError('You can\'t demote the last admin — promote someone else first')
  }
  await clerkClient.organizations.updateOrganizationMembership({ organizationId: orgId, userId, role })
  return { ...target, role }
}
