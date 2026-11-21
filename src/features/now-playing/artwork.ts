import { useEffect, useState } from "react";

/** A missing cover only counts after this long (track changes often send one late). */
const EMPTY_AFTER_MS = 800;

/**
 * The cover to show, swapped only once the new image is decoded: the crossfade then
 * starts with a finished image instead of popping in halfway (big data URLs take a
 * moment). A short gap without a cover keeps the old one.
 */
export function useSmoothArtwork(src: string | null): string | null {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    // The first render already has `src`; don't decode the same cover again on
    // every tab mount. Only a real change needs the swap.
    if (src === shown) return;
    let alive = true;
    if (!src) {
      const id = window.setTimeout(() => alive && setShown(null), EMPTY_AFTER_MS);
      return () => {
        alive = false;
        window.clearTimeout(id);
      };
    }
    const img = new Image();
    img.src = src;
    void img
      .decode()
      .catch(() => {})
      .then(() => alive && setShown(src));
    return () => {
      alive = false;
    };
  }, [src, shown]);
  return shown;
}
