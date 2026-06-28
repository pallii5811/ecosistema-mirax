'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot,
  Brain,
  Cable,
  Home,
  Layers,
  Plug,
  Radar,
} from 'lucide-react'

const NAV = [
  { href: '/dashboard/ecosistema', label: 'Overview', icon: Home, exact: true },
  { href: '/dashboard/ecosistema/agenti', label: 'Multi-Agent', icon: Bot },
  { href: '/dashboard/ecosistema/nous', label: 'NOUS / CRM', icon: Plug },
  { href: '/dashboard/ecosistema/edat', label: 'EDAT', icon: Radar },
  { href: '/dashboard/ecosistema/intelligence', label: 'Intelligence', icon: Brain },
  { href: '/dashboard/ecosistema/api', label: 'API v1', icon: Cable },
]

export function EcosistemaNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap gap-2 mb-6">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
              active
                ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function EcosistemaPageHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 text-violet-600 mb-1">
        <Layers className="w-5 h-5" />
        <span className="text-xs font-semibold uppercase tracking-wider">Centro Comando</span>
      </div>
      <h1 className="text-xl md:text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-1 max-w-3xl">{description}</p>
    </div>
  )
}
