'use client';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { ReactNode } from 'react';
import { BTSpinner, InlineSpinner, LoadingScreen } from './Spinner';
import { LuCircleAlert, LuLock } from 'react-icons/lu';

export { BTSpinner, InlineSpinner, LoadingScreen };

export const fadeRise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

export const staggerContainer = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

export const staggerItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

export function PageHeader({
  title,
  subtitle,
  badge,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[22px] font-bold tracking-tight text-ink sm:text-[26px]">{title}</h1>
          {badge}
        </div>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft sm:text-sm">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </motion.header>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
  ...rest
}: { children: ReactNode; className?: string; padded?: boolean } & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      {...fadeRise}
      {...rest}
      className={`relative overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_1px_2px_rgba(25,39,53,0.04),0_1px_1px_rgba(25,39,53,0.02)] ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function TableCard({
  children,
  className = '',
  scrollX = false,
}: {
  children: ReactNode;
  className?: string;
  /** When true, the table scrolls horizontally inside the card instead of
   *  clipping — lets wide, data-dense tables show every column at any width. */
  scrollX?: boolean;
}) {
  return (
    <Card padded={false} className={`overflow-hidden ${className}`}>
      {scrollX ? (
        <div className="overflow-x-auto">
          <table className="bt-table">{children}</table>
        </div>
      ) : (
        <table className="bt-table">{children}</table>
      )}
    </Card>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TH({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={className}>{children}</th>;
}

export function TR({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`group ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className = '',
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode; className?: string }) {
  return <td className={className} {...rest}>{children}</td>;
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet' | 'cyan' | 'brand' | 'wine';

const toneStyles: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/70',
  red: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/70',
  blue: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/70',
  slate: 'bg-cream text-ink/70 ring-1 ring-inset ring-[#D9D9D9]',
  violet: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200/70',
  cyan: 'bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200/70',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200/70',
  wine: 'bg-[#fbe8eb] text-brand-700 ring-1 ring-inset ring-[#e8c5cb]',
};

export function Pill({
  children,
  tone = 'slate',
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  const dotColor: Record<Tone, string> = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-rose-500',
    blue: 'bg-sky-500',
    slate: 'bg-ink-soft',
    violet: 'bg-violet-500',
    cyan: 'bg-cyan-500',
    brand: 'bg-brand',
    wine: 'bg-brand-700',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${toneStyles[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColor[tone]} ${tone === 'green' ? 'animate-pulse' : ''}`} />}
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  disabled,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
  };
  const variants = {
    primary:
      'bg-gradient-to-b from-[#cf9e57] to-[#b6843d] text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_2px_6px_rgba(102,32,42,0.25)] hover:from-[#d8a868] hover:to-[#c08e44] active:from-[#b6843d] active:to-[#9a6f31]',
    secondary:
      'bg-white text-ink ring-1 ring-inset ring-[#E5E5E5] shadow-sm hover:bg-cream hover:ring-[#D9D9D9]',
    ghost: 'text-ink/70 hover:bg-cream hover:text-ink',
    danger:
      'bg-gradient-to-b from-[#7a2632] to-[#66202A] text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_2px_6px_rgba(102,32,42,0.4)] hover:from-[#8a2c3a] hover:to-[#75252f]',
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium tracking-tight transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:saturate-50 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading && <InlineSpinner />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-ink/70">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function inputCls(extra = '') {
  return `block w-full rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 ${extra}`;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls(props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={inputCls(`min-h-[80px] resize-y ${props.className ?? ''}`)} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputCls(props.className)} />;
}

export function Checkbox({
  label,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-ink/80">
      <input
        type="checkbox"
        {...rest}
        className="h-4 w-4 rounded border-[#D9D9D9] text-brand-600 focus:ring-brand/40"
      />
      {label}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="text-center">
      <div className="mx-auto flex flex-col items-center py-8">
        {icon && (
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-[#fbe8eb] text-brand-700 ring-1 ring-inset ring-brand-100">
            {icon}
          </div>
        )}
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 max-w-sm text-sm text-ink-soft">{description}</p>}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </Card>
  );
}

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-xl border border-[#EDE6D9] bg-white/60 px-3 py-2.5 text-xs text-ink-soft backdrop-blur-sm sm:flex-row">
      <span className="tabular-nums">
        Showing <span className="font-medium text-ink">{start.toLocaleString()}–{end.toLocaleString()}</span> of{' '}
        <span className="font-medium text-ink">{total.toLocaleString()}</span>
      </span>
      <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
        >
          ← Prev
        </Button>
        <span className="px-2 tabular-nums text-ink/70">
          Page {page} <span className="text-ink-faint">/</span> {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange(page + 1)}
          disabled={page * pageSize >= total}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}

/**
 * Loading state for tables — branded spinner inside a card frame matching
 * what the loaded table will look like. Drop-in replacement for the old
 * skeleton-rows pattern.
 */
export function SkeletonRows({ rows: _rows = 6, cols: _cols = 5, label = 'Loading' }: { rows?: number; cols?: number; label?: string }) {
  return <LoadingScreen label={label} height={320} />;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-800"
    >
      <LuCircleAlert width={16} height={16} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </motion.div>
  );
}

export function PHIBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200/70">
      <LuLock width={11} height={11} strokeWidth={2.5} />
      PHI access logged
    </span>
  );
}

export function PageWrap({ children, max = 'max-w-6xl' }: { children: ReactNode; max?: string }) {
  return (
    <div className="mx-auto w-full px-3 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-8">
      <div className={`mx-auto ${max}`}>{children}</div>
    </div>
  );
}
