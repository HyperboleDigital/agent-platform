import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ClerkProvider } from '@clerk/react'
import { dark } from '@clerk/themes'
import { Toaster } from 'sonner'
import Dashboard from './pages/Dashboard'
import Overview from './pages/Overview'
import ClientLayout from './pages/client/ClientLayout'
import {
  ClientHome, LeadsSection, ConnectorsSection, BillingSection, ConfigSection
} from './pages/ClientDetail'
import { Gate } from './components/gate'
import Assistant from './pages/client/Assistant'
import SeoVisibility from './pages/client/SeoVisibility'
import Content from './pages/client/Content'
import Requests from './pages/client/Requests'
import Reports from './pages/client/Reports'
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
          { path: '/overview', element: <Overview /> },
          {
            path: '/clients/:id',
            element: <ClientLayout />,
            children: [
              { index: true, element: <ClientHome /> },
              { path: 'assistant', element: <Assistant /> },
              { path: 'leads', element: <LeadsSection /> },
              { path: 'connectors', element: <ConnectorsSection /> },
              { path: 'seo', element: <Gate service="seo"><SeoVisibility /></Gate> },
              { path: 'content', element: <Gate service="content"><Content /></Gate> },
              { path: 'requests', element: <Requests /> },
              { path: 'reports', element: <Reports /> },
              { path: 'billing', element: <BillingSection /> },
              { path: 'config', element: <ConfigSection /> }
            ]
          }
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
