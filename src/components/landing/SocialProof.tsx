'use client'

export default function SocialProof() {
  const logos = ['NorthPeak', 'BlueForge', 'Kinetiq', 'NovaDesk', 'AtlasCloud', 'BrightOps']

  return (
    <section className="w-full bg-slate-50 py-10 md:py-12">
      <div className="mx-auto max-w-7xl px-6">
        <div className="rounded-3xl border border-slate-200 bg-white/70 backdrop-blur p-6 shadow-sm">
          <div className="text-center">
            <p className="text-sm text-accent uppercase tracking-wider font-bold">Accesso immediato a milioni di lead B2B profilati in tempo reale</p>
          </div>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-10 gap-y-6 items-center justify-items-center">
            {logos.map((name) => (
              <div
                key={name}
                className="h-11 w-full max-w-[180px] rounded-2xl border border-slate-200 bg-white flex items-center justify-center font-semibold tracking-wide text-slate-400 opacity-50 transition-all duration-300 hover:opacity-100 hover:text-slate-900"
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
