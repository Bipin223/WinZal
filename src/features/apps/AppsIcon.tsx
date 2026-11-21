import type { IconProps } from "@phosphor-icons/react";

/** The Apps launcher: a small drawer holding two app tiles. */
export function AppsIcon({ size = 24, className, style, color }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      color={color}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.3" y="5.1" width="17.4" height="14.2" rx="3.5" />
      <path d="M3.3 9.1h17.4" />
      <rect x="7.2" y="12.1" width="3.8" height="3.8" rx="1" fill="currentColor" stroke="none" />
      <rect x="13" y="12.1" width="3.8" height="3.8" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
