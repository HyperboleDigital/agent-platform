import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import ClientDetail from './pages/ClientDetail'

const router = createBrowserRouter([
  { path: '/', element: <Dashboard /> },
  { path: '/clients/:id', element: <ClientDetail /> }
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
