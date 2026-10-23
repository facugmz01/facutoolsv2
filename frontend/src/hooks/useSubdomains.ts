import { useCallback, useState } from 'react'
import { api } from '../api'
import i18n from '../i18n'
import { useAsyncData } from './useAsyncData'

export function useSubdomains(domainId: number | undefined) {
  return useAsyncData(
    () => api.subdomains.list(domainId!),
    [domainId],
    { enabled: domainId != null && !Number.isNaN(domainId) },
  )
}

export function useSubdomain(id: number | undefined) {
  return useAsyncData(
    () => api.subdomains.get(id!),
    [id],
    { enabled: id != null && !Number.isNaN(id) },
  )
}

interface UseSubdomainMutationsOptions {
  onSuccess?: () => void
}

export function useSubdomainMutations(options: UseSubdomainMutationsOptions = {}) {
  const { onSuccess } = options
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    (domainId: number, data: { hostname: string; ssl_monitor?: boolean; ssl_auto_renew?: boolean; notes?: string }) =>
      run(() => api.subdomains.create(domainId, data)),
    [run],
  )

  const discover = useCallback(
    (domainId: number) => run(() => api.subdomains.discover(domainId)),
    [run],
  )

  const remove = useCallback(
    (id: number) => run(() => api.subdomains.delete(id)),
    [run],
  )

  const scan = useCallback(async (id: number) => {
    setMutating(true)
    setError(null)
    try {
      const result = await api.subdomains.scan(id)
      onSuccess?.()
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : i18n.t('errors.generic'))
      return null
    } finally {
      setMutating(false)
    }
  }, [onSuccess])

  return { mutating, error, create, discover, remove, scan }
}
