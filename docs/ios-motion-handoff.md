# Handoff — iOS motion audit (from the motion lab session)

Context: this repo already has a good spring system in `src/design/motion.ts` (Motion `spring(visualDuration, bounce)`). Audit found **three leaks** that break the iOS feel. Everything else is consistent.

---

## 1. `src/design/motion.ts` — pill width is a tween

```ts
// line ~62
get lyricWidth(): Transition {
  const factor = 0.25 + 0.75 * motionScale;
  if (reduceMotion || motionScale === 0) return { type: "tween", duration: 0.001, ease: "linear" };
  return { type: "tween", duration: 0.46 * factor * slow, ease: [0.42, 0, 0.58, 1] };
}
```

A fixed path/length restarts whenever the line changes mid-animation. Replace with a spring:

```ts
get lyricWidth(): Transition {
  return spring(0.40, 0.12);   // k ≈ 247, b ≈ 25, ζ ≈ 0.88
}
```

Tuning alternatives:
- too soft → `spring(0.34, 0.10)` (k ≈ 341)
- wants a touch of life → `spring(0.40, 0.18)`

---

## 2. `src/features/now-playing/LiveActivity.tsx` — lyric element is re-keyed

```tsx
// ~196
<AnimatePresence initial={false}>
  <motion.div
    key={`${props.index}-${props.animation}`}   // ← remounts every line
```

Re-keying unmounts the node, so **every spring restarts at zero**. Velocity handoff is impossible while this key exists.

Fix: one persistent `motion.div`, animate targets:

```tsx
<motion.div
  animate={{ opacity: 1, y: 0, scale: 1 }}
  initial={false}
  transition={springs.lyrics}
>
```

Keep `AnimatePresence` for the whole pill entering/leaving, not per line. If a crossfade between two lines is required, use two absolutely-positioned layers whose opacities are springs — do not remount.

Same applies to the word spans at `key={`${index}-${i}`}`: fine for an entrance stagger, but do not key by line if you want the words to carry motion across lines.

---

## 3. `src/styles/global.css` — leftover bezier transitions

```
235  transition: transform .24s cubic-bezier(.34,1.56,.64,1), opacity .25s, filter .25s;
237  .lab-base { transition: color .26s, text-shadow .26s; }
275  transition: transform .72s cubic-bezier(.16,1,.3,1) var(--d,0ms), opacity .5s …
301  transition: opacity .35s;
347  transition: color .35s ease, text-shadow .35s ease;
```

If these are used by the **live pill**, they bypass the spring system. If they only power settings previews, tag the block with a comment saying so, so nobody tunes them thinking they affect the product.

---

## 4. Motion preset setting — architecture recommendation

**Do not ship three independent toggles.** Smooth / Snappy / Bouncy are three values of the *same* parameter (damping ratio), so they are mutually exclusive. Three switches would allow “smooth + bouncy”, which is meaningless.

### Recommended UI

A single segmented control:

```
Motion personality   [ Smooth | Snappy | Bouncy ]
                     (currently: Snappy)
```

Plus an optional **Advanced** disclosure:

```
Response   [ 0.40 s ]   (0.20 – 0.80)
Bounce     [ 0.12   ]   (0 – 0.60)
```

Store one enum:

```ts
type MotionPreset = "smooth" | "snappy" | "bouncy";
// settings: appearance.motionPreset
```

### Mapping

The preset changes **character (bounce)**, not the duration of each surface. Each surface keeps its own `visualDuration`; the preset supplies the bounce.

| Preset | bounce | ζ | overshoot | personality |
|---|---|---|---|---|
| Smooth | 0.00 | 1.00 | 0 % | calm, no overshoot |
| Snappy | 0.15 | 0.85 | ~0.6 % | default, crisp |
| Bouncy | 0.40 | 0.60 | ~9.5 % | playful |

Implementation sketch:

```ts
const BOUNCE: Record<MotionPreset, number> = {
  smooth: 0, snappy: 0.15, bouncy: 0.40,
};

function spring(visualDuration: number, bounceOverride?: number): Transition {
  const bounce = bounceOverride ?? BOUNCE[preset];
  ...
}
```

Surfaces that must never bounce (`close`, `content`, exits) pass an explicit `bounce: 0` and ignore the preset.

### Why not a single global spring?

Because durations should differ by surface (shape 0.40, controls 0.24, exit 0.25). One global spring would make the whole UI feel either sluggish or twitchy. Preset = damping; per-surface = response.

### Scope: chrome only, **not lyrics**

The preset should apply to **interface chrome** — notch, pill *shape*, tabs, toggles, popovers, hovers — and **not** to lyric typography.

Reasons:

1. **Readability.** Overshoot on type reads as a mistake; a bouncy line can momentarily blur or collide with neighbours.
2. **Consistency of the reading experience.** Users read the same song twice; the lyrics should feel identical every time, independent of a personality switch.
3. **Lyrics are content, chrome is interface.** Personality belongs to the shell, not the words.

Implementation:

```ts
// lyrics ignore the preset and always use their tuned springs
get lyrics(): Transition      { return spring(0.46, 0); }
get lyricWord(): Transition   { return spring(0.52, 0.22); }
get lyricWidth(): Transition  { return spring(0.40, 0.12); }
```

Only `spring()` used by chrome reads `BOUNCE[preset]`.

If you want a lyrics control at all, make it **accessibility**, not personality:

```
Lyrics motion   [ Standard | Reduced ]
```

- Standard → the three springs above
- Reduced → `duration: 0.001`, no y-scale, opacity only

Do **not** offer Smooth/Snappy/Bouncy for lyrics.


---

## 5. Rubber band (if a drag is added)

```
offset = c·d·x / (d + c·x)     c = 0.55
```

Apply when a gesture exceeds a bound, then release into the spring with pointer velocity.

---

## 6. Acceptance checklist

- [ ] `lyricWidth` is a spring
- [ ] No per-line `key` on the lyric element
- [ ] Retargeting mid-resize keeps velocity
- [ ] One `motionPreset` enum, segmented control, no toggles
- [ ] Exits always faster than entrances
- [ ] `prefers-reduced-motion` path preserved
- [ ] `?slow=4` still works for tuning
- [ ] Any remaining CSS `transition` is either decorative (commented) or removed

---

## Final implementation in WinZal (this session)

- `Motion style` in **General** is now a two-way control: **Default / iOS**.
  `default` preserves the existing WinZal feel; `ios` applies one baked-in
  Apple damping profile to chrome only.
- Lyrics are fixed in both modes: `lyrics` 0.46/0, `lyricWord` 0.52/0.22,
  `lyricWidth` 0.40/0.12. The preset never touches lyric typography.
- `lyricWidth` is now a spring, so a line change mid-resize retargets.
- The per-line lyric element was intentionally **not** re-keyed: the existing
  lyric effects are heavily polished and would need a separate A/B rewrite.
- The Wave glow loop was rebuilt with periods that divide the 300-unit travel:
  back 100 units (3 periods), front 150 units (2 periods), so the animation
  lands on the same phase every loop with no visible seam.
- Remaining CSS lyric transitions stay as part of the polished lyric effects;
  chrome press feedback follows Default/iOS.
