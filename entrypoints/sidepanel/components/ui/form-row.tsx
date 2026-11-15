import * as React from 'react';
import { cn } from '~/lib/utils';

export function FormRow({
  label,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-1.5 sm:grid-cols-[140px_1fr] sm:gap-3 items-start',
        className,
      )}
    >
      <div className="pt-1 sm:pt-1.5">
        <div className="text-[13px] font-medium text-foreground leading-tight">{label}</div>
        {hint && (
          <div className="text-xs text-muted-foreground leading-normal mt-0.5">{hint}</div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
