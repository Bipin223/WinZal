/** Selection/status indicator: a green dot instead of a checkmark. */
export function SelectedDot({ size = 7, className = "" }: { size?: number; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full bg-green ${className}`} style={{ width: size, height: size }} />;
}
