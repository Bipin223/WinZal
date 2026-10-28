//! Short iPhone-style cues when the charger is connected or removed.
//!
//! The tones are generated locally (two-note rising chime on plug-in, a soft
//! falling blip on unplug) and played through winmm. Generating them avoids
//! shipping copyrighted Apple audio and keeps the MSIX small.

use std::thread;
use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::Media::Audio::{PlaySoundW, SND_MEMORY, SND_NODEFAULT, SND_SYNC};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

const RATE: u32 = 44_100;

pub fn spawn() {
    thread::spawn(move || {
        let mut last: Option<u8> = None;
        loop {
            let mut status = SYSTEM_POWER_STATUS::default();
            let ok = unsafe { GetSystemPowerStatus(&mut status) }.is_ok();
            let ac = ok.then_some(status.ACLineStatus).filter(|v| *v <= 1);
            if let (Some(previous), Some(current)) = (last, ac) {
                if current != previous {
                    play(current == 1);
                }
            }
            if let Some(current) = ac {
                last = Some(current);
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
}

fn play(plugged: bool) {
    let samples = if plugged { plug_chime() } else { unplug_blip() };
    let wav = wav_bytes(&samples);
    unsafe {
        let _ = PlaySoundW(
            PCWSTR(wav.as_ptr() as *const u16),
            None,
            SND_MEMORY | SND_SYNC | SND_NODEFAULT,
        );
    }
}

fn envelope(t: f32, attack: f32, decay: f32) -> f32 {
    (t / attack).min(1.0) * (-t * decay).exp()
}

fn add_note(buf: &mut [f32], start: f32, duration: f32, freq: f32, amp: f32, decay: f32) {
    let begin = (start * RATE as f32) as usize;
    let count = (duration * RATE as f32) as usize;
    for i in 0..count {
        let t = i as f32 / RATE as f32;
        let phase = std::f32::consts::TAU * freq * t;
        // Fundamental plus a quiet octave gives the chime a bell-like edge.
        let sample = (phase.sin() + 0.22 * (phase * 2.0).sin()) * envelope(t, 0.004, decay) * amp;
        if let Some(value) = buf.get_mut(begin + i) {
            *value += sample;
        }
    }
}

/// Rising two-note chime, close to the iPhone power-connect cue.
fn plug_chime() -> Vec<f32> {
    let mut buf = vec![0.0; (0.42 * RATE as f32) as usize];
    add_note(&mut buf, 0.0, 0.20, 1046.5, 0.20, 16.0);
    add_note(&mut buf, 0.085, 0.30, 1568.0, 0.17, 11.0);
    add_note(&mut buf, 0.16, 0.22, 2093.0, 0.05, 18.0);
    buf
}

/// Soft falling blip when the cable is removed.
fn unplug_blip() -> Vec<f32> {
    let seconds = 0.13;
    let count = (seconds * RATE as f32) as usize;
    let mut buf = vec![0.0; count];
    let mut phase = 0.0f32;
    for i in 0..count {
        let t = i as f32 / RATE as f32;
        let freq = 620.0 - 290.0 * (t / seconds);
        phase += std::f32::consts::TAU * freq / RATE as f32;
        buf[i] = phase.sin() * envelope(t, 0.003, 34.0) * 0.14;
    }
    buf
}

fn wav_bytes(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}
