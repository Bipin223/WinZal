import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { motion } from "motion/react";
import "./styles/global.css";
import "./lab.css";
import { LyricEffect } from "./features/now-playing/LyricEffect";
import { LyricGlow, LyricEqualizer } from "./features/now-playing/LyricVisualizer";
import { Equalizer } from "./features/now-playing/Equalizer";
import { springs } from "./design/motion";
import type { LyricAnimation, LyricEqualizerStyle, LyricGlowStyle } from "./settings/store";
import type { NowPlaying } from "./platform/media";

const LINE_SECONDS = 3.4;
const ACCENT = "#ffc46b";

const LINES = [
  "We will stand tall",
  "I left the lights on in the hallway",
  "Every word I never said [never said]",
  "Say it louder",
];

const ANIMATIONS: { value: LyricAnimation; label: string }[] = [
  { value: "word", label: "Word by Word" },
  { value: "fill", label: "Word fill sweep" },
  { value: "glitch", label: "Glitch scramble" },
  { value: "liquid", label: "Liquid fill" },
  { value: "spot", label: "Spotlight" },
  { value: "letters", label: "Letter bloom" },
  { value: "spark", label: "Spark" },
  { value: "orbit", label: "Orbit" },
  { value: "ambient", label: "Ambient" },
];

const GLOWS: { value: LyricGlowStyle; label: string }[] = [
  { value: "wave", label: "Wave" },
  { value: "bloom", label: "Bloom" },
  { value: "bokeh", label: "Bokeh" },
  { value: "leaves", label: "Leaves" },
  { value: "night", label: "Night sky" },
  { value: "none", label: "None" },
];

const EQUALIZERS: { value: LyricEqualizerStyle; label: string }[] = [
  { value: "bars", label: "Bars" },
  { value: "mirror", label: "Mirror" },
  { value: "ticks", label: "Ticks" },
];

