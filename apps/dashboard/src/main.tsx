import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ClerkProvider } from '@clerk/react'
import { dark } from '@clerk/themes'
import { Toaster } from 'sonner'
import Dashboard from './pages/Dashboard'
import Overview from './pages/Overview'
import AuditTool from './pages/AuditTool'
import Prospecting from './pages/Prospecting'
import ClientLayout from './pages/client/ClientLayout'
import {
  ClientHome, LeadsSection, BillingSection, ConfigSection
} from './pages/ClientDetail'
import { Gate } from './components/gate'
import Assistant from './pages/client/Assistant'
import SeoVisibility from './pages/client/SeoVisibility'
import LocalPresence from './pages/client/LocalPresence'
import Content from './pages/client/Content'
import PaidAds from './pages/client/PaidAds'
import Requests from './pages/client/Requests'
import Reports from './pages/client/Reports'
import SignInPage from './pages/SignInPage'
import { ProtectedLayout } from './ProtectedLayout'
import { AuthBridge } from './AuthBridge'
import { OrgActivator } from './OrgActivator'
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
          { path: '/audit-tool', element: <AuditTool /> },
          { path: '/prospecting', element: <Prospecting /> },
          {
            path: '/clients/:id',
            element: <ClientLayout />,
            children: [
              { index: true, element: <ClientHome /> },
              { path: 'seo', element: <Gate service="seo"><SeoVisibility /></Gate> },
              { path: 'local', element: <Gate service="local"><LocalPresence /></Gate> },
              { path: 'assistant', element: <Gate service="chat"><Assistant /></Gate> },
              { path: 'content', element: <Gate service="content"><Content /></Gate> },
              { path: 'ads', element: <Gate service="ads"><PaidAds /></Gate> },
              { path: 'leads', element: <LeadsSection /> },
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
        <OrgActivator />
        <RouterProvider router={router} />
        <Toaster theme="dark" richColors position="top-right" />
      </ClerkProvider>
    </ThemeProvider>
  </StrictMode>
)
