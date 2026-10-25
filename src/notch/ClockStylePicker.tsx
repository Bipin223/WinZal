import { useMemo } from "react";
import { ClockFace } from "./ClockFace";
import { CLOCK_STYLES, type ClockStyle } from "./clockStyles";
import { t } from "../i18n";
import { SelectedDot } from "../ui/SelectedDot";

/**
 * Visual clock picker. The thumbnails are the real faces at a smaller scale,
 * so what you pick is what the expanded Clock tool shows.
 */
export function ClockStylePicker({
  value,
  onChange,
  size = "md",
}: {
  value: ClockStyle;
  onChange: (style: ClockStyle) => void;
  size?: "sm" | "md";
}) {
  // Fixed sample so all five thumbnails are comparable (and it looks like a clock).
  const sample = useMemo(() => {
    const date = new Date();
    date.setHours(19, 9, 10, 0);
    return date;
  }, []);
  const small = size === "sm";
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {CLOCK_STYLES.map((style) => {
        const active = value === style.id;
        return (
          <button
            key={style.id}
            type="button"
            aria-label={t(style.label)}
            aria-pressed={active}
            title={t(style.label)}
            onClick={() => onChange(style.id)}
            className={`relative overflow-hidden rounded-[10px] border p-1 transition-colors ${
              active ? "border-label bg-fill-2" : "border-separator bg-fill-1 hover:bg-fill-2"
            }`}
          >
            <div className={`relative overflow-hidden rounded-[7px] bg-black ${small ? "h-9" : "h-12"}`}>
              <ClockFace style={style.id} now={sample} scale={small ? 0.26 : 0.34} />
            </div>
            <div className={`mt-1 text-center font-medium text-label ${small ? "text-[8px]" : "text-[9px]"}`}>
              {t(style.label)}
            </div>
            {active && <SelectedDot className="absolute top-1.5 right-1.5" />}
          </button>
        );
      })}
    </div>
  );
}
