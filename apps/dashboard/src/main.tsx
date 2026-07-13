import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ClerkProvider } from '@clerk/react'
import { dark } from '@clerk/themes'
import { Toaster } from 'sonner'
import Dashboard from './pages/Dashboard'
import ClientDetail from './pages/ClientDetail'
import Overview from './pages/Overview'
import SignInPage from './pages/SignInPage'
import { ProtectedLayout } from './ProtectedLayout'
import { AuthBridge } from './AuthBridge'
import { AppShell } from './components/app-shell'
import { ThemeProvider } from './components/theme-provider'
import './index.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set — see apps/dashboard/.env.example')
}

const router = createBrowserRouter([
  { path: '/sign-in/*', element: <SignInPage /> },
  {
    element: <ProtectedLayout />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Dashboard /> },
          { path: '/clients/:id', element: <ClientDetail /> },
          { path: '/overview', element: <Overview /> }
        ]
      }
    ]
  }
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} signInUrl="/sign-in" appearance={{ baseTheme: dark } as never}>
        <AuthBridge />
        <RouterProvider router={router} />
        <Toaster theme="dark" richColors position="top-right" />
      </ClerkProvider>
    </ThemeProvider>
  </StrictMode>
)
