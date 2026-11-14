import * as React from 'react';
import { cn } from '~/lib/utils';

/**
 * Apple-style settings row: label on the left (fixed width), control on the
 * right. Replaces the stacked Label-above-Input pattern so forms scan like
 * System Settings instead of a vertical pile.
 *
 * Collapses to stacked layout below 480px container width so the popup-sized
 * surface doesn't squeeze the label into nothing.
 */
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
      <div className="pt-1.5 sm:pt-2">
        <div className="text-[12px] font-medium text-foreground leading-tight">{label}</div>
        {hint && (
          <div className="text-[12px] text-[var(--cds-text-secondary)] leading-normal mt-0.5">
            {hint}
          </div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
