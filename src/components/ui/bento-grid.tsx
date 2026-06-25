import * as React from "react";

import { cn } from "@/lib/utils";

export function BentoGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-3 gap-4 md:auto-rows-[18rem]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoGridItem({
  className,
  title,
  description,
  header,
  icon,
}: {
  className?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  header?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/40 p-6 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.85)]",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] to-transparent" />
      </div>

      {header ? <div className="relative mb-4">{header}</div> : null}

      <div className="relative">
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          {icon}
          <div className="font-semibold text-white">{title}</div>
        </div>
        {description ? (
          <div className="mt-2 text-sm leading-relaxed text-neutral-400">
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}
