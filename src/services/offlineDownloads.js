import { useSyncExternalStore, useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getDatabase } from "./jellyfinCache";
import { cleanUrl } from "./jellyfin";

// Offline downloads: tracks are fetched once from Jellyfin (the ORIGINAL
// file, byte-for-byte — never an mp3 transcode, so lossless sources keep
// their quality), stored under `<app data>/downloads/<track id>.<ext>` and
// recorded in the `downloaded_tracks` table. Every later download request
// for the same track on the same server is answered from that record
// instead of fetching again.

// Per-server memo of downloaded tracks: trackId -> record. Playback needs a
// SYNCHRONOUS local-file lookup when a track starts, so the table is loaded
// once per server and kept fresh on every download.
const downloadedMemo = new Map(); // serverUrl -> Map(trackId -> record)
const loadingPromises = new Map();

// --- Downloaded-tracks subscription (for React components) ---
// Memo maps are REPLACED (never mutated in place) so useSyncExternalStore
// sees an identity change and subscribed components re-render when a
// download finishes.
const downloadListeners = new Set();
const EMPTY_TRACKS = new Map();

function notifyDownloadListeners() {
	for (const listener of downloadListeners) listener();
}

function subscribeToDownloadedTracks(listener) {
	downloadListeners.add(listener);
	return () => downloadListeners.delete(listener);
}

function getDownloadedTracksSnapshot(serverUrl) {
	if (!serverUrl) return EMPTY_TRACKS;
	return downloadedMemo.get(serverUrl) || EMPTY_TRACKS;
}

// React hook: Map(trackId -> record) for the server, plus the async load
// kicked off on mount. Components re-render whenever a download completes.
export function useDownloadedTracks(serverUrl) {
	useEffect(() => {
		ensureDownloadedTracksLoaded(serverUrl);
	}, [serverUrl]);
	return useSyncExternalStore(
		subscribeToDownloadedTracks,
		() => getDownloadedTracksSnapshot(serverUrl),
		() => EMPTY_TRACKS,
	);
}

function rowToRecord(row) {
	return {
		trackId: row.track_id,
		filePath: row.file_path,
		fileName: row.file_name,
		fileSize: row.file_size,
		extension: row.extension,
		bitrate: row.bitrate,
		title: row.title,
		artist: row.artist,
		album: row.album,
		duration: row.duration,
		downloadedAt: row.downloaded_at,
	};
}

// Loads (once) the downloaded-tracks table for a server into the memo.
export async function ensureDownloadedTracksLoaded(serverUrl) {
	if (!serverUrl || !isTauri()) return null;
	const loaded = downloadedMemo.get(serverUrl);
	if (loaded) return loaded;
	const pending = loadingPromises.get(serverUrl);
	if (pending) return pending;

	const load = (async () => {
		const map = new Map();
		try {
			const database = await getDatabase();
			if (database) {
				const rows = await database.select(
					"SELECT track_id, file_path, file_name, file_size, extension, bitrate, title, artist, album, duration, downloaded_at FROM downloaded_tracks WHERE server_url = $1",
					[serverUrl],
				);
				for (const row of rows) {
					map.set(row.track_id, rowToRecord(row));
				}
			}
		} catch {
			// A failed read leaves the memo empty: nothing plays locally, but
			// remote streaming keeps working as before.
		}
		downloadedMemo.set(serverUrl, map);
		loadingPromises.delete(serverUrl);
		notifyDownloadListeners();
		return map;
	})();
	loadingPromises.set(serverUrl, load);
	return load;
}

// Synchronous lookup for the playback hot path. Call
// ensureDownloadedTracksLoaded() first (PlayerContext does on session load).
export function peekDownloadedTrack(serverUrl, trackId) {
	if (!serverUrl || !trackId) return null;
	return downloadedMemo.get(serverUrl)?.get(trackId) || null;
}

export async function getDownloadedTrack(serverUrl, trackId) {
	if (!serverUrl || !trackId) return null;
	await ensureDownloadedTracksLoaded(serverUrl);
	return peekDownloadedTrack(serverUrl, trackId);
}

// Downloads a track for offline use and records it in the database.
// Already-downloaded tracks resolve from the record without any network
// traffic. Returns `{ cached, ...record }`.
export async function downloadTrackOffline(session, track) {
	const serverUrl = session?.serverUrl;
	if (!serverUrl || !track?.id) {
		throw new Error("Connect to a Jellyfin server first");
	}
	if (!isTauri()) {
		throw new Error("Offline downloads require the desktop app");
	}

	await ensureDownloadedTracksLoaded(serverUrl);
	const existing = peekDownloadedTrack(serverUrl, track.id);
	if (existing) {
		return { cached: true, ...existing };
	}

	// The original-file endpoint: whatever format the library stores (FLAC,
	// ALAC, OGG, MP3, ...) comes down untouched — no transcoding, no quality
	// loss — and already-compressed lossless formats need no re-encoding.
	const url = `${cleanUrl(serverUrl)}/Items/${track.id}/Download?api_key=${encodeURIComponent(session.accessToken)}`;
	const fallbackName = `${track.artist || "Unknown Artist"} - ${track.title || "track"}`;
	const result = await invoke("download_track", {
		url,
		trackId: track.id,
		fallbackName,
	});

	const record = {
		trackId: track.id,
		filePath: result.path,
		fileName: result.fileName,
		fileSize: result.size ?? null,
		extension: result.extension || null,
		bitrate: track.raw?.Bitrate ?? null,
		title: track.title || "",
		artist: track.artist || "",
		album: track.album || "",
		duration: track.duration ?? null,
		downloadedAt: new Date().toISOString(),
	};

	const database = await getDatabase();
	if (database) {
		await database.execute(
			`INSERT INTO downloaded_tracks (server_url, track_id, file_path, file_name, file_size, extension, bitrate, title, artist, album, duration, downloaded_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT(server_url, track_id) DO UPDATE SET
				file_path = $3, file_name = $4, file_size = $5, extension = $6, bitrate = $7,
				title = $8, artist = $9, album = $10, duration = $11, downloaded_at = $12`,
			[
				serverUrl,
				record.trackId,
				record.filePath,
				record.fileName,
				record.fileSize,
				record.extension,
				record.bitrate,
				record.title,
				record.artist,
				record.album,
				record.duration,
				record.downloadedAt,
			],
		);
	}

	// Replace (not mutate) the memo map so subscribed components re-render.
	const previous = downloadedMemo.get(serverUrl);
	downloadedMemo.set(serverUrl, new Map(previous).set(track.id, record));
	notifyDownloadListeners();
	return { cached: false, ...record };
}
