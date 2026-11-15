import * as React from 'react';
import { cn } from '~/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
}

const badgeVariants: Record<NonNullable<BadgeProps['variant']>, string> = {
  default:
    'border-primary/25 bg-[var(--pc-accent-subtle)] text-[var(--pc-accent-ink)]',
  secondary:
    'border-border bg-secondary text-foreground',
  destructive:
    'border-destructive/25 bg-destructive/10 text-destructive',
  outline:
    'border-border bg-transparent text-muted-foreground',
  success:
    'border-emerald-600/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  warning:
    'border-amber-600/25 bg-amber-500/12 text-amber-900 dark:text-amber-300',
};

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-[5px] border px-1.5 py-0.5 text-[11px] leading-tight font-medium tabular-nums',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
