export const NOTIFICATION_TYPES = [
  {
    id: 'expiring_soon',
    labelKey: 'notifications.types.expiringSoon.label',
    descriptionKey: 'notifications.types.expiringSoon.description',
  },
  {
    id: 'ip_change',
    labelKey: 'notifications.types.ipChange.label',
    descriptionKey: 'notifications.types.ipChange.description',
    warningKey: 'notifications.types.ipChange.warning',
  },
  {
    id: 'registrar',
    labelKey: 'notifications.types.registrar.label',
    descriptionKey: 'notifications.types.registrar.description',
  },
  {
    id: 'whois_change',
    labelKey: 'notifications.types.whoisChange.label',
    descriptionKey: 'notifications.types.whoisChange.description',
  },
  {
    id: 'dns_change',
    labelKey: 'notifications.types.dnsChange.label',
    descriptionKey: 'notifications.types.dnsChange.description',
  },
  {
    id: 'ssl_expiry',
    labelKey: 'notifications.types.sslExpiry.label',
    descriptionKey: 'notifications.types.sslExpiry.description',
    warningKey: 'notifications.types.sslExpiry.warning',
  },
  {
    id: 'ssl_change',
    labelKey: 'notifications.types.sslChange.label',
    descriptionKey: 'notifications.types.sslChange.description',
    warningKey: 'notifications.types.sslChange.warning',
  },
  {
    id: 'host_change',
    labelKey: 'notifications.types.hostChange.label',
    descriptionKey: 'notifications.types.hostChange.description',
  },
  {
    id: 'security_change',
    labelKey: 'notifications.types.securityChange.label',
    descriptionKey: 'notifications.types.securityChange.description',
  },
] as const

export type NotificationType = typeof NOTIFICATION_TYPES[number]['id']

export const DEFAULT_NOTIFICATIONS: Record<NotificationType, boolean> = {
  expiring_soon: true,
  ip_change: false,
  registrar: false,
  whois_change: false,
  dns_change: false,
  ssl_expiry: false,
  ssl_change: false,
  host_change: false,
  security_change: false,
}

export function enabledNotificationLabels(
  preferences: Record<string, boolean>,
  t: (key: string) => string,
): string[] {
  return NOTIFICATION_TYPES
    .filter(n => preferences[n.id])
    .map(n => t(n.labelKey))
}
