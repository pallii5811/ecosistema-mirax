'use client'

import { Shield, Lock, Server, Eye, Activity } from 'lucide-react'

const badges = [
  { icon: Shield, text: 'Privacy policy GDPR' },
  { icon: Lock, text: 'Crittografia SSL/TLS' },
  { icon: Server, text: 'Server in UE' },
  { icon: Eye, text: 'Dati da fonti pubbliche' },
  { icon: Activity, text: '1 credito = 1 lead' },
]

export function TrustBadges() {
  return (
    <section className="py-6 bg-white border-y border-zinc-100">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
          {badges.map((badge) => (
            <div key={badge.text} className="flex items-center gap-2.5 text-zinc-400 hover:text-zinc-600 transition-colors duration-200 group">
              <div className="w-6 h-6 rounded-lg bg-violet-50 flex items-center justify-center group-hover:bg-violet-100 transition-colors duration-200">
                <badge.icon size={13} className="text-violet-500" />
              </div>
              <span className="text-sm font-medium whitespace-nowrap">{badge.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
