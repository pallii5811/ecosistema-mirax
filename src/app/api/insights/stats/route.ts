import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data, error } = await supabase
    .from('lead_interactions')
    .select('action')
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({
      total_contacted: 0, total_converted: 0, total_rejected: 0, conversion_rate: 0,
    })
  }

  const contacted = data?.filter((i: any) => i.action === 'contacted').length || 0
  const converted = data?.filter((i: any) => i.action === 'converted').length || 0
  const rejected = data?.filter((i: any) => i.action === 'rejected').length || 0

  return NextResponse.json({
    total_contacted: contacted,
    total_converted: converted,
    total_rejected: rejected,
    conversion_rate: contacted > 0 ? Math.round((converted / contacted) * 100) : 0,
  })
}