function WordLine({ text, index }: { text: string; index: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  const stagger = words.length > 1 ? Math.min(0.36, Math.max(0.04, (LINE_SECONDS * 0.75) / (words.length - 1))) : 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", whiteSpace: "nowrap" }}>
      {words.map((word, i) => (
        <motion.span
          key={`${index}-${i}`}
          style={{ display: "inline-block" }}
          initial={{ opacity: 0.15, y: 5, scale: 0.92, filter: "blur(5px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ ...springs.lyricWord, delay: i * stagger + (i === 0 ? 0.02 : 0) }}
        >
          {word}
          {i < words.length - 1 ? "\u00A0" : ""}
        </motion.span>
      ))}
    </span>
  );
}

function Lab() {
  const params = new URLSearchParams(window.location.search);
  const requestedAnimation = params.get("anim") as LyricAnimation | null;
  const requestedGlow = params.get("glow") as LyricGlowStyle | null;
  const onlyGlow = params.get("only") as LyricGlowStyle | null;
  const locked = !!onlyGlow && GLOWS.some((item) => item.value === onlyGlow);
  const [animation, setAnimation] = useState<LyricAnimation>(
    requestedAnimation && ANIMATIONS.some((item) => item.value === requestedAnimation) ? requestedAnimation : "fill",
  );
  const [glow, setGlow] = useState<LyricGlowStyle>(
    locked ? onlyGlow : requestedGlow && GLOWS.some((item) => item.value === requestedGlow) ? requestedGlow : "wave",
  );
  const [equalizer, setEqualizer] = useState<LyricEqualizerStyle>("bars");
  const [playing, setPlaying] = useState(true);
  const [line, setLine] = useState(0);
  const [pausedAt, setPausedAt] = useState(0);
  const [morphKey, setMorphKey] = useState(0);
  const [, setTick] = useState(0);
  const lineStart = useRef(performance.now());

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - lineStart.current) / 1000;
      if (elapsed >= LINE_SECONDS) {
        lineStart.current = performance.now();
        setPausedAt(0);
        setLine((current) => (current + 1) % LINES.length);
      }
      setTick((tick) => tick + 1);
    }, 60);
    return () => window.clearInterval(id);
  }, [playing]);

  const np = useMemo<NowPlaying>(() => ({
    title: "Midnight City",
    artist: "M83",
    artwork: null,
    accent: ACCENT,
    isPlaying: playing,
    position: playing ? 0 : pausedAt,
    updatedAt: lineStart.current,
    duration: 300,
    canSeek: true,
    appId: "WinZal.Lab",
  }), [playing, pausedAt, line]);

  const elapsed = playing
    ? Math.min(LINE_SECONDS, (performance.now() - lineStart.current) / 1000)
    : pausedAt;
  const text = LINES[line];
  const pillWidth = Math.min(640, Math.max(300, 176 + text.length * 7.1));

  const toggle = () => {
    if (playing) {
      setPausedAt(Math.min(LINE_SECONDS, (performance.now() - lineStart.current) / 1000));
      setPlaying(false);
    } else {
      lineStart.current = performance.now() - pausedAt * 1000;
      setPlaying(true);
    }
  };

  const lineHost = animation === "word" ? (
    <WordLine text={text} index={line} />
  ) : (
    <LyricEffect
      key={`${line}-${animation}`}
      animation={animation}
      text={text}
      index={line}
      start={0}
      end={LINE_SECONDS}
      np={np}
    />
  );

  return (
    <div className="lab-page" style={{ "--accent": ACCENT } as CSSProperties}>
      <h1>WinZal · Lyric Lab</h1>
      <p className="sub">
        Real components, simulated line clock. {LINE_SECONDS.toFixed(1)} s per line. No overlap.
      </p>

      {!locked && (
      <div className="lab-controls">
        <div className="lab-group">
          <span className="lab-group-label">Lyrics</span>
          {ANIMATIONS.map((item) => (
            <button
              key={item.value}
              className={`lab-chip ${animation === item.value ? "on" : ""}`}
              onClick={() => setAnimation(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="lab-group">
          <span className="lab-group-label">Glow</span>
          {GLOWS.map((item) => (
            <button
              key={item.value}
              className={`lab-chip ${glow === item.value ? "on" : ""}`}
              onClick={() => setGlow(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="lab-group">
          <span className="lab-group-label">Equalizer</span>
          <select
            value={equalizer}
            onChange={(event) => setEqualizer(event.target.value as LyricEqualizerStyle)}
            style={{ background: "#0d1118", color: "#dbe3ef", border: "1px solid #222a3a", borderRadius: 8, padding: "5px 8px", fontSize: 11 }}
          >
            {EQUALIZERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div className="lab-group">
          <button className="lab-chip" onClick={toggle}>{playing ? "Pause" : "Play"}</button>
          <button className="lab-chip" onClick={() => setMorphKey((key) => key + 1)}>Replay morph</button>
        </div>
      </div>
      )}

      <div className="lab-stage">
        <div className="lab-card">
          <div className="lab-card-title">Closed pill · full-pill glow</div>
          <div className="lab-closed-wrap">
            <div className="lab-closed" style={{ width: pillWidth }}>
              <div className="lab-full-glow">
                <LyricGlow style={glow} playing={playing} />
              </div>
              <span className="lab-art" />
              <div className="lab-text">
                <span className="relative z-10">{lineHost}</span>
              </div>
              <span className="lab-eq">
                {equalizer === "bars" ? <Equalizer playing={playing} height={14} /> : <LyricEqualizer style={equalizer} playing={playing} />}
              </span>
            </div>
          </div>
        </div>

        <div className="lab-card">
          <div className="lab-card-title">Expanded Music · same visualization</div>
          <div className="lab-expanded-shell">
            <div className="lab-expanded np-now">
              <motion.div
                key={morphKey}
                className={`np-glow np-glow-${glow} pointer-events-none absolute inset-0 origin-top`}
                initial={{ opacity: 0.55, scaleX: 0.72, scaleY: 0.5, y: -6, filter: "blur(14px)" }}
                animate={{ opacity: 1, scaleX: 1, scaleY: 1, y: 0, filter: "blur(0px)" }}
                transition={{ type: "spring", stiffness: 170, damping: 22, mass: 0.9 }}
              >
                <LyricGlow style={glow} playing={playing} expanded />
              </motion.div>
              <div className="lab-expanded-content">
                <div className="lab-expanded-head">
                  <span className="lab-expanded-art" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="lab-expanded-title">Midnight City</div>
                    <div className="lab-expanded-artist">M83</div>
                  </div>
                  {equalizer === "bars" ? <Equalizer playing={playing} height={18} /> : <LyricEqualizer style={equalizer} playing={playing} />}
                </div>
                <div className="lab-expanded-progress"><i style={{ width: `${(elapsed / LINE_SECONDS) * 100}%` }} /></div>
                <div className="lab-expanded-times"><span>0:45</span><span>-3:03</span></div>
                <div className="lab-expanded-controls">
                  <span>⏮</span><span>{playing ? "⏸" : "▶"}</span><span>⏭</span>
                </div>
              </div>
            </div>
            <div className="lab-dock">
              <span>▦</span><span style={{ color: ACCENT }}>♪</span><span>◷</span><span>◌</span><span>✓</span><span>▤</span><span>▣</span><span>⌕</span><span>☁</span><span>◉</span><span>⚙</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Lab />);
