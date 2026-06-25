'use client'

import {
  Search,
  List,
  Folder,
  Target,
  Kanban,
  Brain,
  Send,
  Flame,
  Plug,
  CreditCard,
  User,
  LogOut,
  type LucideIcon,
} from 'lucide-react'

export const HERO_SIDEBAR_ITEMS: { icon: LucideIcon; label: string; active?: boolean }[] = [
  { icon: Search, label: 'Ricerca', active: true },
  { icon: List, label: 'Le mie Liste' },
  { icon: Folder, label: 'Ambiente' },
  { icon: Target, label: 'Centro Outreach' },
  { icon: Kanban, label: 'Pipeline' },
  { icon: Brain, label: 'Smart Insights' },
  { icon: Send, label: 'Sequenze Email' },
  { icon: Flame, label: 'Lead Hotlist' },
  { icon: Plug, label: 'Integrazioni' },
  { icon: CreditCard, label: 'Billing' },
  { icon: User, label: 'Profilo' },
]

export const HERO_FILTER_CHIPS = [
  'senza Pixel',
  'senza Google Ads',
  'senza sito',
  'errori SEO',
  'senza SSL',
  'senza Instagram',
  'senza Facebook',
  'senza LinkedIn',
  'sito lento',
  'senza GTM',
  'senza Analytics',
  'senza DMARC',
  'non mobile',
  'senza email',
  'basso rating',
  'poche recensioni',
] as const

/** Subset per mockup landing su viewport stretti — evita overflow orizzontale */
export const HERO_MOCKUP_FILTER_CHIPS = HERO_FILTER_CHIPS.slice(0, 8)

export const HERO_DEMO_QUERY = 'tatuatori a Milano senza instagram'

export const HERO_DEMO_LEADS = [
  {
    name: 'Ink Factory Milano',
    sito: 'inkfactory.it',
    score: 84,
    tier: 'HOT' as const,
    mobile: '340 882 1190',
    email: 'info@inkfactory.it',
    citta: 'Milano',
    categoria: 'Tatuatore',
    opportunita: 'No Instagram',
    extra: 4,
    rating: '4.9',
    speed: '1.2s',
  },
  {
    name: 'Black Rose Tattoo',
    sito: 'blackrosetattoo.it',
    score: 71,
    tier: 'WARM' as const,
    mobile: '333 204 8812',
    email: 'In arrivo...',
    citta: 'Milano',
    categoria: 'Tatuatore',
    opportunita: 'No Pixel',
    extra: 3,
    rating: '4.7',
    speed: '2.4s',
  },
  {
    name: 'Studio Mano Nera',
    sito: 'manonera.com',
    score: 68,
    tier: 'WARM' as const,
    mobile: '02 3654 2210',
    email: 'studio@manonera.com',
    citta: 'Milano',
    categoria: 'Tatuatore',
    opportunita: 'No GTM',
    extra: 5,
    rating: '4.8',
    speed: '3.1s',
  },
]

export default function HeroMockupSidebar() {
  return (
    <aside className="hidden min-[400px]:flex w-[128px] sm:w-[168px] md:w-[186px] flex-shrink-0 bg-white border-r border-slate-200 flex-col h-full">
      <div className="px-1.5 sm:px-2 py-2 sm:py-2.5 border-b border-slate-100 flex justify-center">
        <img src="/mirax-logo-clean.svg" alt="MIRAX" className="h-5 sm:h-7 w-auto object-contain max-w-full" />
      </div>

      <nav className="flex-1 px-1.5 py-1.5 overflow-y-auto scrollbar-thin min-h-0">
        <ul className="space-y-1">
          {HERO_SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = item.active === true
            return (
              <li key={item.label}>
                <div
                  className={`w-full flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-[5px] sm:py-[6px] rounded-md text-[10px] sm:text-[11px] leading-tight ${
                    isActive
                      ? 'bg-slate-100 text-slate-950 font-semibold'
                      : 'text-slate-600 font-medium'
                  }`}
                >
                  <Icon
                    size={13}
                    strokeWidth={1.75}
                    className={`flex-shrink-0 ${isActive ? 'text-slate-900' : 'text-slate-400'}`}
                  />
                  <span className="truncate">{item.label}</span>
                </div>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="px-1.5 py-1.5 border-t border-slate-100 flex-shrink-0">
        <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold text-slate-700">Crediti</span>
              <span className="text-[8px] font-medium bg-white text-slate-600 border border-slate-200 px-1 py-0 rounded">Free</span>
            </div>
            <span className="text-[9px] font-semibold text-slate-800 tabular-nums">
              7<span className="text-slate-400 font-normal"> / 10</span>
            </span>
          </div>
          <div className="h-1 rounded-full bg-slate-200 mb-1.5 overflow-hidden">
            <div className="h-full w-[71%] bg-violet-600 rounded-full" />
          </div>
          <div className="flex items-center gap-1">
            <span className="flex-1 text-center text-[9px] font-medium bg-violet-600 text-white py-1 rounded-md">Upgrade</span>
            <span className="text-slate-400 p-1">
              <LogOut size={12} strokeWidth={1.75} />
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
