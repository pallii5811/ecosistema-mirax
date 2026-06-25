import React from 'react'

interface MiraxLogoProps {
  size?: number
  variant?: 'light' | 'dark'
  showWordmark?: boolean
  showTagline?: boolean
  className?: string
}

export function MiraxLogo({
  size = 36,
  variant = 'dark',
  showWordmark = true,
  showTagline = false,
  className = '',
}: MiraxLogoProps) {
  const iconSize = size

  return (
    <div className={className} style={{ lineHeight: 1 }}>
      <img
        src="/mirax-logo-clean.svg"
        alt="MiraX"
        style={{ 
          width: `${size}px`,
          height: 'auto',
          maxHeight: `${size}px`,
          objectFit: 'contain',
          display: 'block'
        }}
      />
    </div>
  )
}

export default MiraxLogo