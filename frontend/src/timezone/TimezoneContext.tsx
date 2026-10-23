import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'
import { getSystemTimeZone, setSystemTimeZone } from '../utils/datetime'

interface TimezoneContextValue {
  timeZone: string
  refreshTimeZone: () => Promise<void>
}

const TimezoneContext = createContext<TimezoneContextValue>({
  timeZone: getSystemTimeZone(),
  refreshTimeZone: async () => {},
})

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [timeZone, setTimeZone] = useState(getSystemTimeZone())

  const refreshTimeZone = useCallback(async () => {
    try {
      const { timezone } = await api.settings.timezone()
      setSystemTimeZone(timezone)
      setTimeZone(getSystemTimeZone())
    } catch {
      // Keep the previous zone if the setting cannot be loaded.
    }
  }, [])

  useEffect(() => {
    if (user) void refreshTimeZone()
  }, [user, refreshTimeZone])

  const value = useMemo(() => ({ timeZone, refreshTimeZone }), [timeZone, refreshTimeZone])

  // Date formatters read module state, so remount the tree when the zone changes.
  return (
    <TimezoneContext.Provider value={value}>
      <Fragment key={timeZone}>{children}</Fragment>
    </TimezoneContext.Provider>
  )
}

export function useTimeZone() {
  return useContext(TimezoneContext)
}
