import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, OrgRole } from '../api'
import { useAuth } from '../auth/AuthContext'

export default function RolesPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const [roles, setRoles] = useState<OrgRole[]>([])
  const [permissions, setPermissions] = useState<{ code: string; description: string }[]>([])
  const [selected, setSelected] = useState<OrgRole | null>(null)
  const [name, setName] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const canWriteRoles = hasPermission('roles:write')
  const canManageSso = hasPermission('sso:manage')

  async function load() {
    const [r, p] = await Promise.all([api.roles.list(), api.roles.permissions()])
    setRoles(r)
    setPermissions(p)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  function editRole(role: OrgRole) {
    setSelected(role)
    setName(role.name)
    setCodes([...role.permission_codes])
  }

  async function saveRole(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (selected) {
        await api.roles.update(selected.id, { name, permission_codes: codes })
      } else {
        await api.roles.create({ name, permission_codes: codes })
      }
      setSelected(null)
      setName('')
      setCodes([])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('roles.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('roles.subtitle')}</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg text-foreground">{t('roles.rolesTitle')}</h2>
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => editRole(r)}
              className="w-full text-left border border-border rounded-xl px-4 py-3 hover:bg-surface"
            >
              <div className="text-foreground font-medium">{r.name} {r.is_system && <span className="text-xs text-muted-foreground">{t('roles.systemBadge')}</span>}</div>
              <div className="text-xs text-muted-foreground mt-1">{t('roles.permissionsCount', { count: r.permission_codes.length })}</div>
            </button>
          ))}
        </section>

        {canWriteRoles && (
          <form onSubmit={saveRole} className="border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-lg text-foreground">{selected ? t('roles.editRole', { name: selected.name }) : t('roles.newRole')}</h2>
            <input
              className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-foreground"
              placeholder={t('roles.roleNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={!!selected?.is_system}
            />
            <div className="max-h-64 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
              {permissions.map((p) => (
                <label key={p.code} className="flex items-start gap-2 text-xs text-muted-foreground px-1 py-1">
                  <input
                    type="checkbox"
                    checked={codes.includes(p.code)}
                    onChange={(e) => {
                      setCodes((prev) => e.target.checked ? [...prev, p.code] : prev.filter((c) => c !== p.code))
                    }}
                  />
                  <span><span className="text-foreground">{p.code}</span> — {p.description}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm">{t('roles.save')}</button>
              {selected && !selected.is_system && (
                <button
                  type="button"
                  className="rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 px-4 py-2 text-sm"
                  onClick={async () => {
                    await api.roles.delete(selected.id)
                    setSelected(null)
                    await load()
                  }}
                >
                  {t('roles.delete')}
                </button>
              )}
              {selected && (
                <button type="button" className="text-sm text-muted-foreground" onClick={() => { setSelected(null); setName(''); setCodes([]) }}>
                  {t('roles.clear')}
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {canManageSso && (
        <p className="text-sm text-muted-foreground">
          {t('roles.ssoMoved')}{' '}
          <Link to="/settings?tab=security" className="text-brand-700 dark:text-brand-400 underline-offset-2 hover:underline">
            {t('roles.ssoMovedLink')}
          </Link>
        </p>
      )}
    </div>
  )
}
