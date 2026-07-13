import type { ReactNode } from 'react'

// Authentication pages depend on per-request OTP/session state and must not be
// packaged as reusable static artifacts.
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children
}
