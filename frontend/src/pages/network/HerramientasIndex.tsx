import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MapPin, Globe, FileSearch, Radio, Wifi, Key, Calculator, Mail, Shield, Radar,
} from 'lucide-react'
import { domainTools } from '../Tools'

const tools = [
  { to: '/herramientas/ip-lookup', key: 'ipLookup', icon: MapPin, group: 'network' },
  { to: '/herramientas/dns', key: 'dns', icon: Globe, group: 'domains' },
  { to: '/herramientas/whois', key: 'whois', icon: FileSearch, group: 'domains' },
  { to: '/herramientas/propagacion', key: 'propagation', icon: Radio, group: 'domains' },
  { to: '/herramientas/mac', key: 'mac', icon: Wifi, group: 'network' },
  { to: '/herramientas/contrasenas', key: 'passwords', icon: Key, group: 'security' },
  { to: '/herramientas/ip-calc', key: 'ipCalc', icon: Calculator, group: 'network' },
  { to: '/herramientas/smtp', key: 'smtp', icon: Mail, group: 'email' },
  { to: '/herramientas/ssl-convert', key: 'sslConvert', icon: Shield, group: 'security' },
  { to: '/herramientas/puertos', key: 'portCheck', icon: Radar, group: 'network' },
]

export default function HerramientasIndex() {
  const { t } = useTranslation()
  const catalog = [
    ...tools.map(tool => ({ ...tool, label: t(`network.index.tools.${tool.key}.label`), description: t(`network.index.tools.${tool.key}.desc`) })),
    ...domainTools.map(tool => ({ ...tool, to: `/herramientas/${tool.id}`, label: t(`tools.items.${tool.id}.label`), description: t(`tools.items.${tool.id}.desc`) })),
  ]
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('publicTools.catalogTitle')}</h2>
      </div>
      {['domains', 'network', 'security', 'email'].map(group => (
        <section key={group} aria-labelledby={`tools-${group}`} className="space-y-3">
          <h3 id={`tools-${group}`} className="text-lg font-semibold">{t(`publicTools.groups.${group}`)}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.filter(tool => tool.group === group).map(tool => (
              <Link
                key={tool.to}
                to={tool.to}
                className="card hover:border-brand-500 transition-colors group"
              >
                <tool.icon size={22} className="text-brand-700 dark:text-brand-400 group-hover:text-brand-600" />
                <p className="font-semibold mt-3">{tool.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
