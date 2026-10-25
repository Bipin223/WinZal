import { useEffect, useState } from "react";

/** Seconds for the Scatter face. Inactive everywhere else, so it costs nothing. */
export function useSecond(active: boolean): number {
  const [second, setSecond] = useState(() => new Date().getSeconds());
  useEffect(() => {
    if (!active) return;
    setSecond(new Date().getSeconds());
    const id = window.setInterval(() => setSecond(new Date().getSeconds()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return second;
}
