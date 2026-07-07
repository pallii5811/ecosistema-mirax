'use client'

import { Bell, Menu } from 'lucide-react'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/utils/supabase/client'
import { LocaleToggle } from '@/components/LocaleToggle'
import { useDashboard } from '@/components/DashboardContext'

type TopHeaderProps = {
  email: string
  onMenuClick?: () => void
}

type LeadAlert = {
  id: string
  user_id?: string
  monitor_id?: string
  lead_name?: string
  alert_type?: string
  message?: string
  is_read?: boolean
  created_at?: string
}

const TopHeader = ({ email, onMenuClick }: TopHeaderProps) => {
  const router = useRouter()
  const { uiMode, setUiMode, locale, setLocale } = useDashboard()
  const [showWelcome, setShowWelcome] = useState(true)
  const [fadeWelcome, setFadeWelcome] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [alertsLoading, setAlertsLoading] = useState(false)
  const [alertsError, setAlertsError] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<LeadAlert[]>([])

  const unreadCount = useMemo(() => alerts.length, [alerts.length])
  const handle = email.includes('@') ? email.split('@')[0] : email
  const initials = handle
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  const onLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const fetchAlerts = async () => {
    try {
      setAlertsLoading(true)
      setAlertsError(null)
      const res = await fetch('/api/alerts')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as any
      const list: LeadAlert[] = Array.isArray(data?.alerts)
        ? data.alerts
            .filter((x: any) => x && typeof x === 'object')
            .map((x: any) => ({
              id: String(x.id),
              user_id: typeof x.user_id === 'string' ? x.user_id : undefined,
              monitor_id: typeof x.monitor_id === 'string' ? x.monitor_id : undefined,
              lead_name: typeof x.lead_name === 'string' ? x.lead_name : undefined,
              alert_type: typeof x.alert_type === 'string' ? x.alert_type : undefined,
              message: typeof x.message === 'string' ? x.message : undefined,
              is_read: typeof x.is_read === 'boolean' ? x.is_read : undefined,
              created_at: typeof x.created_at === 'string' ? x.created_at : undefined,
            }))
        : []
      setAlerts(list)
    } catch (e) {
      setAlertsError(e instanceof Error ? e.message : 'Errore')
    } finally {
      setAlertsLoading(false)
    }
  }

  const markAlertRead = async (alertId: string) => {
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      })
    } catch {
      // ignore
    } finally {
      setAlerts((prev) => prev.filter((a) => a.id !== alertId))
    }
  }

  useEffect(() => {
    fetchAlerts()
    const id = window.setInterval(() => {
      fetchAlerts()
    }, 45000)

    return () => {
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeWelcome(true), 4000)
    const hideTimer = setTimeout(() => setShowWelcome(false), 5000)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [])

  return (
    <div className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-4 md:px-8 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onMenuClick}
          className="md:hidden p-2"
          aria-label="Apri menu"
        >
          <Menu className="w-5 h-5 text-gray-700" />
        </Button>

        {/* Welcome Message */}
        {showWelcome && (
          <div className={`min-w-0 transition-opacity duration-1000 ${fadeWelcome ? 'opacity-0' : 'opacity-100'}`}>
            <h2 className="text-lg md:text-2xl font-bold text-gray-900 truncate">Welcome back, {handle}</h2>
            <p className="hidden md:block text-sm text-gray-500 mt-1">Troviamo nuovi clienti per la tua attività oggi</p>
          </div>
        )}
      </div>

      {/* Right Side */}
      <div className="flex items-center space-x-2 md:space-x-4">
        <LocaleToggle locale={locale} onChange={setLocale} compact className="hidden md:inline-flex" />

        {/* Notifications */}
        <Button
          variant="ghost"
          size="sm"
          className="relative p-2 hover:bg-gray-50"
          type="button"
          onClick={() => setAlertsOpen(true)}
          aria-label="Apri notifiche"
        >
          <Bell className="w-5 h-5 text-gray-600" />
          {unreadCount > 0 ? (
            <Badge className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full p-0 flex items-center justify-center">
              {Math.min(99, unreadCount)}
            </Badge>
          ) : null}
        </Button>

        {/* User Avatar */}
        <div className="flex items-center space-x-3 pl-3 md:pl-4 border-l border-gray-200">
          <div className="hidden md:block text-right">
            <p className="text-[14px] font-semibold text-gray-900">{email}</p>
            <p className="text-[12px] text-gray-500">Account Pro</p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="p-2 hover:bg-rose-50 text-gray-600 hover:text-rose-700"
          >
            <LogOut className="w-4 h-4" />
          </Button>

          <Avatar className="w-10 h-10">
            <AvatarImage src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80" />
            <AvatarFallback className="bg-gradient-to-br from-violet-500 to-blue-500 text-white font-semibold">
              {initials || 'U'}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      {alertsOpen ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setAlertsOpen(false)} />
          <div className="fixed top-0 right-0 z-50 h-screen w-full max-w-md bg-white border-l border-gray-100 shadow-xl">
            <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100">
              <div className="font-semibold text-gray-900">Notifiche</div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={fetchAlerts} disabled={alertsLoading}>
                  Aggiorna
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAlertsOpen(false)}>
                  Chiudi
                </Button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto h-[calc(100vh-4rem)]">
              {alertsError ? <div className="text-sm text-rose-700">Errore: {alertsError}</div> : null}

              {alertsLoading ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-slate-100 rounded" />
                  <div className="h-4 bg-slate-100 rounded w-5/6" />
                  <div className="h-4 bg-slate-100 rounded w-4/6" />
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-sm text-gray-600">Nessun alert non letto.</div>
              ) : (
                <div className="space-y-3">
                  {alerts.map((a) => (
                    <div key={a.id} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{a.lead_name || 'Lead'}</div>
                          <div className="text-xs text-gray-500">{a.alert_type || 'alert'}</div>
                        </div>
                        <Button type="button" size="sm" variant="secondary" onClick={() => markAlertRead(a.id)}>
                          Letto
                        </Button>
                      </div>
                      {a.message ? <div className="mt-2 text-sm text-gray-700 break-words">{a.message}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default TopHeader
