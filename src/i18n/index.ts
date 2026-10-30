/*
 * UI text is written in English at the call site. `t` only fills placeholders;
 * there is no language lookup, dictionary, or runtime conversion.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  let s = text;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Locale for Intl (numbers, dates, weekdays). */
export function locale(): string {
  return "en-GB";
}

/** Backend messages are already English; kept as a pass-through at call sites. */
export function tBackend(msg: string): string {
  return msg;
}
