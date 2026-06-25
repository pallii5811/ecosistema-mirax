import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'MIRAX — Sales Automation B2B Italia'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          background: 'linear-gradient(135deg, #09090b 0%, #18181b 40%, #1e1b4b 100%)',
          padding: '60px 80px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Grid background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.06,
            backgroundImage:
              'linear-gradient(rgba(124,58,237,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.8) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Glow */}
        <div
          style={{
            position: 'absolute',
            top: -80,
            right: -80,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)',
          }}
        />

        {/* Brand tag */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '32px',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #6366f1)',
              color: 'white',
              fontSize: '20px',
              fontWeight: 800,
              padding: '8px 16px',
              borderRadius: '10px',
              letterSpacing: '-0.02em',
            }}
          >
            MIRAX
          </div>
          <div style={{ color: '#a1a1aa', fontSize: '16px', fontWeight: 600 }}>
            Sales Automation · Italia
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: '52px',
            fontWeight: 800,
            color: '#fafafa',
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            marginBottom: '20px',
            maxWidth: '900px',
          }}
        >
          Trova il cliente, contattalo, chiudi il deal.
          <br />
          <span style={{ color: '#a78bfa' }}>Tutto da un posto solo.</span>
        </div>

        {/* Sub */}
        <div
          style={{
            fontSize: '22px',
            color: '#a1a1aa',
            lineHeight: 1.5,
            maxWidth: '700px',
            marginBottom: '36px',
          }}
        >
          Discovery multi-fonte · Profilo aziendale · Audit · Pitch AI · Pipeline
        </div>

        {/* Stats */}
        <div
          style={{
            display: 'flex',
            gap: '32px',
          }}
        >
          {[
            { v: 'Multi-fonte', l: 'Profilo' },
            { v: '16+', l: 'Segnali tech' },
            { v: '< 2 min', l: 'Al pitch' },
            { v: '1:1', l: 'Credito = lead' },
          ].map((s) => (
            <div
              key={s.l}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '14px 20px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '12px',
              }}
            >
              <span style={{ fontSize: '24px', fontWeight: 800, color: '#fafafa' }}>{s.v}</span>
              <span style={{ fontSize: '13px', color: '#71717a' }}>{s.l}</span>
            </div>
          ))}
        </div>

        {/* URL */}
        <div
          style={{
            position: 'absolute',
            bottom: '30px',
            right: '60px',
            fontSize: '16px',
            color: '#52525b',
            fontWeight: 600,
          }}
        >
          miraxgroup.it
        </div>
      </div>
    ),
    { ...size }
  )
}
