import { SignUp, SignOutButton, useUser } from '@clerk/react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// Where org invitations land. Clerk appends `__clerk_ticket` to the invite
// link; <SignUp> consumes it and adds the new account to the inviting org.
// This route must stay OUTSIDE ProtectedLayout — its RedirectToSignIn drops
// the query string, which would throw the ticket away.
//
// Uses routing="hash" for the same reason as SignInPage — see the comment
// there. An invited client hits the identical remount-mid-flow bug otherwise.
// The ticket is unaffected: hash routing only ever writes the fragment, so the
// query string this component reads below survives exactly as the invite email
// left it.
export default function SignUpPage() {
  const [params] = useSearchParams()
  const ticket = params.get('__clerk_ticket')
  const { isLoaded, isSignedIn, user } = useUser()

  if (!isLoaded) return null

  // An invite can't be accepted onto an already-signed-in session — Clerk ties
  // the ticket to the email it was sent to. Rather than silently doing nothing
  // (which is what a bare <SignUp> does here), say so and offer the way out.
  if (ticket && isSignedIn) {
    const current = user?.primaryEmailAddress?.emailAddress
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>You're already signed in</CardTitle>
            <CardDescription>
              {current ? `This browser is signed in as ${current}.` : 'This browser already has an active session.'}
              {' '}Sign out to accept the invitation with the address it was sent to.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Returns to this same URL, ticket intact, so the invite resumes. */}
            <SignOutButton redirectUrl={`/sign-up?__clerk_ticket=${encodeURIComponent(ticket)}`}>
              <Button className="w-full">Sign out and accept invite</Button>
            </SignOutButton>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignUp routing="hash" signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </div>
  )
}
