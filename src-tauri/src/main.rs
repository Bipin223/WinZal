// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Elevated helper for FPS: owns the ETW session, normal notch only reads the
    // shared counters. Must run before run(), otherwise single-instance would hand
    // it to the running app.
    let args: Vec<String> = std::env::args().collect();
    if let [_, flag, pid] = args.as_slice() {
        if flag == "--fps-helper" {
            let pid = pid.parse().unwrap_or(0);
            winzal_lib::fps_helper(pid);
        }
    }
    winzal_lib::run()
}
