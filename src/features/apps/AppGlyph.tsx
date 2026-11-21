/** A real Windows app icon, or a deterministic initial tile as a fallback. */
export function AppGlyph({
  icon,
  name,
  size = 40,
  className = "",
}: {
  icon: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        draggable={false}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const char = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";
  let hash = 0;
  for (const code of name) hash = (hash * 31 + code.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      className={`grid shrink-0 place-items-center font-semibold text-white/90 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.25)),
        fontSize: Math.round(size * 0.4),
        background: `linear-gradient(145deg, hsl(${hue} 42% 42%), hsl(${hue} 52% 24%))`,
      }}
      aria-hidden
    >
      {char}
    </span>
  );
}
