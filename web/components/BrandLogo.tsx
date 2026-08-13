// The RenovateConnect mark: an R whose descending leg becomes the left slope of
// a house roof.
//
// Inlined rather than an <img> so the two tones can come from CSS variables —
// the navy is near-invisible on a black background, so dark mode swaps it for a
// near-white. `app/icon.svg` holds the same artwork with fixed colours for the
// browser tab and social previews, where CSS can't reach.

export function BrandLogo({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="var(--logo-ink)"
        fillRule="evenodd"
        d="M22 14h18v52H22Zm18 0h17a19 19 0 0 1 0 38H40V40h15a7 7 0 0 0 0-14H40Z"
      />
      <path fill="var(--logo-ink)" d="M50 39 8 82h18l24-24.5Z" />
      <path fill="var(--logo-accent)" d="M50 39l42 43H74L50 57.5Z" />
      <g fill="var(--logo-accent)">
        <rect x="41" y="63" width="9" height="9" rx="2" />
        <rect x="52" y="63" width="9" height="9" rx="2" />
        <rect x="41" y="74" width="9" height="9" rx="2" />
        <rect x="52" y="74" width="9" height="9" rx="2" />
      </g>
    </svg>
  );
}
