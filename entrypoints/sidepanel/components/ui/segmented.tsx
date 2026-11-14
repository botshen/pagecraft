import * as React from 'react';
import { cn } from '~/lib/utils';

/**
 * CDS segmented control — sliding pill, 1px track padding, geometric thumb.
 * Pure CSS (no framer-motion): the thumb is absolutely positioned and
 * transitions on `--cds-dur-snap` + `--cds-ease-snap`.
 *
 * Segments size to their content (flex-basis: auto) because labels differ in
 * length, so the thumb's left/width are measured from the active button's
 * real bounds — an equal-share calc would let the pill spill over the
 * neighbouring tab's label.
 */

export interface SegmentedItem {
  id: string;
  label: string;
  badge?: number;
  icon?: React.ReactNode;
  title?: string;
}

export interface SegmentedControlProps {
  items: SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function SegmentedControl({
  items,
  value,
  onChange,
  className,
  size = 'md',
}: SegmentedControlProps) {
  const activeIndex = Math.max(0, items.findIndex((i) => i.id === value));
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = React.useState({ left: 0, width: 0 });

  React.useLayoutEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (!el) return;
    setThumb((prev) =>
      prev.left === el.offsetLeft && prev.width === el.offsetWidth
        ? prev
        : { left: el.offsetLeft, width: el.offsetWidth },
    );
  }, [activeIndex, items]);

  // Re-measure when the track or any item resizes (count badge, font load).
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = itemRefs.current[activeIndex];
      if (!el) return;
      setThumb((prev) =>
        prev.left === el.offsetLeft && prev.width === el.offsetWidth
          ? prev
          : { left: el.offsetLeft, width: el.offsetWidth },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    for (const el of itemRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [activeIndex]);

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (items.length === 0) return;
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % items.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + items.length) % items.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex !== null) {
      e.preventDefault();
      const target = items[nextIndex];
      if (target) {
        onChange(target.id);
        itemRefs.current[nextIndex]?.focus();
      }
    }
  };

  return (
    <div
      ref={trackRef}
      className={cn('cds-seg-track select-none', size === 'sm' && 'h-7 text-[11px]', className)}
      role="tablist"
    >
      <span
        aria-hidden="true"
        className="cds-seg-thumb"
        style={{ left: thumb.left, width: thumb.width }}
      />
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            data-active={active || undefined}
            title={item.title}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className="cds-seg-item cds-btn-squish"
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span
                key={item.badge}
                className="pc-counter-tick tabular-nums text-xs px-1.5 py-0 rounded-full bg-foreground/8 text-current leading-tight"
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
