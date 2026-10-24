import type { IconProps } from "@phosphor-icons/react";

/**
 * Rounded speech bubble with a tail, black/white outline. Used for the Ask AI
 * action so it reads as a chat, not a magic/sparkle setting.
 */
export function ChatBubbleIcon({ size = 16, weight, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight === "fill" ? 2.6 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3c5 0 9 3.8 9 8.5 0 1.9-.5 3.7-1.4 5.2L21 21l-4.7-1.6c-1.3.6-2.8 1-4.3 1-5 0-9-3.8-9-8.5S7 3 12 3Z" />
    </svg>
  );
}
