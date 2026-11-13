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
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:sonara_cache.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
