//! Click-through for the transparent notch window.
//!
//! Tauri can only make the whole window click-through, so a thread polls the
//! global cursor position and toggles `set_ignore_cursor_events` depending on
//! whether the cursor is over the hit zone reported by the frontend.
//! The `notch://hover` event replaces pointerenter/leave, because a click-through
//! WebView no longer gets mouse events.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

/// Hit zone in CSS px, relative to the WebView client area's top-left corner.
///
/// `vw`/`vh` are the WebView viewport in the same CSS px. They let the poll
/// convert the cursor through the real client size instead of trusting the
/// display scale factor, which can differ from the WebView's CSS mapping on
/// high-DPI or text-scaled laptops.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    #[serde(default)]
    vw: f64,
    #[serde(default)]
    vh: f64,
}

impl HitRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }

    /// Larger zone while something is dragged towards the notch, so files are easier
    /// to drop onto the small closed notch (quick drop).
    fn grown(&self) -> HitRect {
        HitRect {
            x: self.x - DROP_MARGIN,
            y: self.y,
            w: self.w + DROP_MARGIN * 2.0,
            h: self.h + DROP_MARGIN,
            ..*self
        }
    }
}

/// Physical px per CSS px along one axis. Falls back to the window scale when
/// the frontend has not reported its viewport yet.
fn axis_scale(css: f64, physical: u32, fallback: f64) -> f64 {
    if css > 1.0 && physical > 0 {
        physical as f64 / css
    } else {
        fallback.max(0.1)
    }
}

/// Extra margin of the drop zone in CSS px.
const DROP_MARGIN: f64 = 48.0;
/// Movement (CSS px) after the press before it counts as a drag.
const DRAG_START: f64 = 6.0;

#[derive(Default)]
pub struct HitState {
    rect: Mutex<HitRect>,
    /// While true (e.g. typing), the window stays clickable.
    pinned: Mutex<bool>,
    /// Ghost mode: fully click-through until three quick clicks wake it.
    silent: AtomicBool,
    /// Set after show(): reapply click-through on the next poll.
    refresh: AtomicBool,
}

impl HitState {
    pub fn refresh(&self) {
        self.refresh.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn set_hit_rect(rect: HitRect, state: State<'_, HitState>) {
    *state.rect.lock().unwrap() = rect;
}

#[tauri::command]
pub fn set_pinned(pinned: bool, state: State<'_, HitState>) {
    *state.pinned.lock().unwrap() = pinned;
}

/// Silent mode: the notch becomes a ghost and ignores the mouse. Three quick
/// clicks inside its old hit zone bring it back.
#[tauri::command]
pub fn set_silent(silent: bool, state: State<'_, HitState>) {
    state.silent.store(silent, Ordering::Relaxed);
    state.refresh();
}

/// ~60 Hz is plenty: hover delays are 180–220 ms anyway.
const POLL: Duration = Duration::from_millis(16);
/// Cursor far away from the notch (and no button held): poll slower. Reaching the
/// notch from `FAR` px away within one slow poll would take a very fast flick, and
/// the next poll near the notch is fast again.
const POLL_FAR: Duration = Duration::from_millis(50);
const FAR: f64 = 160.0;

pub fn spawn(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || {
        // `None` forces a defined state on the first pass.
        let mut last_inside: Option<bool> = None;
        let mut last_ignore: Option<bool> = None;
        let mut was_down = false;
        // Where the current press started; None = button up or the press began near the notch.
        let mut drag_from: Option<(f64, f64)> = None;
        let mut drag_active = false;
        let mut far = false;
        // Three-click wake while silent.
        let mut clicks = 0u32;
        let mut last_click = Instant::now();

        loop {
            thread::sleep(if far { POLL_FAR } else { POLL });
            far = false;
            let state = app.state::<HitState>();
            if state.refresh.swap(false, Ordering::Relaxed) {
                last_ignore = None;
            }
            let (Ok(cursor), Ok(origin), Ok(inner)) = (
                window.cursor_position(),
                window.inner_position(),
                window.inner_size(),
            ) else {
                continue;
            };

            // Map the cursor into the WebView's own CSS space. Deriving the
            // ratio from the actual client size (not scale_factor) keeps the
            // hit zone aligned on displays with fractional scaling or text
            // scaling, where the two can disagree by many pixels at the right
            // and bottom edges.
            let rect = *state.rect.lock().unwrap();
            let fallback = window.scale_factor().unwrap_or(1.0);
            let sx = axis_scale(rect.vw, inner.width, fallback);
            let sy = axis_scale(rect.vh, inner.height, fallback);
            let x = (cursor.x - origin.x as f64) / sx;
            let y = (cursor.y - origin.y as f64) / sy;
            let dragging = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000 != 0;
            let pressed = dragging && !was_down;
            // Edge distance to the hit zone; a held button keeps the fast poll (drags).
            let dx = (rect.x - x).max(x - (rect.x + rect.w)).max(0.0);
            let dy = (rect.y - y).max(y - (rect.y + rect.h)).max(0.0);
            far = !dragging && !was_down && dx.hypot(dy) > FAR;

            // Grow the zone only for a real drag that started away from the notch (a file
            // from Explorer). A plain click right below the notch must reach the app
            // underneath; growing on every press swallowed those clicks (issue #7).
            if dragging && !was_down {
                drag_from = (!rect.grown().contains(x, y)).then_some((x, y));
                drag_active = false;
            } else if !dragging {
                drag_from = None;
                drag_active = false;
            }
            if let Some((fx, fy)) = drag_from {
                drag_active |= (x - fx).hypot(y - fy) > DRAG_START;
            }
            was_down = dragging;

            let inside = if drag_active { rect.grown() } else { rect }.contains(x, y);
            let mut silent = state.silent.load(Ordering::Relaxed);
            if silent && inside && pressed {
                let now = Instant::now();
                clicks = if now.duration_since(last_click) <= Duration::from_millis(800) { clicks + 1 } else { 1 };
                last_click = now;
                if clicks >= 3 {
                    clicks = 0;
                    silent = false;
                    state.silent.store(false, Ordering::Relaxed);
                    let _ = window.emit("notch://silent-exit", ());
                }
            } else if !silent {
                clicks = 0;
            }
            let ignore = silent || (!inside && !*state.pinned.lock().unwrap());

            // Only call on change: every call goes through the event loop.
            if last_ignore != Some(ignore) {
                let _ = window.set_ignore_cursor_events(ignore);
                last_ignore = Some(ignore);
            }
            if last_inside != Some(inside && !silent) {
                let _ = window.emit("notch://hover", inside && !silent);
                last_inside = Some(inside && !silent);
            }
        }
    });
}
