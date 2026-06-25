import { getEnvironments } from './actions'
import { EnvironmentsList } from './EnvironmentsList'

export default async function EnvironmentsPage() {
  const environments = await getEnvironments()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Ambiente</h1>
          <p className="text-sm text-slate-500 mt-1">
            Organizza le tue liste in un Ambiente tematico — ogni sotto-ricerca resta collegata al contesto principale
          </p>
        </div>
      </div>

      <EnvironmentsList environments={environments} />
    </div>
  )
}
