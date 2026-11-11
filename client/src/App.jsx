import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { RealtimeProvider } from './realtime'
import { BrandingProvider } from './context/BrandingContext'
import { ThemeProvider } from './context/ThemeContext'
import { ToastsProvider } from './context/ToastsContext'
import ProtectedRoute, { RootRedirect } from './components/ProtectedRoute'
import PanelLayout from './components/PanelLayout'
import FamilyLayout from './components/FamilyLayout'
import ToastStack from './components/ToastStack'
import InstallPrompt from './components/InstallPrompt'
import { Loading } from './components/ui'

import LoginPage from './pages/LoginPage'
import ForceChangePasswordPage from './pages/ForceChangePasswordPage'
import DashboardPage from './pages/DashboardPage'
import DayBoardPage from './pages/DayBoardPage'
import DayTrackerPage from './pages/DayTrackerPage'
import MealsPage from './pages/MealsPage'
import DailyLogsPage from './pages/DailyLogsPage'
import './App.css'

// Las páginas menos usadas se cargan bajo demanda: la primera carga en el móvil es más ligera.
// Si tras un despliegue el trozo viejo ya no existe, se recarga la página una vez.
function lazyPage(load) {
  return lazy(() =>
    load()
      .then((mod) => {
        try {
          sessionStorage.removeItem('sonrisas_chunk_reload')
        } catch {
          // sin almacenamiento: nada que limpiar
        }
        return mod
      })
      .catch((err) => {
      let reloaded
      try {
        reloaded = sessionStorage.getItem('sonrisas_chunk_reload') === '1'
        sessionStorage.setItem('sonrisas_chunk_reload', '1')
      } catch {
        reloaded = true
      }
      if (!reloaded) window.location.reload()
      throw err
    }),
  )
}
const ActivitiesPage = lazyPage(() => import('./pages/ActivitiesPage'))
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'))
const ChildrenPage = lazyPage(() => import('./pages/ChildrenPage'))
const ChildDetailPage = lazyPage(() => import('./pages/ChildDetailPage'))
const ClassroomsPage = lazyPage(() => import('./pages/ClassroomsPage'))
const GalleryPage = lazyPage(() => import('./pages/GalleryPage'))
const JustificationsPage = lazyPage(() => import('./pages/JustificationsPage'))
const GeneralReportsPage = lazyPage(() => import('./pages/GeneralReportsPage'))
const MyAttendancePage = lazyPage(() => import('./pages/MyAttendancePage'))
const TasksPage = lazyPage(() => import('./pages/TasksPage'))
const StaffPage = lazyPage(() => import('./pages/StaffPage'))
const SchedulePage = lazyPage(() => import('./pages/SchedulePage'))
const BrandingPage = lazyPage(() => import('./pages/BrandingPage'))
const AccountPage = lazyPage(() => import('./pages/AccountPage'))
const SecurityPage = lazyPage(() => import('./pages/SecurityPage'))
const AuditPage = lazyPage(() => import('./pages/AuditPage'))
const GuardiansPage = lazyPage(() => import('./pages/GuardiansPage'))
const WhatsAppPage = lazyPage(() => import('./pages/WhatsAppPage'))
const ConsentsPage = lazyPage(() => import('./pages/ConsentsPage'))
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'))
const BackupsPage = lazyPage(() => import('./pages/BackupsPage'))
const SystemPage = lazyPage(() => import('./pages/SystemPage'))

const FamilyHomePage = lazyPage(() => import('./pages/family/FamilyHomePage'))
const FamilyChildPage = lazyPage(() => import('./pages/family/FamilyChildPage'))
const FamilyGalleryPage = lazyPage(() => import('./pages/family/FamilyGalleryPage'))
const FamilyJustificationsPage = lazyPage(() => import('./pages/family/FamilyJustificationsPage'))
const FamilyPrivacyPage = lazyPage(() => import('./pages/family/FamilyPrivacyPage'))

/** Tiempo real sólo con sesión completa (no durante el cambio obligatorio de clave). */
function RealtimeGate({ children }) {
  const { user } = useAuth()
  return <RealtimeProvider enabled={!!user && !user.mustChangePassword}>{children}</RealtimeProvider>
}

/** Dirección y coordinación (lo que el menú marca con `manage: true`). */
const MANAGERS = ['admin', 'coordinator']

