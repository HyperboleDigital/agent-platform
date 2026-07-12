import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ClerkProvider } from '@clerk/react'
import Dashboard from './pages/Dashboard'
import ClientDetail from './pages/ClientDetail'
import SignInPage from './pages/SignInPage'
import { ProtectedLayout } from './ProtectedLayout'
import { AuthBridge } from './AuthBridge'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set — see apps/dashboard/.env.example')
}

const router = createBrowserRouter([
  { path: '/sign-in/*', element: <SignInPage /> },
  {
    element: <ProtectedLayout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/clients/:id', element: <ClientDetail /> }
    ]
  }
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} signInUrl="/sign-in">
      <AuthBridge />
      <RouterProvider router={router} />
    </ClerkProvider>
  </StrictMode>
)
