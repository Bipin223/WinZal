import { initialOf } from "./store";

/** Flat circular portrait. No ring or outline: the photo is the shape. */
export function ProfileAvatar({
  photo,
  name,
  size,
  className = "",
}: {
  photo: string | null;
  name: string;
  size: number;
  className?: string;
}) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: photo
          ? undefined
          : "radial-gradient(circle at 30% 20%, #ffe3bd 0%, #efb274 32%, #b56a3f 64%, #5a3123 100%)",
      }}
      aria-hidden
    >
      {photo ? (
        <img src={photo} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <span
          className="relative font-bold leading-none tracking-[-0.02em]"
          style={{ fontSize: Math.round(size * 0.4), color: "rgba(62, 33, 20, 0.82)" }}
        >
          {initialOf(name)}
        </span>
      )}
    </span>
  );
}
