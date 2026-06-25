import { getEnvironmentWithLeads, recalculateEnvironmentStats } from '../actions'
import { EnvironmentDetail } from './EnvironmentDetail'
import { notFound } from 'next/navigation'

type Props = {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export default async function EnvironmentPage({ params }: Props) {
  const { id } = await params

  if (!id) {
    notFound()
  }

  let { environment, leads, lists } = await getEnvironmentWithLeads(id)

  if (!environment) {
    notFound()
  }

  if (leads.length > 0) {
    const statsTotal = Number(environment.stats?.total_leads) || 0
    if (statsTotal !== leads.length) {
      const result = await recalculateEnvironmentStats(id)
      if (result.success && result.stats) {
        environment = { ...environment, stats: result.stats }
      }
    }
  }

  return <EnvironmentDetail environment={environment} initialLeads={leads} childLists={lists} />
}
