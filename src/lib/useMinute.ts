import { useEffect, useState } from "react";

/**
 * Clock for the notch: updates at the next minute boundary instead of every
 * second. The UI only shows HH:MM, so 59 out of 60 renders were wasted waking
 * WebView2 while the notch sat closed.
 */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      // +50 ms so the update lands after the boundary, not just before it.
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}
