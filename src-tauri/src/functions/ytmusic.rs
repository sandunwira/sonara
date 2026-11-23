use std::time::Duration;

use serde::Serialize;

// YouTube Music's InnerTube endpoints send no CORS headers, so the webview
// cannot call them directly. This command performs the request natively and
// hands the response back to `yt-music-node`'s pluggable `fetch`.
//
// Keep the allow-list tight: this is only ever used for the YouTube Music
// client library, not as a general-purpose proxy.
fn is_allowed_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "youtube.com" || host.ends_with(".youtube.com")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxiedResponse {
    pub status: u16,
    pub status_text: String,
    /// Response headers as `[name, value]` pairs; the JS shim exposes them
    /// through a case-insensitive `get()`.
    pub headers: Vec<(String, String)>,
    pub body: String,
}

// Minimal `fetch` bridge for yt-music-node. Only the parts the library
// actually reads are modelled: status, statusText, headers.get() and text().
#[tauri::command]
pub async fn ytmusic_request(
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<ProxiedResponse, String> {
    if !is_allowed_url(&url) {
        return Err("Only YouTube Music requests are allowed".to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not start the request: {error}"))?;

    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("Unsupported HTTP method: {error}"))?;

    let mut request = client.request(method, &url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Network error: {error}"))?;

    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read the response: {error}"))?;

    Ok(ProxiedResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_string(),
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_https_youtube_hosts() {
        assert!(is_allowed_url("https://music.youtube.com/youtubei/v1/browse?alt=json"));
        assert!(is_allowed_url("https://www.youtube.com/"));
        assert!(!is_allowed_url("http://music.youtube.com/"));
        assert!(!is_allowed_url("https://music.youtube.com.evil.example/"));
        assert!(!is_allowed_url("https://example.com/"));
        assert!(!is_allowed_url("not a url"));
    }
}
