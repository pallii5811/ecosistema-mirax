'use client'

import { Search, List, Plug, CreditCard, LogOut, Folder, User, Kanban, Brain, Send, Target, Layers, MailCheck, Network } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/utils/supabase/client'
import MiraxLogo from '@/components/MiraxLogo'
import { useDashboard, PLAN_CREDITS, PLAN_LABELS } from '@/components/DashboardContext'
import { SHOW_CENTRO_COMANDO, SHOW_UNIVERSE_UI } from '@/lib/feature-flags'

type SidebarProps = {
  credits: number
  variant?: 'desktop' | 'mobile'
  open?: boolean
  onClose?: () => void
  onNavigate?: () => void
}

const Sidebar = ({ credits, variant = 'desktop', open = false, onClose, onNavigate }: SidebarProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const { planType } = useDashboard()
  const planCredits = PLAN_CREDITS[planType] || 100
  const planLabel = PLAN_LABELS[planType] || 'Free'
  const creditsPercentage = Math.max(0, Math.min(100, (credits / planCredits) * 100))
  const onLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const menuItems = [
    { icon: Search, label: 'Ricerca', href: '/dashboard', tooltip: 'Cerca nuovi lead per categoria e città — il motore principale di Mirax' },
    { icon: List, label: 'Le mie Liste', href: '/dashboard/leads', tooltip: 'Tutte le liste di lead salvate dalle tue ricerche' },
    { icon: Folder, label: 'Ambiente', href: '/dashboard/environments', tooltip: 'Organizza i lead in ambienti separati per progetto o cliente' },
    { icon: Target, label: 'Centro Outreach', href: '/dashboard/outreach', tooltip: 'Contatta i tuoi lead in serie sul canale giusto, con messaggi AI e tracciamento' },
    { icon: Kanban, label: 'Pipeline', href: '/dashboard/pipeline', tooltip: 'Gestisci il funnel commerciale: da lead freddo a cliente acquisito' },
    { icon: Brain, label: 'Smart Insights', href: '/dashboard/insights', tooltip: 'Analisi AI del tuo processo di vendita: forecast, azioni urgenti e coach personale' },
    ...(SHOW_UNIVERSE_UI
      ? [{ icon: Network, label: 'Knowledge Graph', href: '/dashboard/universe', tooltip: 'Grafo commerciale MIRAX: ricerca AI in linguaggio naturale, entità, relazioni ed eventi' }]
      : []),
    ...(SHOW_CENTRO_COMANDO
      ? [{ icon: Layers, label: 'Centro Comando', href: '/dashboard/ecosistema', tooltip: 'Multi-Agent, NOUS/CRM, EDAT, intelligence e API enterprise' }]
      : []),
    { icon: Send, label: 'Sequenze Email', href: '/dashboard/sequences', tooltip: 'Crea e gestisci sequenze email automatiche per i tuoi lead' },
    { icon: MailCheck, label: 'Deliverability', href: '/dashboard/deliverability', tooltip: 'Verifica SPF/DKIM/DMARC e guida configurazione email' },
    { icon: Plug, label: 'Integrazioni', href: '/dashboard/integrations', tooltip: 'Collega CRM, email e altri strumenti esterni' },
    { icon: CreditCard, label: 'Billing', href: '/dashboard/billing', tooltip: 'Gestisci abbonamento, crediti e fatturazione' },
    { icon: User, label: 'Profilo', href: '/dashboard/profile', tooltip: 'Impostazioni del tuo account e dati personali' },
  ]

  const handleNavigate = (href: string) => {
    router.push(href)
    onNavigate?.()
  }

  const content = (
    <div className="w-64 bg-white border-r border-slate-200 h-screen flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-100 flex justify-center">
        <button type="button" onClick={() => handleNavigate('/dashboard')} className="flex items-center justify-center">
          <MiraxLogo size={220} variant="dark" showWordmark={true} showTagline={true} />
        </button>
      </div>

      {/* Menu */}
      <nav className="flex-1 px-2.5 py-1.5 overflow-y-auto scrollbar-thin">
        <ul className="space-y-px">
          {menuItems.map((item, index) => {
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname.startsWith(`${item.href}/`)

            return (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => handleNavigate(item.href)}
                  title={item.tooltip}
                  className={`w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md transition-colors duration-150 text-[13.5px] ${isActive
                    ? 'bg-slate-100 text-slate-950 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
                    }`}
                >
                  <item.icon
                    strokeWidth={1.75}
                    className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-slate-900' : 'text-slate-400'
                      }`}
                  />
                  <span>{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Credits Progress */}
      <div className="px-2.5 py-2 border-t border-slate-100">
        <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-700">Crediti</span>
              <Badge variant="secondary" className="bg-white text-slate-600 border-slate-200 text-[10px] px-1.5 py-0">
                {planLabel}
              </Badge>
            </div>
            <span className="text-[12px] font-semibold text-slate-800 tabular-nums">{credits.toLocaleString('it-IT')}<span className="text-slate-400 font-normal"> / {planCredits.toLocaleString('it-IT')}</span></span>
          </div>
          <Progress value={creditsPercentage} className="h-1.5 bg-slate-200 mb-2" />
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              onClick={() => handleNavigate('/dashboard/billing')}
              size="sm"
              className="flex-1 bg-primary hover:bg-primary/90 text-white font-medium text-[12px] py-1.5 shadow-sm h-auto rounded-md"
            >
              Upgrade
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-slate-400 hover:text-rose-600 hover:bg-rose-50/60 px-2 py-1.5 h-auto"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  if (variant === 'mobile') {
    return (
      <>
        <div
          className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity md:hidden ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          onClick={onClose}
        />
        <div
          className={`fixed top-0 left-0 z-50 h-screen md:hidden transform transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'
            }`}
        >
          {content}
        </div>
      </>
    )
  }

  return <div className="hidden md:block">{content}</div>
}

export default Sidebar
