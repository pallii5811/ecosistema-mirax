import { redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import DashboardLayoutClient from '@/components/DashboardLayoutClient'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  let { data: profile } = await supabase
    .from('profiles')
    .select('credits, plan_type')
    .eq('id', user.id)
    .single()

  // Auto-create profile if missing (use service role to bypass RLS)
  if (!profile) {
    try {
      const adminDb = createServiceRoleClient()
      const newProfile = {
        id: user.id,
        email: user.email || '',
        credits: 10,
        plan_type: 'free',
        full_name: '',
        company: '',
      }
      await adminDb.from('profiles').upsert(newProfile, { onConflict: 'id' })
    } catch {
      // Service role key not available — skip DB insert
    }
    profile = { credits: 10, plan_type: 'free' }
  }

  const credits = typeof profile?.credits === 'number' ? profile.credits : 0
  const planType = (profile as any)?.plan_type || 'free'

  return (
    <DashboardLayoutClient userId={user.id} email={user.email ?? ''} initialCredits={credits} initialPlanType={planType}>
      {children}
    </DashboardLayoutClient>
  )
}
