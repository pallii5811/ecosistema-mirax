import React from "react";
import { BentoGrid, BentoGridItem } from "@/components/ui/bento-grid";
import {
  Search,
  Bot,
  MessageSquareText,
  BadgeCheck,
  TriangleAlert,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function IntelligenceSection() {
  return (
    <section className="py-20 bg-black relative overflow-hidden">
      <div className="container px-4 md:px-6 relative z-10">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-4">
            Molto più di un contatto
          </h2>
          <p className="text-muted-foreground text-lg">
            L&apos;AI non ti dà solo nomi: ti consegna segnali, problemi e contatti diretti per chiudere più velocemente.
          </p>
        </div>
        <BentoGrid className="max-w-5xl mx-auto">
          {items.map((item, i) => (
            <BentoGridItem
              key={i}
              title={item.title}
              description={item.description}
              header={item.header}
              icon={item.icon}
              className={cn(i === 0 || i === 3 ? "md:col-span-2" : "")}
            />
          ))}
        </BentoGrid>
      </div>
    </section>
  );
}

// --- WIDGETS GRAFICI (Nuove Interfacce Software) ---

// Widget 1: Ricerca Semantica AI
const SemanticSearchWidget = () => {
  return (
    <div className="flex flex-col w-full h-full min-h-[10rem] rounded-xl bg-neutral-900 border border-white/[0.1] p-4 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Mock Search Bar */}
      <div className="relative flex items-center bg-neutral-800 rounded-lg p-2 border border-neutral-700 mb-4">
        <Search className="w-4 h-4 text-neutral-400 ml-2 mr-3" />
        <div className="text-sm text-neutral-300">Chiedi in linguaggio naturale…</div>
        <div className="absolute right-2 p-1 bg-blue-600/20 rounded text-xs text-blue-400 flex items-center">
          <Bot className="w-3 h-3 mr-1 animate-pulse" /> AI Active
        </div>
      </div>

      <div className="mt-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-neutral-300/90 font-mono">
        “trovami aziende a milano senza pixel e con gravi errori seo…”
      </div>
    </div>
  );
};

// Widget 2: Pitch AI (Modale)
const PitchModalWidget = () => {
  return (
    <div className="flex flex-col w-full h-full min-h-[10rem] rounded-xl bg-neutral-900 border border-white/[0.1] p-4 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative rounded-xl border border-neutral-700 bg-neutral-950/40 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
          <div className="text-xs font-semibold text-neutral-200">Genera Pitch</div>
          <div className="rounded-md bg-violet-600/20 text-violet-200 border border-violet-500/30 px-2 py-0.5 text-[10px] font-semibold">
            AI
          </div>
        </div>
        <div className="p-3 space-y-2">
          <div className="text-[11px] text-neutral-300/90 font-mono">
            Oggetto: “Hai 2 errori SEO che ti stanno costando lead”
          </div>
          <div className="h-[1px] bg-neutral-800" />
          <div className="space-y-1.5 text-[10px] text-neutral-400 font-mono">
            <div className="h-2 rounded bg-white/[0.06] w-[92%]" />
            <div className="h-2 rounded bg-white/[0.06] w-[86%]" />
            <div className="h-2 rounded bg-white/[0.06] w-[78%]" />
            <div className="h-2 rounded bg-white/[0.06] w-[70%]" />
          </div>
          <div className="pt-2 flex justify-end">
            <div className="rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white">
              Copia
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Widget 3: Profilazione Immediata (badges)
const ProfilingBadgesWidget = () => {
  return (
    <div className="flex flex-col w-full h-full min-h-[10rem] rounded-xl bg-neutral-900 border border-white/[0.1] p-4 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-fuchsia-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="text-xs font-semibold text-neutral-200">Segnali & Problemi</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          { t: "No Pixel", delay: "0ms" },
          { t: "Errori SEO", delay: "120ms" },
          { t: "No GTM", delay: "240ms" },
          { t: "No Instagram", delay: "360ms" },
        ].map((b) => (
          <div
            key={b.t}
            className="rounded-full border border-red-900 bg-[#5c2b29] px-3 py-1 text-[11px] font-bold text-[#fca5a5]"
            style={{ animation: `pulse 1.8s ease-in-out ${b.delay} infinite` }}
          >
            {b.t}
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-neutral-400 font-mono">
        badge dinamici per evidenziare punti deboli
      </div>
    </div>
  );
};

// Widget 4: WhatsApp Direct
const WhatsAppDirectWidget = () => {
  return (
    <div className="flex flex-col w-full h-full min-h-[10rem] rounded-xl bg-neutral-900 border border-white/[0.1] p-4 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-neutral-200">WhatsApp Direct</div>
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.12)] animate-pulse" />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <Phone className="h-4 w-4 text-emerald-300" />
            </div>
            <div>
              <div className="text-xs font-semibold text-neutral-200">+39 3 47 123 4567</div>
              <div className="text-[11px] text-neutral-400">mobile verificato</div>
            </div>
          </div>
          <div className="rounded-lg bg-emerald-500/15 border border-emerald-500/25 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">
            Chat
          </div>
        </div>
      </div>
    </div>
  );
};

const items = [
  {
    title: "Ricerca Semantica AI",
    description: "Chiedi quello che ti serve in linguaggio naturale. L'AI traduce e trova.",
    header: <SemanticSearchWidget />,
    icon: <Bot className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "Pitch AI",
    description: "Generatore di messaggi a freddo personalizzati sugli errori del cliente.",
    header: <PitchModalWidget />,
    icon: <MessageSquareText className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "Profilazione Immediata",
    description: "Badge dinamici per evidenziare i punti deboli (SEO, Social, GTM).",
    header: <ProfilingBadgesWidget />,
    icon: <TriangleAlert className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "WhatsApp Direct",
    description: "Cellulari separati dai fissi con link diretto alla chat.",
    header: <WhatsAppDirectWidget />,
    icon: <BadgeCheck className="h-4 w-4 text-neutral-500" />,
  },
];

// Aggiunta di keyframes personalizzati per le animazioni se non presenti in tailwind.config
// Nota: In un setup reale, questi andrebbero nel file CSS globale o tailwind.config.js
// Per semplicità qui usiamo classi arbitrarie di Tailwind che simulano questi effetti dove possibile,
// o ci affidiamo alle animazioni standard (pulse, bounce).
// Le animazioni 'fadeIn', 'slideInUp', 'dash', 'shimmer' sono esempi di classi utility
// che richiederebbero una configurazione nel tailwind.config.js esteso.
// Se non funzionano, i widget saranno comunque visibili ma statici.
