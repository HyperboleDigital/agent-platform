import { SignIn } from '@clerk/react'

export default function SignInPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'system-ui' }}>
      <SignIn routing="path" path="/sign-in" />
    </div>
  )
}
