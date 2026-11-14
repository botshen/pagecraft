import * as React from 'react';
import { cn } from '~/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
}

const badgeVariants = {
  default: 'border-transparent bg-primary/15 text-primary',
  secondary: 'border-border bg-secondary text-secondary-foreground',
  destructive: 'border-transparent bg-destructive/15 text-destructive',
  outline: 'border-border text-muted-foreground',
  success: 'border-transparent bg-emerald-700 text-white dark:bg-emerald-600',
  warning: 'border-transparent bg-amber-700 text-white dark:bg-amber-600',
};

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
