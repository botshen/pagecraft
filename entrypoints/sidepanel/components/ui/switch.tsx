import * as React from 'react';
import { cn } from '~/lib/utils';

interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'pc-focus peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'bg-primary border-primary'
          : 'bg-secondary border-[var(--pc-border-strong)]',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block h-3.5 w-3.5 rounded-full bg-[#FAF8F5] shadow-2xs transition-transform duration-150 ease-[cubic-bezier(.2,.8,.2,1)]',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';
export { Switch };
