import { Link } from 'react-router-dom';

type BrandProps = {
  to?: string;
  className?: string;
  /** Visual variant for the mark + wordmark. */
  variant?: 'light' | 'dark';
  /** Hides wordmark — useful for tight headers. */
  iconOnly?: boolean;
  /** Legacy hooks kept so old call sites don't break. */
  iconWrapperClassName?: string;
  iconClassName?: string;
  textClassName?: string;
};

const Brand = ({
  to,
  className = '',
  variant = 'light',
  iconOnly = false,
}: BrandProps) => {
  const isDark = variant === 'dark';

  const content = (
    <div className={`group inline-flex items-center gap-2.5 ${className}`.trim()}>
      {/* Double-bezel mark */}
      <span
        className={[
          'relative flex h-9 w-9 items-center justify-center rounded-[14px] p-[2px] ring-1',
          isDark ? 'bg-white/[0.06] ring-white/10' : 'bg-ink-900/[0.04] ring-ink-900/5',
        ].join(' ')}
      >
        <span
          className="relative flex h-full w-full items-center justify-center rounded-[12px] overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, #022C1F 0%, #047857 45%, #06B6D4 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
          }}
        >
          {/* Soft inner glow */}
          <span
            aria-hidden
            className="absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(120% 80% at 30% 0%, rgba(108,232,183,0.55) 0%, transparent 60%)',
            }}
          />
          {/* EraEdu mark: an open book with a rising horizon */}
          <svg
            viewBox="0 0 24 24"
            className="relative h-[18px] w-[18px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7.5c2.9-.9 5.5-.4 8 1.5v9.5c-2.5-1.9-5.1-2.4-8-1.5V7.5Z" />
            <path d="M20 7.5c-2.9-.9-5.5-.4-8 1.5v9.5c2.5-1.9 5.1-2.4 8-1.5V7.5Z" />
            <path d="M12 4.2v1.7 M8.8 5.1l1 1 M15.2 5.1l-1 1" />
          </svg>
        </span>
      </span>

      {!iconOnly && (
        <span className="flex flex-col leading-none">
          <span
            className={[
              'font-display text-[16px] font-bold uppercase tracking-[0.1em]',
              isDark ? 'text-white' : 'text-ink-900',
            ].join(' ')}
            aria-label="ERAEDU"
          >
            ERA<span className="text-primary-500">EDU</span>
          </span>
          <span
            className={[
              'mt-0.5 text-[9px] font-semibold uppercase tracking-eyebrow',
              isDark ? 'text-white/50' : 'text-ink-400',
            ].join(' ')}
          >
            Assessment&nbsp;Intelligence
          </span>
        </span>
      )}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="inline-flex">
        {content}
      </Link>
    );
  }
  return content;
};

export default Brand;
