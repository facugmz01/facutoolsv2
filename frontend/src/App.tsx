import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './auth/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import Domains from './pages/Domains'
import AddDomain from './pages/AddDomain'
import DomainDetail from './pages/DomainDetail'
import SubdomainDetail from './pages/SubdomainDetail'
import Tools, { domainTools } from './pages/Tools'
import Alerts from './pages/Alerts'
import Watchlist from './pages/Watchlist'
import Monitoring from './pages/Monitoring'
import MonitorDetail from './pages/MonitorDetail'
import NotificationTemplates from './pages/NotificationTemplates'
import Compare from './pages/Compare'
import SSL from './pages/SSL'
import SettingsPage from './pages/Settings'
import LoginPage from './pages/Login'
import InvitePage from './pages/Invite'
import SsoCallbackPage from './pages/SsoCallback'
import UsersPage from './pages/Users'
import RolesPage from './pages/Roles'
import HerramientasIndex from './pages/network/HerramientasIndex'
import IpLookupPage from './pages/network/IpLookupPage'
import DnsCheckerPage from './pages/network/DnsCheckerPage'
import WhoisPage from './pages/network/WhoisPage'
import PropagacionPage from './pages/network/PropagacionPage'
import MacLookupPage from './pages/network/MacLookupPage'
import ContrasenasPage from './pages/network/ContrasenasPage'
import IpCalcPage from './pages/network/IpCalcPage'
import SmtpTesterPage from './pages/network/SmtpTesterPage'
import PortCheckerPage from './pages/network/PortCheckerPage'
import SslConverterPage from './pages/network/SslConverterPage'

function Shell({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/sso/callback" element={<SsoCallbackPage />} />
      <Route path="/invite" element={<InvitePage />} />

      <Route path="/backoffice" element={<ProtectedRoute permission="domains:read"><Shell><Dashboard /></Shell></ProtectedRoute>} />
      <Route path="/domains" element={<ProtectedRoute permission="domains:read"><Shell><Domains /></Shell></ProtectedRoute>} />
      <Route path="/domains/add" element={<ProtectedRoute permission="domains:write"><Shell><AddDomain /></Shell></ProtectedRoute>} />
      <Route path="/domains/:id" element={<ProtectedRoute permission="domains:read"><Shell><DomainDetail /></Shell></ProtectedRoute>} />
      <Route path="/domains/:domainId/subdomains/:subdomainId" element={<ProtectedRoute permission="subdomains:read"><Shell><SubdomainDetail /></Shell></ProtectedRoute>} />
      <Route path="/ssl" element={<ProtectedRoute permission="ssl:read"><Shell><SSL /></Shell></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute permission="settings:read"><Shell><SettingsPage /></Shell></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute permission="users:read"><Shell><UsersPage /></Shell></ProtectedRoute>} />
      <Route path="/roles" element={<ProtectedRoute permission="roles:read"><Shell><RolesPage /></Shell></ProtectedRoute>} />
      <Route element={<ProtectedRoute><Shell><Outlet /></Shell></ProtectedRoute>}>
        <Route path="/" element={<HerramientasIndex />} />
        <Route path="/tools" element={<Navigate to="/" replace />} />
        <Route path="/herramientas/scan" element={<Navigate to="/" replace />} />
        <Route path="/herramientas/tech" element={<Navigate to="/" replace />} />
        <Route path="/herramientas/suggestions" element={<Navigate to="/" replace />} />
        <Route path="/herramientas/ransomware" element={<Navigate to="/" replace />} />
        {domainTools.map(tool => (
          <Route key={tool.id} path={`/herramientas/${tool.id}`} element={<Tools key={tool.id} tool={tool.id} />} />
        ))}
        <Route path="/herramientas" element={<Navigate to="/" replace />} />
        <Route path="/herramientas/ip-lookup" element={<IpLookupPage />} />
        <Route path="/herramientas/dns" element={<DnsCheckerPage />} />
        <Route path="/herramientas/whois" element={<WhoisPage />} />
        <Route path="/herramientas/propagacion" element={<PropagacionPage />} />
        <Route path="/herramientas/mac" element={<MacLookupPage />} />
        <Route path="/herramientas/contrasenas" element={<ContrasenasPage />} />
        <Route path="/herramientas/ip-calc" element={<IpCalcPage />} />
        <Route path="/herramientas/smtp" element={<SmtpTesterPage />} />
        <Route path="/herramientas/ssl-convert" element={<SslConverterPage />} />
        <Route path="/herramientas/puertos" element={<PortCheckerPage />} />
      </Route>
      <Route path="/alerts" element={<ProtectedRoute permission="alerts:read"><Shell><Alerts /></Shell></ProtectedRoute>} />
      <Route path="/notification-templates" element={<ProtectedRoute permission="alerts:read"><Shell><NotificationTemplates /></Shell></ProtectedRoute>} />
      <Route path="/watchlist" element={<ProtectedRoute permission="watchlist:read"><Shell><Watchlist /></Shell></ProtectedRoute>} />
      <Route path="/monitoring" element={<ProtectedRoute permission="monitoring:read"><Shell><Monitoring /></Shell></ProtectedRoute>} />
      <Route path="/monitoring/:id" element={<ProtectedRoute permission="monitoring:read"><Shell><MonitorDetail /></Shell></ProtectedRoute>} />
      <Route path="/compare" element={<ProtectedRoute permission="domains:read"><Shell><Compare /></Shell></ProtectedRoute>} />
    </Routes>
  )
}
