// A tiny stroked icon set shared across the marketing pages. Kept inline (not
// an icon package) so the pages stay dependency-free and the icons inherit
// `currentColor` from whatever surface they land on.
//
// All icons draw on a 24x24 grid at 1.75 stroke width so they look like one
// family at any size.

type IconProps = { size?: number; className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

export function CameraIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M3 9a2 2 0 0 1 2-2h1.5l1-1.5h9l1 1.5H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function ShieldIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M12 3 4.5 6v6c0 4.5 3.1 7.9 7.5 9 4.4-1.1 7.5-4.5 7.5-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function ChatIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M21 12a8 8 0 1 1-3.3-6.5L21 4l-1.2 4.1A7.96 7.96 0 0 1 21 12Z" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={2.25}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={2}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function InfoIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function LockIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <rect x="4.5" y="10" width="15" height="10" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </svg>
  );
}

export function ToolIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M14.5 6.5a3.5 3.5 0 0 0 4.6 4.6l-8 8a2.3 2.3 0 0 1-3.2-3.2Z" />
      <path d="m5.5 5.5 3 3" />
    </svg>
  );
}

export function BoltIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M13 3 5 13.5h6L11 21l8-10.5h-6Z" />
    </svg>
  );
}
