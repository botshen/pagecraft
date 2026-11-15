import * as React from 'react';
import { cn } from '~/lib/utils';

/**
 * PageCraft Developer-Tool Button System (taste-skill 2.5.1):
 * - Strict one button pair: solid terracotta `primary` + crisp hairline `secondary`
 *   (with `ghost` for quiet inline toolbar actions and `danger` for destructive).
 * - Uniform 6px control radius (`rounded-[6px]`).
 * - Tactile fine-pointer `-1px` step on hover and `scale(0.985)` press via `.pc-btn`.
 */

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'outline'
    | 'danger'
    | 'destructive'
    | 'default'
    | 'link';
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg' | 'default';
  isLoading?: boolean;
}

const SIZE: Record<string, string> = {
  xxs: 'h-6 px-2 rounded-[5px] text-xs gap-1',
  xs: 'h-7 px-2.5 rounded-[6px] text-xs gap-1',
  sm: 'h-8 px-3 rounded-[6px] text-[13px] gap-1.5',
  md: 'h-9 px-3.5 rounded-[6px] text-[13px] gap-1.5',
  lg: 'h-11 px-5 rounded-[6px] text-[14px] gap-2 font-medium',
  icon: 'size-8 rounded-[6px] p-0',
  'icon-sm': 'size-7 rounded-[6px] p-0',
  'icon-lg': 'size-9 rounded-[6px] p-0',
  default: 'h-9 px-3.5 rounded-[6px] text-[13px] gap-1.5',
};

const VARIANT: Record<string, string> = {
  primary:
    'bg-[#C95533] hover:bg-[#B24627] dark:bg-[#D45A37] dark:hover:bg-[#E06643] text-[#FAF8F5] border border-transparent font-medium',
  default:
    'bg-[#C95533] hover:bg-[#B24627] dark:bg-[#D45A37] dark:hover:bg-[#E06643] text-[#FAF8F5] border border-transparent font-medium',
  secondary:
    'bg-card hover:bg-secondary text-foreground border border-border hover:border-[var(--pc-border-strong)] font-medium',
  outline:
    'bg-card hover:bg-secondary text-foreground border border-border hover:border-[var(--pc-border-strong)] font-medium',
  ghost:
    'bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground border border-transparent font-medium',
  danger:
    'bg-[#B93829] hover:bg-[#9E2E21] text-[#FAF8F5] border border-transparent font-medium',
  destructive:
    'bg-[#B93829] hover:bg-[#9E2E21] text-[#FAF8F5] border border-transparent font-medium',
  link: 'bg-transparent border-0 text-primary font-medium underline-offset-4 hover:underline px-0 h-auto',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const v = VARIANT[variant] ?? VARIANT.secondary!;
    const s = SIZE[size] ?? SIZE.md!;

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          'pc-btn relative inline-flex shrink-0 items-center justify-center font-sans select-none cursor-pointer',
          'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
          s,
          v,
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <span className="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
export { Button };
