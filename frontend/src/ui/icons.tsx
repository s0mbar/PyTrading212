// Inline stroke icons (no icon font, no external request: compatible with the strict CSP).
type IconProps = { className?: string };

function Svg({ children, className = "icon" }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h12v4" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2Z" />
      <circle cx="16" cy="14" r="1.2" />
    </Svg>
  );
}

export function IconOrder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4v16M7 4l-3 3M7 4l3 3" />
      <path d="M17 20V4M17 20l-3-3M17 20l3-3" />
    </Svg>
  );
}

export function IconBot(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4M9 13h.01M15 13h.01M9 16.5h6" />
    </Svg>
  );
}

export function IconTax(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </Svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
    </Svg>
  );
}
