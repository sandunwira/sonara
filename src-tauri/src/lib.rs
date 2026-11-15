mod functions;

use functions::*;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_jellyfin_response_cache",
            sql: "CREATE TABLE IF NOT EXISTS jellyfin_responses (
            cache_key TEXT PRIMARY KEY NOT NULL,
            data TEXT NOT NULL
        );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_jellyfin_session_storage",
            sql: "CREATE TABLE IF NOT EXISTS jellyfin_session (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_player_state_storage",
            sql: "CREATE TABLE IF NOT EXISTS app_state (
                state_key TEXT PRIMARY KEY NOT NULL,
                data TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_application_log_storage",
            sql: "CREATE TABLE IF NOT EXISTS app_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                level TEXT NOT NULL,
                source TEXT NOT NULL,
                message TEXT NOT NULL,
                details TEXT
            );
            CREATE INDEX IF NOT EXISTS app_logs_created_at_idx ON app_logs(created_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_jellyfin_server_list_storage",
            sql: "CREATE TABLE IF NOT EXISTS jellyfin_servers (
                server_url TEXT PRIMARY KEY NOT NULL,
                data TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_lyrics_cache_storage",
            sql: "CREATE TABLE IF NOT EXISTS lyrics_cache (
                cache_key TEXT PRIMARY KEY NOT NULL,
                data TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_fetched_at_to_response_cache",
            sql: "ALTER TABLE jellyfin_responses ADD COLUMN fetched_at TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "index_response_cache_by_fetched_at",
            sql: "CREATE INDEX IF NOT EXISTS jellyfin_responses_fetched_at_idx ON jellyfin_responses(fetched_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "create_library_thumbnail_storage",
            sql: "CREATE TABLE IF NOT EXISTS library_thumbnails (
                library_id TEXT PRIMARY KEY NOT NULL,
                data TEXT NOT NULL,
                generated_at TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .setup(|app| {
            let crash_database_path = app
                .path()
                .app_config_dir()
                .ok()
                .map(|directory| directory.join("sonara_cache.db"));
            if let Some(path) = crash_database_path.as_ref() {
                if let Some(directory) = path.parent() {
                    std::fs::create_dir_all(directory)?;
                }
            }

            let previous_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |panic_info| {
                previous_hook(panic_info);
                let Some(path) = crash_database_path.as_ref() else {
                    return;
                };
                let Ok(connection) = rusqlite::Connection::open(path) else {
                    return;
                };
                let _ = connection.busy_timeout(std::time::Duration::from_secs(2));
                let _ = connection.execute_batch(
                    "CREATE TABLE IF NOT EXISTS app_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at TEXT NOT NULL,
                        level TEXT NOT NULL,
                        source TEXT NOT NULL,
                        message TEXT NOT NULL,
                        details TEXT
                    );",
                );
                let _ = connection.execute(
                    "INSERT INTO app_logs (created_at, level, source, message)
                     VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'critical', 'native-panic', ?1)",
                    rusqlite::params![panic_info.to_string()],
                );
            }));

            #[cfg(desktop)]
            let _ = app
                .handle()
                .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}));

            // Taskbar thumbnail toolbar (previous / play-pause / next) shown in the Windows taskbar hover preview.
            // Button clicks are forwarded to the frontend as `thumbar:*` events, which PlayerContext handles.
            #[cfg(target_os = "windows")]
            {
                use tauri_plugin_thumbar::{Button, ThumbarExt};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = app.thumbar().initialize(
                        &window,
                        vec![
                            Button::new(1, "icons/thumbar/previous.ico")
                                .tooltip("Previous")
                                .event("thumbar:previous"),
                            Button::new(2, "icons/thumbar/play.ico")
                                .tooltip("Play")
                                .event("thumbar:toggle"),
                            Button::new(3, "icons/thumbar/next.ico")
                                .tooltip("Next")
                                .event("thumbar:next"),
                        ],
                        None,
                    );
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_thumbar::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:sonara_cache.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
