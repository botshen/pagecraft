import * as React from 'react';
import { cn } from '~/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full max-w-md rounded-lg border border-[var(--cds-border)] bg-[var(--cds-surface-3)] px-2.5 py-1 text-[13px] text-foreground transition-all file:border-0 file:bg-transparent file:text-xs file:font-medium placeholder:text-[var(--cds-text-muted)] focus-visible:outline-none focus-visible:border-[#d97757] focus-visible:shadow-[var(--cds-focus-shadow)] disabled:cursor-not-allowed disabled:opacity-50 select-text',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
export { Input };
