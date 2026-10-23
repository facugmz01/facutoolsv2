import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Eye } from 'lucide-react'
import { api } from '../api'
import { formatDate } from '../utils/datetime'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'

interface WatchlistItem {
  id: number
  domain_name: string
  target_price: number | null
  notes: string | null
  is_available: boolean | null
  created_at: string
}

export default function Watchlist() {
  const { t } = useTranslation()
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ domain_name: '', target_price: '', notes: '' })

  const load = () => api.watchlist.list().then((data) => setItems(data as WatchlistItem[])).catch(console.error)
  useEffect(() => { load() }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.watchlist.add({
      domain_name: form.domain_name,
      target_price: form.target_price ? parseFloat(form.target_price) : undefined,
      notes: form.notes || undefined,
    })
    setShowAdd(false)
    setForm({ domain_name: '', target_price: '', notes: '' })
    load()
  }

  const handleRemove = async (id: number) => {
    await api.watchlist.remove(id)
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">{t('watchlist.title')}</h2>
          <p className="text-muted-foreground mt-1">{t('watchlist.subtitle')}</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="shrink-0">
          <Plus size={16} /> {t('watchlist.addButton')}
        </Button>
      </div>

      {showAdd && (
        <Card>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input placeholder={t('watchlist.form.domainPlaceholder')} value={form.domain_name} onChange={e => setForm({ ...form, domain_name: e.target.value })} required />
              <Input placeholder={t('watchlist.form.targetPricePlaceholder')} type="number" value={form.target_price} onChange={e => setForm({ ...form, target_price: e.target.value })} />
              <Input placeholder={t('watchlist.form.notesPlaceholder')} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button type="submit">{t('watchlist.form.add')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>{t('watchlist.form.cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <Card className="text-center py-14">
          <Eye size={40} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-foreground font-medium">{t('watchlist.empty')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('watchlist.emptyHint', { defaultValue: 'Track domains you may want to buy later.' })}</p>
          <Button className="mt-5" onClick={() => setShowAdd(true)}>
            <Plus size={16} /> {t('watchlist.addButton')}
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-border text-left text-sm text-muted-foreground bg-muted/40">
                  <th className="p-4 font-medium">{t('watchlist.columns.domain')}</th>
                  <th className="p-4 font-medium">{t('watchlist.columns.targetPrice')}</th>
                  <th className="p-4 font-medium">{t('watchlist.columns.notes')}</th>
                  <th className="p-4 font-medium">{t('watchlist.columns.added')}</th>
                  <th className="p-4 font-medium">{t('watchlist.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-border/60 hover:bg-surface-hover/80">
                    <td className="p-4 font-medium">{item.domain_name}</td>
                    <td className="p-4 text-muted-foreground">{item.target_price ? `$${item.target_price}` : '—'}</td>
                    <td className="p-4 text-muted-foreground">{item.notes || '—'}</td>
                    <td className="p-4 text-muted-foreground text-sm">{formatDate(item.created_at)}</td>
                    <td className="p-4">
                      <Button variant="ghost" size="icon" onClick={() => handleRemove(item.id)} className="hover:text-red-600">
                        <Trash2 size={16} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
