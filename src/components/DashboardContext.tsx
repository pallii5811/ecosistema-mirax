'use client'

import { createContext, useContext } from 'react'
import type { MiraxUiMode } from '@/lib/ui-mode'
import type { MiraxLocale } from '@/lib/i18n'

type PlanType = 'free' | 'starter' | 'pro' | 'agency'

export const PLAN_CREDITS: Record<PlanType, number> = {
  free: 100,
  starter: 1200,
  pro: 3000,
  agency: 10000,
}

export const PLAN_LABELS: Record<PlanType, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'PRO',
  agency: 'Agency',
}

type DashboardContextValue = {
  userId: string
  email: string
  credits: number
  setCredits: (next: number) => void
  planType: PlanType
  uiMode: MiraxUiMode
  setUiMode: (mode: MiraxUiMode) => void
  locale: MiraxLocale
  setLocale: (locale: MiraxLocale) => void
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function DashboardProvider({
  value,
  children,
}: {
  value: DashboardContextValue
  children: React.ReactNode
}) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboard() {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider')
  return ctx
}
