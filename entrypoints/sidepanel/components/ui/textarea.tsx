import * as React from 'react';
import { cn } from '~/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[68px] w-full rounded-[6px] border border-border bg-background px-3 py-2 text-[13px] text-foreground leading-relaxed transition-colors',
        'hover:border-[var(--pc-border-strong)]',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20',
        'disabled:cursor-not-allowed disabled:opacity-50 select-text',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
export { Textarea };
