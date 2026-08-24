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
import Jobs from './pages/Jobs'
import ClientLayout from './pages/client/ClientLayout'
import {
  ClientHome, LeadsSection, BillingSection, ConfigSection
} from './pages/ClientDetail'
import { Gate, AdminOnly } from './components/gate'
import Assistant from './pages/client/Assistant'
import SeoVisibility from './pages/client/SeoVisibility'
import LocalPresence from './pages/client/LocalPresence'
import Content from './pages/client/Content'
import PaidAds from './pages/client/PaidAds'
import Requests from './pages/client/Requests'
import Reports from './pages/client/Reports'
import Team from './pages/client/Team'
import InfoSheet from './pages/client/InfoSheet'
import SignInPage from './pages/SignInPage'
import SignUpPage from './pages/SignUpPage'
import { ProtectedLayout } from './ProtectedLayout'
import { AuthBridge } from './AuthBridge'
import { OrgActivator } from './OrgActivator'
import { AppShell } from './components/app-shell'
import { ConfirmProvider } from './components/confirm-dialog'
import './index.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set — see apps/dashboard/.env.example')
}

const router = createBrowserRouter([
  { path: '/sign-in/*', element: <SignInPage /> },
  { path: '/sign-up/*', element: <SignUpPage /> },
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
          { path: '/jobs', element: <AdminOnly><Jobs /></AdminOnly> },
          {
            path: '/clients/:slug',
            element: <ClientLayout />,
            children: [
              { index: true, element: <ClientHome /> },
              { path: 'seo', element: <Gate service="seo"><SeoVisibility /></Gate> },
              { path: 'local', element: <Gate service="local"><LocalPresence /></Gate> },
              { path: 'assistant', element: <Gate service="chat"><Assistant /></Gate> },
              { path: 'leads', element: <LeadsSection /> },
              // Internal agency tooling — we draft/publish on the client's
              // behalf, so it's superadmin-only and hidden from their nav.
              { path: 'content', element: <AdminOnly><Gate service="content"><Content /></Gate></AdminOnly> },
              { path: 'ads', element: <Gate service="ads"><PaidAds /></Gate> },
              { path: 'requests', element: <Requests /> },
              { path: 'reports', element: <Reports /> },
              { path: 'team', element: <Team /> },
              { path: 'billing', element: <BillingSection /> },
              // The per-deal commercial summary (tier + add-ons + custom line
              // items) — the artifact that goes to the client, superadmin-only.
              { path: 'info-sheet', element: <AdminOnly><InfoSheet /></AdminOnly> },
              { path: 'config', element: <ConfigSection /> }
            ]
          }
        ]
      }
    ]
  }
])

// Dark mode only, permanently — there is no light theme and no toggle
// anywhere in the app (see index.html's hardcoded class="dark" and
// index.css's dark-first tokens). next-themes previously sat here to support
// a toggle that has been removed; it's gone rather than left wired to a
// choice nothing can make anymore.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      appearance={{ baseTheme: dark } as never}
    >
      <AuthBridge />
      <OrgActivator />
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
      <Toaster theme="dark" richColors position="top-right" />
    </ClerkProvider>
  </StrictMode>
)