export default function App() {
  return (
    <ThemeProvider>
      <ToastsProvider>
        <BrandingProvider>
          <AuthProvider>
            <RealtimeGate>
            <BrowserRouter>
              <ToastStack />
              <InstallPrompt />
              <Suspense fallback={<Loading label="Cargando…" />}>
              <Routes>
                {/* Raíz: redirige según el rol; sin sesión muestra el login */}
                <Route path="/" element={<RootRedirect fallback={<LoginPage />} />} />
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/cambiar-clave"
                  element={
                    <ProtectedRoute>
                      <ForceChangePasswordPage />
                    </ProtectedRoute>
                  }
                />

                {/* Panel del personal */}
                <Route
                  element={
                    <ProtectedRoute role="staff">
                      <PanelLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/panel" element={<DashboardPage />} />
                  <Route path="/panel/seguimiento" element={<DayTrackerPage />} />
                  <Route path="/panel/dia" element={<DayBoardPage />} />
                  <Route path="/panel/comidas" element={<MealsPage />} />
                  <Route path="/panel/actividades" element={<ActivitiesPage />} />
                  <Route path="/panel/bitacora" element={<DailyLogsPage />} />
                  <Route path="/panel/reportes" element={<ReportsPage />} />
                  <Route path="/panel/ninos" element={<ChildrenPage />} />
                  <Route path="/panel/ninos/:id" element={<ChildDetailPage />} />
                  <Route path="/panel/salas" element={<ClassroomsPage />} />
                  <Route path="/panel/galeria" element={<GalleryPage />} />
                  <Route path="/panel/justificaciones" element={<JustificationsPage />} />
                  <Route path="/panel/informes" element={<GeneralReportsPage />} />
                  <Route path="/panel/mi-asistencia" element={<MyAttendancePage />} />
                  <Route path="/panel/pendientes" element={<TasksPage />} />
                  <Route
                    path="/panel/personal"
                    element={<ProtectedRoute role={MANAGERS}><StaffPage /></ProtectedRoute>}
                  />
                  <Route
                    path="/panel/representantes"
                    element={<ProtectedRoute role={MANAGERS}><GuardiansPage /></ProtectedRoute>}
                  />
                  <Route
                    path="/panel/consentimientos"
                    element={<ProtectedRoute role={MANAGERS}><ConsentsPage /></ProtectedRoute>}
                  />
                  {/* Ajustes: configuración del centro y de la cuenta en un solo lugar.
                      Mismas reglas de rol que el menú (navConfig SETTINGS). */}
                  <Route path="/panel/ajustes" element={<SettingsPage />}>
                    <Route
                      path="horario"
                      element={<ProtectedRoute role="admin"><SchedulePage /></ProtectedRoute>}
                    />
                    <Route
                      path="marca"
                      element={<ProtectedRoute role="admin"><BrandingPage /></ProtectedRoute>}
                    />
                    <Route
                      path="whatsapp"
                      element={<ProtectedRoute role={MANAGERS}><WhatsAppPage /></ProtectedRoute>}
                    />
                    <Route
                      path="respaldos"
                      element={<ProtectedRoute role="admin"><BackupsPage /></ProtectedRoute>}
                    />
                    <Route
                      path="actualizaciones"
                      element={<ProtectedRoute role="admin"><SystemPage /></ProtectedRoute>}
                    />
                    <Route
                      path="auditoria"
                      element={<ProtectedRoute role="admin"><AuditPage /></ProtectedRoute>}
                    />
                    <Route path="cuenta" element={<AccountPage />} />
                    <Route path="seguridad" element={<SecurityPage />} />
                  </Route>
                  {/* Direcciones antiguas → Ajustes (enlaces guardados, menú de usuario, buscador) */}
                  <Route path="/panel/whatsapp" element={<Navigate to="/panel/ajustes/whatsapp" replace />} />
                  <Route path="/panel/horario" element={<Navigate to="/panel/ajustes/horario" replace />} />
                  <Route path="/panel/marca" element={<Navigate to="/panel/ajustes/marca" replace />} />
                  <Route path="/panel/auditoria" element={<Navigate to="/panel/ajustes/auditoria" replace />} />
                  <Route path="/panel/cuenta" element={<Navigate to="/panel/ajustes/cuenta" replace />} />
                  <Route path="/panel/respaldos" element={<Navigate to="/panel/ajustes/respaldos" replace />} />
                  <Route path="/panel/sistema" element={<Navigate to="/panel/ajustes/actualizaciones" replace />} />
                  <Route path="/panel/seguridad" element={<Navigate to="/panel/ajustes/seguridad" replace />} />
                </Route>

                {/* Portal de representantes */}
                <Route
                  element={
                    <ProtectedRoute role="guardian">
                      <FamilyLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/familia" element={<FamilyHomePage />} />
                  <Route path="/familia/nino/:childId" element={<FamilyChildPage />} />
                  <Route path="/familia/galeria" element={<FamilyGalleryPage />} />
                  <Route path="/familia/avisos" element={<FamilyJustificationsPage />} />
                  <Route path="/familia/privacidad" element={<FamilyPrivacyPage />} />
                  <Route path="/familia/cuenta" element={<AccountPage />} />
                  <Route path="/familia/seguridad" element={<SecurityPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </Suspense>
            </BrowserRouter>
            </RealtimeGate>
          </AuthProvider>
        </BrandingProvider>
      </ToastsProvider>
    </ThemeProvider>
  )
}
