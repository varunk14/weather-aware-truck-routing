interface BrandMarkProps {
  className?: string;
}

/** The Clearway mark: a road in perspective. Decorative; the product name is always shown next to it. */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
      <path
        d="M10.5 25 14.5 7h3l4 18"
        fill="none"
        stroke="var(--color-accent-text)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 12v2.5m0 4V21"
        stroke="var(--color-accent-text)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
