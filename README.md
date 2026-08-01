# Sonara

Sonara is a lightweight Windows music player for Jellyfin servers, with fast native feel and a modern UI. It focuses on music-first playback, including features like crossfading, offline downloads, queue management, and a polished library experience.

## Features

- Jellyfin music streaming.
- Crossfading between tracks.
- Offline downloads for albums, playlists, and tracks.
- Fast search and library browsing.
- Persistent playback queue.
- Lyrics and playback history.
- Keyboard shortcuts and media key support.

## Platform

- Windows 10 and later.

## Tech Stack

- **Frontend:** React (JSX) + Vite.
- **Desktop shell:** Tauri.
- **Backend:** Rust.
- **Local storage:** SQLite.

## Core Capabilities

### Streaming
Stream your Jellyfin music library with low-latency playback and smooth buffering.

### Crossfade
Blend tracks together with configurable crossfade duration for a seamless listening experience.

### Offline Mode
Download music locally and listen without an internet connection.

### Library Sync
Keep your local metadata cache aligned with your Jellyfin server.

### Playback Control
Play, pause, skip, seek, shuffle, repeat, and manage your queue from the player.

## Development Goals

- Small application footprint.
- Fast startup time.
- Smooth UI and playback.
- Clean separation between frontend and backend.
- Reliable offline support.

## Getting Started

> This project is currently in planning or early development.

### Prerequisites

- Windows 10 or newer.
- Node.js.
- Rust toolchain.
- WebView2 runtime.
- Jellyfin server.

## Roadmap

- Jellyfin authentication.
- Library browsing and search.
- Basic playback engine.
- Queue management.
- Crossfade support.
- Offline downloads.
- Lyrics support.
- System tray integration.
- Auto-updates and release packaging.

## Contributing

Contributions are welcome once the repository is public. Suggested areas:

- UI/UX.
- Playback engine.
- Offline download management.
- Windows integration.
- Jellyfin sync logic.

## License

MIT License. See [LICENSE](LICENSE) for details.
