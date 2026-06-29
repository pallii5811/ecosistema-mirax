'use client'

import type { EntityType } from '@/lib/universe/types'
import { entityTypeTone, labelEntityType } from '@/lib/universe/labels'
import { cn } from '@/lib/utils'

type Props = {
  type: EntityType
  className?: string
}

export function UniverseEntityBadge({ type, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        entityTypeTone(type),
        className,
      )}
    >
      {labelEntityType(type)}
    </span>
  )
}
