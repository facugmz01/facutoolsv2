export interface ExternalTool {
  id: string
  nameKey: string
  descriptionKey: string
  url: (domain: string) => string
}

export const EXTERNAL_TOOLS: ExternalTool[] = [
  {
    id: 'sslLabs',
    nameKey: 'asset.externalToolsList.sslLabs.name',
    descriptionKey: 'asset.externalToolsList.sslLabs.description',
    url: d => `https://www.ssllabs.com/ssltest/analyze.html?d=${d}`,
  },
  {
    id: 'virusTotal',
    nameKey: 'asset.externalToolsList.virusTotal.name',
    descriptionKey: 'asset.externalToolsList.virusTotal.description',
    url: d => `https://www.virustotal.com/gui/domain/${d}`,
  },
  {
    id: 'urlScan',
    nameKey: 'asset.externalToolsList.urlScan.name',
    descriptionKey: 'asset.externalToolsList.urlScan.description',
    url: d => `https://urlscan.io/search/#${d}`,
  },
  {
    id: 'shodan',
    nameKey: 'asset.externalToolsList.shodan.name',
    descriptionKey: 'asset.externalToolsList.shodan.description',
    url: d => `https://www.shodan.io/search?query=${d}`,
  },
  {
    id: 'pageSpeed',
    nameKey: 'asset.externalToolsList.pageSpeed.name',
    descriptionKey: 'asset.externalToolsList.pageSpeed.description',
    url: d => `https://pagespeed.web.dev/analysis?url=https://${d}`,
  },
  {
    id: 'webCheck',
    nameKey: 'asset.externalToolsList.webCheck.name',
    descriptionKey: 'asset.externalToolsList.webCheck.description',
    url: d => `https://web-check.xyz/check/${d}`,
  },
  {
    id: 'dnsChecker',
    nameKey: 'asset.externalToolsList.dnsChecker.name',
    descriptionKey: 'asset.externalToolsList.dnsChecker.description',
    url: d => `https://dnschecker.org/#A/${d}`,
  },
  {
    id: 'blacklistChecker',
    nameKey: 'asset.externalToolsList.blacklistChecker.name',
    descriptionKey: 'asset.externalToolsList.blacklistChecker.description',
    url: d => `https://mxtoolbox.com/SuperTool.aspx?action=blacklist%3a${d}`,
  },
  {
    id: 'dnsPropagation',
    nameKey: 'asset.externalToolsList.dnsPropagation.name',
    descriptionKey: 'asset.externalToolsList.dnsPropagation.description',
    url: d => `https://dnschecker.org/#A/${d}`,
  },
  {
    id: 'dnsLookup',
    nameKey: 'asset.externalToolsList.dnsLookup.name',
    descriptionKey: 'asset.externalToolsList.dnsLookup.description',
    url: d => `https://mxtoolbox.com/SuperTool.aspx?action=dns%3a${d}`,
  },
  {
    id: 'whoisLookup',
    nameKey: 'asset.externalToolsList.whoisLookup.name',
    descriptionKey: 'asset.externalToolsList.whoisLookup.description',
    url: d => `https://who.is/whois/${d}`,
  },
  {
    id: 'certTransparency',
    nameKey: 'asset.externalToolsList.certTransparency.name',
    descriptionKey: 'asset.externalToolsList.certTransparency.description',
    url: d => `https://crt.sh/?q=${d}`,
  },
  {
    id: 'dmarcLookup',
    nameKey: 'asset.externalToolsList.dmarcLookup.name',
    descriptionKey: 'asset.externalToolsList.dmarcLookup.description',
    url: d => `https://mxtoolbox.com/SuperTool.aspx?action=dmarc%3a${d}`,
  },
]
