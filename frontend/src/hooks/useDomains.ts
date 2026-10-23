import { useCallback, useState } from 'react'
import { api, type Domain } from '../api'
import i18n from '../i18n'
import { useAsyncData } from './useAsyncData'

export function useDomains() {
  return useAsyncData(() => api.domains.list())
}

export function useDomain(id: number | undefined) {
  return useAsyncData(
    () => api.domains.get(id!),
    [id],
    { enabled: id != null && !Number.isNaN(id) },
  )
}

export function useDashboardStats() {
  return useAsyncData(() => api.domains.stats())
}

export function filterDomains(domains: Domain[], search: string): Domain[] {
  const q = search.toLowerCase().trim()
  if (!q) return domains
  return domains.filter(d =>
    d.name.toLowerCase().includes(q) ||
    d.registrar?.toLowerCase().includes(q) ||
    d.tags.some(t => t.toLowerCase().includes(q)),
  )
}

interface UseDomainMutationsOptions {
  onSuccess?: () => void
}

export function useDomainMutations(options: UseDomainMutationsOptions = {}) {
  const { onSuccess } = options
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanningId, setScanningId] = useState<number | null>(null)

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setMutating(true)
    setError(null)
    try {
      const result = await fn()
      onSuccess?.()
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : i18n.t('errors.generic'))
      return null
    } finally {
      setMutating(false)
    }
  }, [onSuccess])

  const create = useCallback(
    (data: Partial<Domain>) => run(() => api.domains.create(data)),
    [run],
  )

  const remove = useCallback(
    (id: number) => run(() => api.domains.delete(id)),
    [run],
  )

  const scan = useCallback(async (id: number) => {
    setScanningId(id)
    setError(null)
    try {
      const result = await api.domains.scan(id)
      onSuccess?.()
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : i18n.t('errors.generic'))
      return null
    } finally {
      setScanningId(null)
    }
  }, [onSuccess])

  const bulkImport = useCallback(
    (domains: Partial<Domain>[]) => run(() => api.domains.bulkImport(domains)),
    [run],
  )

  return { mutating, scanningId, error, create, remove, scan, bulkImport }
}
