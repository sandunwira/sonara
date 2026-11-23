// Artist profiles from YouTube Music (via yt-music-node). The library uses
// YouTube's InnerTube API, which sends no CORS headers, so every request is
// routed through the `ytmusic_request` Tauri command. Profiles are cached in
// memory per artist name and persisted in the local database, so switching
// tracks back and forth (or restarting the app) does not refetch them.
//
// Returns null when no profile can be resolved (artist not found, offline, or
// not running inside the desktop app), so the UI can hide the section.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { getStoredYtMusicArtist, saveStoredYtMusicArtist } from "./jellyfinCache";

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });

// ---------------------------------------------------------------- transport

// Bridges yt-music-node's pluggable `fetch` to the Rust command. Only the
// parts the library reads are modelled: ok/status/statusText/headers.get/text.
async function tauriFetch(input, init = {}) {
	if (init.signal?.aborted) throw init.signal.reason ?? new Error("Request aborted");

	const headers = [];
	const rawHeaders = init.headers;
	if (rawHeaders instanceof Headers) {
		rawHeaders.forEach((value, name) => headers.push([name, value]));
	} else if (Array.isArray(rawHeaders)) {
		for (const [name, value] of rawHeaders) headers.push([String(name), String(value)]);
	} else if (rawHeaders) {
		for (const [name, value] of Object.entries(rawHeaders)) headers.push([name, String(value)]);
	}

	const response = await invoke("ytmusic_request", {
		url: String(input),
		method: init.method || "GET",
		headers,
		body: typeof init.body === "string" ? init.body : null,
	});

	const responseHeaders = new Map(
		(response.headers || []).map(([name, value]) => [String(name).toLowerCase(), value]),
	);

	return {
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		statusText: response.statusText,
		headers: {
			get: (name) => responseHeaders.get(String(name).toLowerCase()) ?? null,
		},
		text: async () => response.body,
	};
}

let clientPromise = null;

// yt-music-node is loaded on demand: its InnerTube client is a sizeable
// chunk and most sessions never open the queue panel.
function getClient() {
	if (!isTauri()) return Promise.resolve(null);
	if (!clientPromise) {
		clientPromise = import("yt-music-node")
			.then(({ YTMusic }) => new YTMusic({ fetch: tauriFetch }))
			.catch((error) => {
				clientPromise = null;
				throw error;
			});
	}
	return clientPromise;
}

// ---------------------------------------------------------------- helpers

function normalizeName(name) {
	return String(name || "")
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");
}

export function splitArtistNames(artist) {
	const names = String(artist || "")
		.split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)
		.map((name) => name.trim())
		.filter(Boolean);
	const seen = new Set();
	return names.filter((name) => {
		const key = normalizeName(name);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// Thumbnail lists are ordered smallest to largest; the last usable one is the
// sharpest image the artist page provides.
function pickThumbnail(thumbnails) {
	if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
	for (let index = thumbnails.length - 1; index >= 0; index -= 1) {
		if (thumbnails[index]?.url) return thumbnails[index].url;
	}
	return null;
}

function firstSentence(description) {
	if (typeof description !== "string") return null;
	const sentences = Array.from(sentenceSegmenter.segment(description), ({ segment }) => segment.trim())
		.filter(Boolean)
		.slice(0, 1);
	return sentences.length > 0 ? sentences.join(" ") : null;
}

function getArtistProfileUrl(channelId) {
	return channelId ? `https://music.youtube.com/channel/${encodeURIComponent(channelId)}` : null;
}

// Jellyfin credits can be "Artist A, Artist B" or "Artist A feat. Artist B".
// Try the full credit first, then each leading segment on its own.
function artistQueries(artist) {
	const full = String(artist || "").trim();
	if (!full) return [];
	const first = splitArtistNames(full)[0];
	return first && normalizeName(first) !== normalizeName(full) ? [full, first] : [full];
}

function normalizeProfile(artist, resolvedChannelId) {
	const channelId = artist.channelId || resolvedChannelId || null;
	return {
		channelId,
		profileUrl: getArtistProfileUrl(channelId),
		name: artist.name || null,
		description: firstSentence(artist.description),
		thumbnail: pickThumbnail(artist.thumbnails),
	};
}

// Resolve a Jellyfin artist credit to a YouTube Music channel id. Song search
// results carry the credited artists, so an exact name match avoids latching
// onto a cover/tribute channel.
async function resolveChannelId(ytm, artistName) {
	const wanted = normalizeName(artistName);

	for (const query of artistQueries(artistName)) {
		const results = await ytm.search(query, { filter: "songs", limit: 5 });
		for (const result of results) {
			for (const ref of result.artists || []) {
				if (ref?.id && normalizeName(ref.name) === wanted) return ref.id;
			}
		}
		const fallback = results.find((result) => result.artists?.[0]?.id)?.artists?.[0]?.id;
		if (fallback) return fallback;
	}

	return null;
}

// ---------------------------------------------------------------- public API

const profileCache = new Map();
const inFlight = new Map();

export function getCachedArtistProfile(artist) {
	const key = normalizeName(artist);
	return key ? profileCache.get(key) : undefined;
}

export async function fetchArtistProfile(artist) {
	const key = normalizeName(artist);
	if (!key) return null;

	if (profileCache.has(key)) return profileCache.get(key);
	if (inFlight.has(key)) return inFlight.get(key);

	const pending = (async () => {
		// Persisted copy first: works offline and avoids refetching between runs.
		try {
			const stored = await getStoredYtMusicArtist(artist);
			if (stored !== undefined) {
				const profile = stored && typeof stored === "object"
					? {
						...stored,
						profileUrl: getArtistProfileUrl(stored.channelId),
						description: firstSentence(stored.description),
					}
					: stored;
				profileCache.set(key, profile);
				if (
					profile
					&& (profile.description !== stored.description || profile.profileUrl !== stored.profileUrl)
				) {
					try {
						await saveStoredYtMusicArtist(artist, profile);
					} catch (error) {
						console.warn(`Could not update stored artist profile for ${artist}:`, error);
					}
				}
				return profile;
			}
		} catch (error) {
			console.warn(`Could not read stored artist profile for ${artist}:`, error);
		}

		try {
			// Loaded only once a profile actually has to be fetched.
			const ytm = await getClient();
			if (!ytm) {
				profileCache.set(key, null);
				return null;
			}

			const channelId = await resolveChannelId(ytm, artist);
			if (!channelId) {
				// Remember the miss for this session, but do not persist it: the
				// channel may appear later or the lookup may have been partial.
				profileCache.set(key, null);
				return null;
			}

			const profile = normalizeProfile(await ytm.getArtist(channelId), channelId);
			if (!profile.name) return null;

			profileCache.set(key, profile);
			try {
				await saveStoredYtMusicArtist(artist, profile);
			} catch (error) {
				console.warn(`Could not persist artist profile for ${artist}:`, error);
			}
			return profile;
		} catch (error) {
			// Network errors are not cached so a later attempt can retry.
			console.warn(`Could not load the YouTube Music profile for ${artist}:`, error);
			return null;
		}
	})().finally(() => {
		inFlight.delete(key);
	});

	inFlight.set(key, pending);
	return pending;
}
