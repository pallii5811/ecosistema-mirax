import { getEnvironmentWithLeads, recalculateEnvironmentStats } from '../actions'
import { EnvironmentDetail } from './EnvironmentDetail'
import { notFound } from 'next/navigation'

type Props = {
  params: Promise<{ id: string }>
}

export default async function EnvironmentPage({ params }: Props) {
  const { id } = await params

  const { environment, leads, lists } = await getEnvironmentWithLeads(id)

  if (!environment) {
    notFound()
  }

  if (leads.length > 0 && (!environment.stats || environment.stats.total_leads !== leads.length)) {
    await recalculateEnvironmentStats(id)
  }

  return <EnvironmentDetail environment={environment} initialLeads={leads} childLists={lists} />
}
