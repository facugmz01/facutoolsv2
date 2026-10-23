import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import i18n from '../i18n'

interface UseAsyncDataOptions {
  enabled?: boolean
}

export interface UseAsyncDataResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  setData: Dispatch<SetStateAction<T | null>>
}

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: UseAsyncDataOptions = {},
): UseAsyncDataResult<T> {
  const { enabled = true } = options
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : i18n.t('errors.generic'))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, error, reload, setData }
}
