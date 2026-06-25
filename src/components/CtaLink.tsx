'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

type CtaLinkProps = {
  children: React.ReactNode
  className?: string
}

export default function CtaLink({ children, className }: CtaLinkProps) {
  const [href, setHref] = useState('/dashboard')

  useEffect(() => {
    const run = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setHref('/signup')
      }
    }

    run()
  }, [])

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}
