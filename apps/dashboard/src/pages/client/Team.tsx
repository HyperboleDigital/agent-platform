import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { UserPlus, Mail, X, Users } from 'lucide-react'
import { api } from '@/lib/api'
import type { TeamMember, TeamRole } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'

function initials(member: TeamMember): string {
  const source = member.name ?? member.email ?? '?'
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join('')
}

function roleLabel(role: TeamRole): string {
  return role === 'org:admin' ? 'Admin' : 'Member'
}

function Avatar({ member }: { member: TeamMember }) {
  if (member.imageUrl) {
    return <img src={member.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
      {initials(member)}
    </div>
  )
}

export default function Team() {
  const { clientId } = useClientCtx()
  const key = ['team', clientId]
  const { data: team, isLoading, error } = useSWR(key, () => api.clients.team(clientId))

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('org:member')
  const [inviting, setInviting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const seatsFull = !!team && team.seatsUsed >= team.seatLimit
  const canManage = team?.canManage ?? false

  async function invite() {
    const address = email.trim()
    if (!address) return
    setInviting(true)
    try {
      await api.clients.inviteTeamMember(clientId, address, role)
      setEmail('')
      setRole('org:member')
      mutate(key)
      toast.success(`Invite sent to ${address}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  async function revoke(invitationId: string, address: string) {
    if (!window.confirm(`Revoke the invite for ${address}?`)) return
    setBusyId(invitationId)
    try {
      await api.clients.revokeTeamInvitation(clientId, invitationId)
      mutate(key)
      toast.success('Invite revoked')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke invite')
    } finally {
      setBusyId(null)
    }
  }

  async function changeRole(member: TeamMember, next: TeamRole) {
    setBusyId(member.userId)
    try {
      await api.clients.updateTeamMemberRole(clientId, member.userId, next)
      mutate(key)
      toast.success(`${member.name ?? member.email} is now ${roleLabel(next).toLowerCase()}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(member: TeamMember) {
    const who = member.name ?? member.email ?? 'this member'
    if (!window.confirm(`Remove ${who} from the team? They'll lose access to this dashboard.`)) return
    setBusyId(member.userId)
    try {
      await api.clients.removeTeamMember(clientId, member.userId)
      mutate(key)
      toast.success('Member removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member')
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />

  if (error || !team) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={Users}
            title="Team unavailable"
            description={error instanceof Error ? error.message : 'Could not load this team right now.'}
            action={<Button variant="outline" size="sm" onClick={() => mutate(key)}>Retry</Button>}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Team members</CardTitle>
            <CardDescription>Everyone here can sign in and see this account's dashboard.</CardDescription>
          </div>
          <Badge variant={seatsFull ? 'secondary' : 'default'}>
            {team.seatsUsed} of {team.seatLimit} seats
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border border-t border-border p-0">
          {team.members.map(member => {
            const isSelf = member.userId === team.currentUserId
            const busy = busyId === member.userId
            return (
              <div key={member.id} className="flex items-center gap-3 px-6 py-3">
                <Avatar member={member} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name ?? member.email ?? 'Unknown user'}
                    {isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                  </p>
                  {member.name && member.email && (
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  )}
                </div>
                {canManage && !isSelf ? (
                  <select
                    value={member.role}
                    disabled={busy}
                    onChange={e => changeRole(member, e.target.value as TeamRole)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
                  >
                    <option value="org:admin">Admin</option>
                    <option value="org:member">Member</option>
                  </select>
                ) : (
                  <Badge variant="secondary">{roleLabel(member.role)}</Badge>
                )}
                {canManage && !isSelf && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => remove(member)}
                    aria-label={`Remove ${member.name ?? member.email ?? 'member'}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {team.invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>These take a seat until they're accepted or revoked.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border border-t border-border p-0">
            {team.invitations.map(invitation => (
              <div key={invitation.id} className="flex items-center gap-3 px-6 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited {new Date(invitation.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant="secondary">{roleLabel(invitation.role)}</Badge>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === invitation.id}
                    onClick={() => revoke(invitation.id, invitation.email)}
                    aria-label={`Revoke invite for ${invitation.email}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
            <CardDescription>
              {seatsFull
                ? `You've used all ${team.seatLimit} seats. Remove a member or revoke an invite to free one up.`
                : `They'll get an email invite. ${team.seatLimit - team.seatsUsed} seat${team.seatLimit - team.seatsUsed === 1 ? '' : 's'} left.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@company.com"
                value={email}
                disabled={seatsFull || inviting}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') invite() }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                value={role}
                disabled={seatsFull || inviting}
                onChange={e => setRole(e.target.value as TeamRole)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50 sm:w-36"
              >
                <option value="org:member">Member</option>
                <option value="org:admin">Admin</option>
              </select>
            </div>
            <Button onClick={invite} disabled={seatsFull || inviting || !email.trim()}>
              <UserPlus className="mr-2 h-4 w-4" />
              {inviting ? 'Sending…' : 'Send invite'}
            </Button>
          </CardContent>
        </Card>
      )}

      {!canManage && (
        <p className="text-xs text-muted-foreground">
          Only team admins can invite or remove members.
        </p>
      )}
    </div>
  )
}
