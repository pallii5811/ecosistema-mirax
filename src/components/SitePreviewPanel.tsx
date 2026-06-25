'use client'

import { X, ExternalLink, Maximize2, Minimize2 } from 'lucide-react'
import { useState } from 'react'

type SitePreviewPanelProps = {
  url: string
  siteName?: string
  onClose: () => void
}

export default function SitePreviewPanel({ url, siteName, onClose }: SitePreviewPanelProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-screen bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-all duration-300 ${
          expanded ? 'w-[80vw]' : 'w-[50vw]'
        }`}
      >
        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm font-semibold text-slate-700 truncate">
              {siteName || url}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
              title={expanded ? 'Riduci' : 'Espandi'}
            >
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
              title="Apri in nuova tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-rose-100 text-slate-500 hover:text-rose-600 transition-colors"
              title="Chiudi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Iframe */}
        <div className="flex-1 bg-white">
          <iframe
            src={url}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            title={`Anteprima ${siteName || url}`}
          />
        </div>
      </div>
    </>
  )
}
