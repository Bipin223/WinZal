/**
 * The two overlapping windows mark: a muted back pane, a bright front pane and
 * a small solid tab where they meet. Drawn by hand because none of the icon
 * sets has this exact overlap.
 */
export function OpenWindowsIcon({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <rect
        x="3.4"
        y="7.4"
        width="13.3"
        height="13.3"
        rx="4.2"
        stroke="currentColor"
        strokeOpacity="0.46"
        strokeWidth="1.7"
      />
      <rect
        x="7.3"
        y="3.3"
        width="13.3"
        height="13.3"
        rx="4.2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect x="15.2" y="14.8" width="4.6" height="4.6" rx="1.6" fill="currentColor" />
    </svg>
  );
}
