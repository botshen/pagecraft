import * as React from 'react';
import { cn } from '~/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-[6px] border border-border bg-background px-2.5 py-1 text-[13px] text-foreground transition-colors',
        'hover:border-[var(--pc-border-strong)]',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20',
        'file:border-0 file:bg-transparent file:text-xs file:font-medium',
        'disabled:cursor-not-allowed disabled:opacity-50 select-text',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
export { Input };
