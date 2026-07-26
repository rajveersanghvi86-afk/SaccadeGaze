use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Emitter,
};

#[tauri::command]
fn update_tray_state(app_handle: tauri::AppHandle, state: &str) {
    // Dynamically change the tray icon or state
    // (Green for Focus, Amber for warning, Red for drowsy)
    println!("State updated to: {}", state);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let open_i = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
            let pause_i = MenuItem::with_id(app, "pause", "Pause Monitoring", true, None::<&str>)?;
            let calib_i = MenuItem::with_id(app, "calib", "Recalibrate Gaze", true, None::<&str>)?;
            
            let menu = Menu::with_items(app, &[&open_i, &pause_i, &calib_i, &quit_i])?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            let icon = app.default_window_icon().cloned().unwrap();
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "pause" => {
                        let _ = app.emit("tray-pause", ());
                    }
                    "calib" => {
                        let _ = app.emit("tray-calibrate", ());
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // Intercept the close event to minimize to tray instead
                window.hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![update_tray_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
