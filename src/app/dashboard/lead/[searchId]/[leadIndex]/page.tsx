import LeadDetailClient from './LeadDetailClient'

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ searchId: string; leadIndex: string }>
}) {
  const { searchId, leadIndex } = await params
  const idx = parseInt(leadIndex)

  // Disabilito il pesantissimo fetch SSR da Supabase che rallenta la pagina di 30 secondi.
  // Affidiamo tutto al Client Component che caricherà i dati all'istante dalla cache.
  return (
    <LeadDetailClient
      lead={null}
      searchId={searchId}
      leadIndex={idx}
      category={null}
      location={null}
    />
  )
}
