import { SignIn } from '@clerk/react'

// routing="hash" (NOT "path") is load-bearing — do not change it back.
//
// With routing="path", Clerk advances between steps by changing the PATHNAME
// (/sign-in -> /sign-in/factor-one when the code screen appears). Clerk only
// routes through React Router if <ClerkProvider> is given routerPush/
// routerReplace, and ours can't be: it's mounted ABOVE <RouterProvider> in
// main.tsx, so it has no navigate() to hand over. Clerk therefore fell back to
// raw window.history calls, which createBrowserRouter never observes — the two
// disagreed about the current URL, the route re-resolved, and <SignIn>
// REMOUNTED at exactly the moment it should have shown the code input. That
// discarded the in-progress sign-in attempt and started a new one, which is
// why the screen visibly flickered and a SECOND verification email went out.
//
// Hash routing puts the step in the fragment (#/factor-one) instead. React
// Router matches routes on pathname only, so the pathname stays /sign-in
// throughout, the route never re-resolves, and the component never remounts.
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {/* fallbackRedirectUrl only applies when there's no redirect_url in the
          query string — <RedirectToSignIn/> sets that to the page the user
          originally asked for, and it still takes precedence. */}
      <SignIn routing="hash" fallbackRedirectUrl="/" />
    </div>
  )
}
