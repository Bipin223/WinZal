/*
 * Source strings were originally German. Some old builds and PowerShell edits
 * left double-encoded text behind ("Hover-VerzÃ¶gerung", "F├╝r", "ΓÇô").
 * The English dictionary is keyed by the proper German text, so repair the
 * lookup key before falling back to the raw string. This keeps the UI English
 * without touching every call site.
 */

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const CP437_REV = new Map<number, number>();
[...CP437].forEach((ch, i) => CP437_REV.set(ch.codePointAt(0)!, 0x80 + i));

function decode(bytes: number[]): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

function repairOnce(input: string): string {
  let out = input;

  // Windows-1252 double encoding: "Hover-VerzÃ¶gerung", "â€“", "Â·".
  if (/[ÃÂâ€]/.test(out)) {
    const bytes: number[] = [];
    let ok = true;
    for (const ch of out) {
      const cp = ch.codePointAt(0)!;
      if (cp <= 0xff) bytes.push(cp);
      else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
      else {
        ok = false;
        break;
      }
    }
    if (ok) {
      const fixed = decode(bytes);
      if (fixed !== null && fixed !== out) out = fixed;
    }
  }

  // CP437 double encoding: "F├╝r", "Qualit├ñt", "ΓÇô", "ΓåÆ".
  if (/[├Γ╝╢]/.test(out)) {
    const bytes: number[] = [];
    let ok = true;
    for (const ch of out) {
      const cp = ch.codePointAt(0)!;
      if (CP437_REV.has(cp)) bytes.push(CP437_REV.get(cp)!);
      else if (cp <= 0xff) bytes.push(cp);
      else {
        ok = false;
        break;
      }
    }
    if (ok) {
      const fixed = decode(bytes);
      if (fixed !== null && fixed !== out) out = fixed;
    }
  }

  return out;
}

const cache = new Map<string, string>();

export function fixMojibake(input: string): string {
  const cached = cache.get(input);
  if (cached !== undefined) return cached;
  let out = input;
  // At most two nested encodings have been seen in practice.
  for (let i = 0; i < 3; i++) {
    const next = repairOnce(out);
    if (next === out) break;
    out = next;
  }
  cache.set(input, out);
  return out;
}
