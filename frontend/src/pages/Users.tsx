import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, OrgInvite, OrgMember, OrgRole } from '../api'
import { useAuth } from '../auth/AuthContext'

export default function UsersPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [roles, setRoles] = useState<OrgRole[]>([])
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState<number | ''>('')
  const [lastToken, setLastToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const canWrite = hasPermission('users:write')

  async function load() {
    const [m, i, r] = await Promise.all([
      api.orgs.members(),
      api.orgs.invitations(),
      api.roles.list(),
    ])
    setMembers(m)
    setInvites(i)
    setRoles(r)
    if (!roleId && r.length) setRoleId(r.find((x) => x.name === 'Viewer')?.id ?? r[0].id)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function invite(e: FormEvent) {
    e.preventDefault()
    if (!roleId) return
    setError('')
    try {
      const inv = await api.orgs.invite(email, Number(roleId))
      setLastToken(inv.invite_token || null)
      setEmail('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.inviteFailed'))
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('users.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('users.subtitle')}</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canWrite && (
        <form onSubmit={invite} className="flex flex-wrap gap-3 items-end bg-surface border border-border rounded-xl p-4">
          <label className="text-sm text-muted-foreground">
            {t('users.inviteForm.emailLabel')}
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="block mt-1 rounded-lg bg-surface border border-border px-3 py-2 text-foreground" />
          </label>
          <label className="text-sm text-muted-foreground">
            {t('users.inviteForm.roleLabel')}
            <select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} className="block mt-1 rounded-lg bg-surface border border-border px-3 py-2 text-foreground">
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 text-sm">{t('users.inviteForm.submit')}</button>
        </form>
      )}

      {lastToken && (
        <div className="text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 rounded-xl p-4">
          {t('users.tokenBanner.title')} <code className="break-all">{lastToken}</code>
          <div className="mt-1 text-amber-700/80">{t('users.tokenBanner.linkLabel', { token: lastToken })}</div>
        </div>
      )}

      <section>
        <h2 className="text-lg text-foreground mb-3">{t('users.membersTitle')}</h2>
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3">{t('users.columns.name')}</th>
                <th className="px-4 py-3">{t('users.columns.email')}</th>
                <th className="px-4 py-3">{t('users.columns.role')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border text-foreground-secondary">
                  <td className="px-4 py-3">{m.name}</td>
                  <td className="px-4 py-3">{m.email}</td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <select
                        value={m.role_id}
                        className="bg-surface border border-border rounded px-2 py-1"
                        onChange={async (e) => {
                          await api.orgs.updateMember(m.id, Number(e.target.value))
                          await load()
                        }}
                      >
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    ) : m.role_name}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && (
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-700 dark:text-red-400 text-xs"
                        onClick={async () => {
                          await api.orgs.removeMember(m.id)
                          await load()
                        }}
                      >
                        {t('users.remove')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg text-foreground mb-3">{t('users.pendingInvitationsTitle')}</h2>
        <ul className="space-y-2">
          {invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between border border-border rounded-lg px-4 py-3 text-sm text-foreground-secondary">
              <span>{i.email} · {i.role_name}</span>
              {canWrite && (
                <button type="button" className="text-red-600 text-xs" onClick={async () => { await api.orgs.revokeInvite(i.id); await load() }}>
                  {t('users.revoke')}
                </button>
              )}
            </li>
          ))}
          {!invites.length && <li className="text-sm text-muted-foreground">{t('users.noPendingInvitations')}</li>}
        </ul>
      </section>
    </div>
  )
}
