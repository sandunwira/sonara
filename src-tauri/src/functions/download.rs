use std::io::{Read, Write};
use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

// Windows forbids these characters in file names; everything else passes through.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            control if (control as u32) < 32 => ' ',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        "track".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

// RFC 5987 `filename*=UTF-8''...` wins; plain quoted `filename="..."` is the fallback.
fn parse_content_disposition(value: &str) -> Option<String> {
    for part in value.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename*=") {
            let encoded = rest.split("''").nth(1).unwrap_or(rest);
            return Some(percent_decode(encoded));
        }
    }
    for part in value.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename=") {
            return Some(rest.trim_matches('"').to_string());
        }
    }
    None
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                output.push(byte);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

// Container/extension for the stored file. The Content-Disposition file name
// is authoritative (Jellyfin's Download endpoint names it after the original
// file); the url path and the display name are fallbacks, `audio` the last
// resort so the file stays playable.
fn derive_extension(server_file_name: &str, url: &str, fallback_name: &str) -> String {
    let from = |name: &str| -> Option<String> {
        PathBuf::from(name)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .filter(|extension| !extension.is_empty())
    };
    if let Some(extension) = from(server_file_name) {
        return extension;
    }
    if let Some(extension) = from(url.split(['?', '#']).next().unwrap_or("")) {
        return extension;
    }
    if let Some(extension) = from(fallback_name) {
        return extension;
    }
    "audio".to_string()
}

// Metadata about a finished download, returned to the frontend so it can be
// recorded in the downloaded-tracks table.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    /// Absolute path of the stored file.
    pub path: String,
    /// Final file name, e.g. `<track id>.flac`.
    pub file_name: String,
    /// Size in bytes (counted while streaming).
    pub size: u64,
    /// Lowercase container/extension, e.g. `flac`.
    pub extension: String,
}

// Streams a track's ORIGINAL file from Jellyfin into the app's offline
// library (`<app data>/downloads/<track id>.<ext>`). The name is derived
// from the track id on purpose: the same track always writes the same file,
// so a re-download replaces the old copy instead of piling up duplicates,
// and the database can rely on a stable path per track. The file is stored
// byte-for-byte with no transcoding, so lossless sources (FLAC, ALAC, ...)
// keep their full quality — and lossless formats are already compressed,
// so disk usage stays reasonable without re-encoding.
#[tauri::command]
pub async fn download_track(
    app: tauri::AppHandle,
    url: String,
    track_id: String,
    fallback_name: String,
) -> Result<DownloadedFile, String> {
    let download_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data folder: {error}"))?
        .join("downloads");
    std::fs::create_dir_all(&download_dir)
        .map_err(|error| format!("Could not prepare the offline library folder: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || -> Result<DownloadedFile, String> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(|error| format!("Could not start the download: {error}"))?;

        let response = client
            .get(&url)
            .send()
            .map_err(|error| format!("Could not reach Jellyfin: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("Jellyfin returned HTTP {}", response.status()));
        }

        let server_file_name = response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_content_disposition)
            .unwrap_or_default();

        let extension = derive_extension(&server_file_name, &url, &fallback_name);
        let file_name = format!("{}.{}", sanitize_file_name(&track_id), extension);
        let target = download_dir.join(&file_name);

        let mut file = std::fs::File::create(&target)
            .map_err(|error| format!("Could not create the file: {error}"))?;

        let mut reader = response;
        let mut buffer = [0u8; 8192];
        let mut size: u64 = 0;
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|error| {
                    let _ = std::fs::remove_file(&target);
                    format!("Download failed: {error}")
                })?;
            if read == 0 {
                break;
            }
            if let Err(error) = file.write_all(&buffer[..read]) {
                let _ = std::fs::remove_file(&target);
                return Err(format!("Could not write the file: {error}"));
            }
            size += read as u64;
        }
        if let Err(error) = file.flush() {
            let _ = std::fs::remove_file(&target);
            return Err(format!("Could not finish writing the file: {error}"));
        }

        Ok(DownloadedFile {
            path: target.to_string_lossy().into_owned(),
            file_name,
            size,
            extension,
        })
    })
    .await
    .map_err(|error| format!("Download failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_windows_forbidden_characters() {
        assert_eq!(sanitize_file_name("AC/DC: Back In Black?*"), "AC DC  Back In Black");
        assert_eq!(sanitize_file_name("  . "), "track");
    }

    #[test]
    fn parses_content_disposition_variants() {
        assert_eq!(
            parse_content_disposition("attachment; filename=\"Song.mp3\""),
            Some("Song.mp3".to_string())
        );
        assert_eq!(
            parse_content_disposition("attachment; filename*=UTF-8''Caf%C3%A9.mp3"),
            Some("Café.mp3".to_string())
        );
        assert_eq!(parse_content_disposition("attachment"), None);
    }

    #[test]
    fn derives_extension_from_the_best_available_source() {
        // Content-Disposition wins.
        assert_eq!(derive_extension("song.flac", "/Items/x/Download", "a - b"), "flac");
        // Then the url path.
        assert_eq!(derive_extension("song", "/audio/track.ogg?api_key=1", "a - b"), "ogg");
        // Then the fallback name.
        assert_eq!(derive_extension("song", "/Items/x/Download", "a - b.m4a"), "m4a");
        // Last resort stays playable.
        assert_eq!(derive_extension("song", "/Items/x/Download", "a - b"), "audio");
    }
}
