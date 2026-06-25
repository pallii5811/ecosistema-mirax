'use client'

import { createContext, useContext } from 'react'

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
