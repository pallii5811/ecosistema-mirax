import { redirect } from 'next/navigation'
import { EcosistemaNav, EcosistemaPageHeader } from '@/components/ecosistema/EcosistemaNav'
import { SHOW_CENTRO_COMANDO } from '@/lib/feature-flags'

export default function EcosistemaLayout({ children }: { children: React.ReactNode }) {
  if (!SHOW_CENTRO_COMANDO) {
    redirect('/dashboard')
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <EcosistemaPageHeader
        title="Centro Comando"
        description="Agenti AI, NOUS/CRM, EDAT, intelligence e API — integrazioni e automazioni enterprise."
      />
      <EcosistemaNav />
      {children}
    </div>
  )
}
