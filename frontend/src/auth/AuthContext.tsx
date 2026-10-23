import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEYS = {
  access: 'dt_access_token',
  refresh: 'dt_refresh_token',
}

export interface AuthUser {
  id: number
  email: string
  name: string
  is_active: boolean
  password_set: boolean
  created_at: string
}

export interface AuthOrg {
  id: number
  name: string
  slug: string
  role_name?: string | null
  permissions: string[]
}

interface AuthContextValue {
  user: AuthUser | null
  organization: AuthOrg | null
  permissions: string[]
  accessToken: string | null
  bootstrapRequired: boolean
  loading: boolean
  hasPermission: (...codes: string[]) => boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; password: string; name: string; organization_name: string }) => Promise<void>
  logout: () => Promise<void>
  acceptInvite: (token: string, name: string, password: string) => Promise<void>
  completeSsoLogin: (access: string, refresh: string) => Promise<void>
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function rawRequest<T>(path: string, options?: RequestInit & { token?: string | null }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  }
  if (options?.token) headers.Authorization = `Bearer ${options.token}`

  const res = await fetch(`/api${path}`, { ...options, headers })
  if (!res.ok) {
    let msg = `Error API: ${res.status}`
    try {
      const err = await res.json()
      const detail = err.detail ?? err.message
      if (typeof detail === 'string') msg = detail
      else if (Array.isArray(detail)) msg = detail.map((d: { msg?: string }) => d.msg || d).join(', ')
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

type MePayload = {
  user: AuthUser
  organization: AuthOrg | null
  permissions: string[]
  bootstrap_required: boolean
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [organization, setOrganization] = useState<AuthOrg | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [accessToken, setAccessToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEYS.access))
  const [refreshToken, setRefreshToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEYS.refresh))
  const [bootstrapRequired, setBootstrapRequired] = useState(false)
  const [loading, setLoading] = useState(true)

  const persistTokens = useCallback((access: string, refresh: string) => {
    localStorage.setItem(STORAGE_KEYS.access, access)
    localStorage.setItem(STORAGE_KEYS.refresh, refresh)
    setAccessToken(access)
    setRefreshToken(refresh)
  }, [])

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.access)
    localStorage.removeItem(STORAGE_KEYS.refresh)
    localStorage.removeItem('dt_org_id')
    setAccessToken(null)
    setRefreshToken(null)
    setUser(null)
    setOrganization(null)
    setPermissions([])
  }, [])

  const applyMe = useCallback((me: MePayload) => {
    setUser(me.user)
    setOrganization(me.organization)
    setPermissions(me.permissions)
    setBootstrapRequired(me.bootstrap_required)
  }, [])

  const refreshMe = useCallback(async () => {
    if (!accessToken) {
      const status = await rawRequest<{ bootstrap_required: boolean }>('/auth/status')
      setBootstrapRequired(status.bootstrap_required)
      setLoading(false)
      return
    }
    try {
      const me = await rawRequest<MePayload>('/auth/me', { token: accessToken })
      applyMe(me)
    } catch {
      if (refreshToken) {
        try {
          const tokens = await rawRequest<{ access_token: string; refresh_token: string }>('/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: refreshToken }),
          })
          persistTokens(tokens.access_token, tokens.refresh_token)
          const me = await rawRequest<MePayload>('/auth/me', { token: tokens.access_token })
          applyMe(me)
        } catch {
          clearSession()
        }
      } else {
        clearSession()
      }
    } finally {
      setLoading(false)
    }
  }, [accessToken, applyMe, clearSession, persistTokens, refreshToken])

  useEffect(() => {
    refreshMe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await rawRequest<{ access_token: string; refresh_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    persistTokens(tokens.access_token, tokens.refresh_token)
    const me = await rawRequest<MePayload>('/auth/me', { token: tokens.access_token })
    applyMe(me)
  }, [applyMe, persistTokens])

  const register = useCallback(async (data: { email: string; password: string; name: string; organization_name: string }) => {
    const tokens = await rawRequest<{ access_token: string; refresh_token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    persistTokens(tokens.access_token, tokens.refresh_token)
    const me = await rawRequest<MePayload>('/auth/me', { token: tokens.access_token })
    applyMe(me)
  }, [applyMe, persistTokens])

  const logout = useCallback(async () => {
    if (refreshToken) {
      try {
        await rawRequest('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refreshToken }),
          token: accessToken,
        })
      } catch { /* ignore */ }
    }
    clearSession()
  }, [accessToken, clearSession, refreshToken])

  const acceptInvite = useCallback(async (token: string, name: string, password: string) => {
    const tokens = await rawRequest<{ access_token: string; refresh_token: string }>('/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token, name, password }),
    })
    persistTokens(tokens.access_token, tokens.refresh_token)
    const me = await rawRequest<MePayload>('/auth/me', { token: tokens.access_token })
    applyMe(me)
  }, [applyMe, persistTokens])

  const completeSsoLogin = useCallback(async (access: string, refresh: string) => {
    persistTokens(access, refresh)
    const me = await rawRequest<MePayload>('/auth/me', { token: access })
    applyMe(me)
  }, [applyMe, persistTokens])

  const hasPermission = useCallback((...codes: string[]) => codes.every((c) => permissions.includes(c)), [permissions])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    organization,
    permissions,
    accessToken,
    bootstrapRequired,
    loading,
    hasPermission,
    login,
    register,
    logout,
    acceptInvite,
    completeSsoLogin,
    refreshMe,
  }), [
    user, organization, permissions, accessToken, bootstrapRequired, loading,
    hasPermission, login, register, logout, acceptInvite, completeSsoLogin, refreshMe,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = localStorage.getItem(STORAGE_KEYS.access)
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function refreshAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem(STORAGE_KEYS.refresh)
  if (!refresh) return null
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    })
    if (!res.ok) return null
    const data = await res.json()
    localStorage.setItem(STORAGE_KEYS.access, data.access_token)
    localStorage.setItem(STORAGE_KEYS.refresh, data.refresh_token)
    return data.access_token as string
  } catch {
    return null
  }
}
