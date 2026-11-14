import * as React from 'react';
import { cn } from '~/lib/utils';

/**
 * Claude Design System button — 4-size ladder, 5 variants, physical press.
 *
 * Key CDS rules enforced here:
 *  - 1-border rule: inside a card, `secondary` never draws a border — it uses
 *    the surface-2 fill instead. `outline` is for empty canvases only.
 *  - Squish physics: every variant gets `.cds-btn-squish` so the press springs
 *    back on release via the 15-stop `linear()` curve (globals.css).
 *  - Paint layer is an inner <span> so padding/border never fight the fill —
 *    the button element itself stays border-0 outline-0.
 */

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'destructive' | 'default' | 'link';
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg' | 'default';
  isLoading?: boolean;
}

const SIZE: Record<string, string> = {
  xxs: 'h-6 px-2 rounded text-xs gap-1',
  xs: 'h-7 px-2.5 rounded-md text-xs gap-1',
  sm: 'h-8 px-3 rounded-lg text-[13px] gap-1.5',
  md: 'h-9 px-3.5 rounded-lg text-[13px] gap-1.5',
  lg: 'h-10 px-5 rounded-xl text-[14px] gap-2 font-medium',
  icon: 'size-8 rounded-lg p-0',
  'icon-sm': 'size-7 rounded-md p-0',
  'icon-lg': 'size-9 rounded-lg p-0',
  // legacy aliases mapped to CDS ladder
  default: 'h-9 px-3.5 rounded-lg text-[13px] gap-1.5',
};

const VARIANT: Record<string, { text: string; paint: string }> = {
  primary: {
    text: 'text-white font-medium',
    paint: 'bg-[#b54d2e] hover:bg-[#9e4125] shadow-2xs',
  },
  secondary: {
    text: 'text-foreground font-normal',
    paint:
      'bg-[var(--cds-fill-secondary)] hover:bg-[var(--cds-fill-secondary-hover)]',
  },
  ghost: {
    text: 'text-[var(--cds-text-secondary)] font-normal',
    paint:
      'bg-transparent hover:bg-[var(--cds-fill-ghost-hover)]',
  },
  outline: {
    text: 'text-foreground font-normal',
    paint:
      'bg-transparent hover:bg-[var(--cds-fill-ghost-hover)] shadow-[inset_0_0_0_1px_var(--cds-border)]',
  },
  danger: {
    text: 'text-white font-medium',
    paint: 'bg-red-700 hover:bg-red-800 shadow-2xs',
  },
  destructive: {
    text: 'text-white font-medium',
    paint: 'bg-red-700 hover:bg-red-800 shadow-2xs',
  },
  // legacy shadcn aliases
  default: {
    text: 'text-white font-medium',
    paint: 'bg-[#b54d2e] hover:bg-[#9e4125] shadow-2xs',
  },
  link: {
    text: 'text-primary font-normal underline-offset-4 hover:underline',
    paint: 'bg-transparent',
  },
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
    const isIconSize = size.startsWith('icon');

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          'group/btn cds-btn-squish relative inline-flex shrink-0 items-center justify-center font-sans select-none cursor-pointer border-0 outline-none transition-[background-color,box-shadow,color] duration-[var(--cds-dur-fast)] ease-out disabled:bg-secondary disabled:text-muted-foreground disabled:shadow-none disabled:cursor-not-allowed disabled:pointer-events-none',
          'focus-visible:shadow-[var(--cds-focus-shadow)]',
          s,
          v.text,
          v.paint,
          isIconSize && 'flex items-center justify-center',
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
