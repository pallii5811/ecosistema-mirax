'use client'

import type { ReactNode } from 'react'

type Props = {
  url: string
  children: ReactNode
  className?: string
  shellClassName?: string
  uiClassName?: string
}

export default function HeroDeviceFrame({
  url,
  children,
  className = '',
  shellClassName = 'landing-hero__device-shell',
  uiClassName = 'landing-hero__mockup-ui',
}: Props) {
  return (
    <div className={`relative p-[1px] landing-mockup-shell ${shellClassName} ${className}`}>
      <div className="landing-mockup-inner bg-[#0c0c0e] flex flex-col">
        <div className="landing-hero__device-chrome px-2.5 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-3">
          <div className="flex gap-1 sm:gap-1.5 flex-shrink-0">
            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#ff5f57]" />
            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#febc2e]" />
            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 flex justify-center min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 w-full max-w-full sm:max-w-[min(100%,320px)] rounded-lg bg-white/[0.06] border border-white/[0.08] px-2 sm:px-3 py-1 sm:py-1.5">
              <span className="w-2 h-2 sm:w-3 sm:h-3 rounded-sm bg-violet-500/80 flex-shrink-0" />
              <span key={url} className="text-[9px] sm:text-[11px] text-zinc-400 font-mono truncate">{url}</span>
            </div>
          </div>
          <div className="w-8 hidden sm:block" />
        </div>
        <div className={`landing-mockup-ui ${uiClassName} bg-white`}>
          {children}
        </div>
      </div>
    </div>
  )
}
