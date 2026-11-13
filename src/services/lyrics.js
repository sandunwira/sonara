// Lyrics lookup via LRCLIB (https://lrclib.net). Results are cached in
// memory per artist/title so switching tracks back and forth does not refetch.
// Returns null when no usable lyrics exist (not found, instrumental, or the
// request failed — e.g. offline), so the UI can hide the lyrics section.

// Matches LRC timestamps like [01:23.45] or [01:23]; several may prefix one
// line ("[00:12.00][01:45.00] text").
const LRC_TIME_REGEX = /\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

export function parseSyncedLyrics(raw) {
	if (!raw) return [];
	const lines = [];

	for (const rawLine of String(raw).split(/\r?\n/)) {
		LRC_TIME_REGEX.lastIndex = 0;
		const timestamps = [];
		let match;
		let matchEnd = 0;
		while ((match = LRC_TIME_REGEX.exec(rawLine)) !== null) {
			const minutes = parseInt(match[1], 10);
			const seconds = parseFloat(match[2].replace(":", "."));
			if (!isFinite(minutes) || !isFinite(seconds)) continue;
			timestamps.push(minutes * 60 + seconds);
			matchEnd = match.index + match[0].length;
		}
		if (timestamps.length === 0) continue;

		// Text after the last timestamp (exec resets lastIndex to 0 on
		// failure, so the position must be tracked manually).
		const text = rawLine.slice(matchEnd).trim();
		for (const time of timestamps) {
			lines.push({ time, text });
		}
	}

	return lines.sort((a, b) => a.time - b.time);
}

import { getStoredLyrics, saveStoredLyrics } from "./jellyfinCache";

const lyricsCache = new Map();

export async function fetchLyrics(artist, title) {
	const artistName = String(artist || "").trim();
	const trackName = String(title || "").trim();
	if (!artistName || !trackName) return null;

	const cacheKey = `${artistName.toLowerCase()}::${trackName.toLowerCase()}`;
	if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

	// Persisted copy first: works offline and avoids refetching between runs.
	try {
		const stored = await getStoredLyrics(artistName, trackName);
		if (stored !== undefined) {
			lyricsCache.set(cacheKey, stored);
			return stored;
		}
	} catch (error) {
		console.warn("Could not read stored lyrics:", error);
	}

	let payload = null;
	let fetchFailed = false;
	try {
		const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artistName)}&track_name=${encodeURIComponent(trackName)}`;
		const response = await fetch(url, { headers: { Accept: "application/json" } });
		if (response.ok) {
			payload = await response.json();
		}
	} catch {
		fetchFailed = true;
	}

	let lyrics = null;
	if (payload && !payload.instrumental) {
		const synced = parseSyncedLyrics(payload.syncedLyrics);
		const plain = typeof payload.plainLyrics === "string" && payload.plainLyrics.trim()
			? payload.plainLyrics.trim()
			: null;
		// Time-synced lyrics win; plain text is the fallback.
		if (synced.length > 0) {
			lyrics = { synced, plain: null };
		} else if (plain) {
			lyrics = { synced: null, plain };
		}
	}

	if (!fetchFailed) {
		// Persist both found lyrics and confirmed "no lyrics" results, so
		// neither is re-requested in a later session. Network failures are not
		// cached so a session back online can retry.
		lyricsCache.set(cacheKey, lyrics);
		try {
			await saveStoredLyrics(artistName, trackName, lyrics);
		} catch (error) {
			console.warn("Could not persist lyrics:", error);
		}
	}

	return lyrics;
}
