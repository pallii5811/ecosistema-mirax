'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import TopHeader from '@/components/TopHeader'
import { DashboardProvider } from '@/components/DashboardContext'
import OnboardingModal from '@/components/OnboardingModal'
import FirstRunModal from '@/components/onboarding/FirstRunModal'
import { readUiMode, writeUiMode, type MiraxUiMode } from '@/lib/ui-mode'
import { readLocale, writeLocale, type MiraxLocale } from '@/lib/i18n'

type DashboardLayoutClientProps = {
  userId: string
  email: string
  initialCredits: number
  initialPlanType?: string
  children: React.ReactNode
}

export default function DashboardLayoutClient({
  userId,
  email,
  initialCredits,
  initialPlanType = 'free',
  children,
}: DashboardLayoutClientProps) {
  const [credits, setCredits] = useState<number>(initialCredits)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [uiMode, setUiModeState] = useState<MiraxUiMode>('expert')
  const [locale, setLocaleState] = useState<MiraxLocale>('it')
  const planType = (initialPlanType as 'free' | 'starter' | 'pro' | 'agency') || 'free'

  useEffect(() => {
    setUiModeState(readUiMode())
    setLocaleState(readLocale())
  }, [])

  const setUiMode = (mode: MiraxUiMode) => {
    writeUiMode(mode)
    setUiModeState(mode)
  }

  const setLocale = (next: MiraxLocale) => {
    writeLocale(next)
    setLocaleState(next)
  }

  // Always fetch fresh credits client-side on mount
  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        if (typeof d.credits === 'number') {
          setCredits(d.credits)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <DashboardProvider value={{ userId, email, credits, setCredits, planType, uiMode, setUiMode, locale, setLocale }}>
      <div
        className="min-h-screen bg-slate-50 text-slate-900"
        style={{
          '--foreground': '#0f172a',
          '--background': '#f8fafc',
          '--card': '#ffffff',
          '--card-foreground': '#0f172a',
          '--popover': '#ffffff',
          '--popover-foreground': '#0f172a',
          '--muted': '#f1f5f9',
          '--muted-foreground': '#64748b',
          '--accent': '#f1f5f9',
          '--accent-foreground': '#0f172a',
          '--border': '#e2e8f0',
          '--input': '#e2e8f0',
          '--ring': 'rgba(139,92,246,0.4)',
        } as React.CSSProperties}
      >
        <div className="flex min-w-0">
          <Sidebar
            credits={credits}
            variant="desktop"
            onNavigate={() => {
              setMobileSidebarOpen(false)
            }}
          />

          <Sidebar
            credits={credits}
            variant="mobile"
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            onNavigate={() => setMobileSidebarOpen(false)}
          />

          <div className="flex-1 min-w-0">
            <TopHeader email={email} onMenuClick={() => setMobileSidebarOpen(true)} />
            <div className="p-4 md:p-8">{children}</div>
            <OnboardingModal />
            <FirstRunModal onSelect={setUiMode} />
          </div>
        </div>
      </div>
    </DashboardProvider>
  )
}
