import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

const DATABASE_URL = "sqlite:sonara_cache.db";

let databasePromise;

// Shared by this module and the offline downloads service (same database).
export async function getDatabase() {
	if (!isTauri()) return null;
	if (!databasePromise) {
		databasePromise = Database.load(DATABASE_URL)
			.then((database) => {
				// Keep the cache healthy without any manual maintenance: once per
				// app session, trim size and vacuum freed pages. Deferred so the
				// startup scan does not compete with session/queue/bootstrap reads.
				setTimeout(() => {
					maintainJellyfinCache().catch(() => {});
				}, 5000);
				return database;
			})
			.catch((error) => {
				databasePromise = undefined;
				throw error;
			});
	}
	return databasePromise;
}

async function readEntry(key) {
	const database = await getDatabase();
	if (!database) return undefined;

	const rows = await database.select(
		"SELECT data FROM jellyfin_responses WHERE cache_key = $1",
		[key],
	);
	if (rows.length === 0) return undefined;

	const data = JSON.parse(rows[0].data);
	return data;
}

// Jellyfin DTOs carry several heavyweight fields the app never reads
// (MediaSources/MediaStreams dominate, often >80% of each item). Stripping
// them at cache-write time keeps the database small without changing
// anything the offline fallback paths consume.
const CACHE_TRIMMED_FIELDS = new Set(["MediaSources", "MediaStreams"]);

function trimForCache(value, depth = 0) {
	if (!value || typeof value !== "object") return value;
	if (depth > 5) return value;
	if (Array.isArray(value)) {
		return value.map((item) => trimForCache(item, depth + 1));
	}
	const trimmed = {};
	for (const [field, fieldValue] of Object.entries(value)) {
		if (CACHE_TRIMMED_FIELDS.has(field)) continue;
		trimmed[field] = trimForCache(fieldValue, depth + 1);
	}
	return trimmed;
}

// Parsed snapshots are memoized per server/user: offline fallbacks call this
// several times per page load (tracks, artists, libraries, genres), and
// re-reading + re-parsing every cached response each time is expensive.
const cachedItemsMemo = new Map();

function invalidateCachedJellyfinItems() {
	cachedItemsMemo.clear();
}

export async function getCachedJellyfinItems(serverUrl, userId) {
	const database = await getDatabase();
	if (!database) return [];

	const memoKey = `${serverUrl}::${userId}`;
	const memoized = cachedItemsMemo.get(memoKey);
	if (memoized) return memoized;

	const load = (async () => {
		const rows = await database.select("SELECT cache_key, data FROM jellyfin_responses");
		const server = new URL(serverUrl);
		const serverPath = server.pathname.replace(/\/+$/, "");
		const itemsById = new Map();
		for (const row of rows) {
			const request = new URL(row.cache_key);
			const isForServerPath = !serverPath
				|| request.pathname === serverPath
				|| request.pathname.startsWith(`${serverPath}/`);
			const isForUser = request.searchParams.get("userId") === userId
				|| request.pathname.startsWith(`${serverPath}/Users/${userId}/`);
			if (request.origin !== server.origin || !isForServerPath || !isForUser) continue;

			const payload = JSON.parse(row.data);
			for (const item of payload.Items || []) {
				if (!item?.Id) continue;
				const previous = itemsById.get(item.Id);
				// Cache entries written from different endpoints carry different
				// field sets; keep the widest copy. Comparing key counts is far
				// cheaper than serializing both items just to compare lengths.
				if (!previous || Object.keys(item).length > Object.keys(previous).length) {
					itemsById.set(item.Id, item);
				}
			}
		}
		return [...itemsById.values()];
	})();

	cachedItemsMemo.set(memoKey, load);
	load.catch(() => {
		if (cachedItemsMemo.get(memoKey) === load) cachedItemsMemo.delete(memoKey);
	});
	return load;
}

export async function readJellyfinCacheEntry(key) {
	return readEntry(key);
}

// Bulk cache read used by paginated endpoints: resolves every cached page in
// one indexed IN(...) query per chunk instead of one round-trip per page.
// Returns a Map of cache key -> parsed payload for the keys that exist.
export async function readCachedJellyfinEntries(keys) {
	const result = new Map();
	if (!Array.isArray(keys) || keys.length === 0) return result;
	const database = await getDatabase();
	if (!database) return result;

	// SQLite caps bound parameters (999 by default), so read in safe chunks.
	const chunkSize = 200;
	for (let index = 0; index < keys.length; index += chunkSize) {
		const chunk = keys.slice(index, index + chunkSize);
		const placeholders = chunk.map((_, offset) => `$${offset + 1}`).join(", ");
		const rows = await database.select(
			`SELECT cache_key, data FROM jellyfin_responses WHERE cache_key IN (${placeholders})`,
			chunk,
		);
		for (const row of rows) {
			try {
				result.set(row.cache_key, JSON.parse(row.data));
			} catch {
				// Corrupt entries are treated as cache misses.
			}
		}
	}
	return result;
}

const SYNC_MARKER_PREFIX = "jellyfin_sync:";

function syncMarkerKey(serverUrl, userId) {
	return `${SYNC_MARKER_PREFIX}${serverUrl.replace(/\/+$/, "").toLowerCase()}:${userId}`;
}

export async function isJellyfinLibrarySynced(serverUrl, userId) {
	const database = await getDatabase();
	if (!database) return false;

	const rows = await database.select(
		"SELECT data FROM app_state WHERE state_key = $1",
		[syncMarkerKey(serverUrl, userId)],
	);
	return rows.length > 0;
}

export async function markJellyfinLibrarySynced(serverUrl, userId) {
	const database = await getDatabase();
	if (!database) {
		throw new Error("Jellyfin library sync requires the Sonara desktop app");
	}

	await database.execute(
		`INSERT INTO app_state (state_key, data)
		 VALUES ($1, $2)
		 ON CONFLICT(state_key) DO UPDATE SET data = excluded.data`,
		[syncMarkerKey(serverUrl, userId), JSON.stringify({ syncedAt: new Date().toISOString() })],
	);
}

// The response cache is kept bounded so it can never grow unbounded:
// when the entry count or total size exceeds the caps, the oldest
// entries (by fetched_at) are evicted and the database is vacuumed to
// return the freed pages to the OS. Runs automatically at app start and
// after every library sync.
const MAX_CACHE_ENTRIES = 500;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;

export async function maintainJellyfinCache() {
	const database = await getDatabase();
	if (!database) return { evictedEntries: 0 };

	const rows = await database.select(
		"SELECT cache_key, LENGTH(data) AS size FROM jellyfin_responses ORDER BY COALESCE(fetched_at, '') ASC, cache_key ASC",
	);
	let remaining = rows.length;
	let totalBytes = rows.reduce((sum, row) => sum + (row.size || 0), 0);
	if (remaining <= MAX_CACHE_ENTRIES && totalBytes <= MAX_CACHE_BYTES) {
		return { evictedEntries: 0 };
	}

	const staleKeys = [];
	for (const row of rows) {
		if (remaining <= MAX_CACHE_ENTRIES && totalBytes <= MAX_CACHE_BYTES) break;
		staleKeys.push(row.cache_key);
		remaining -= 1;
		totalBytes -= row.size || 0;
	}

	const chunkSize = 40;
	for (let index = 0; index < staleKeys.length; index += chunkSize) {
		const chunk = staleKeys.slice(index, index + chunkSize);
		const placeholders = chunk.map((_, offset) => `$${offset + 1}`).join(", ");
		await database.execute(
			`DELETE FROM jellyfin_responses WHERE cache_key IN (${placeholders})`,
			chunk,
		);
	}
	try {
		await database.execute("VACUUM");
	} catch {
		// Vacuum can fail if a query is mid-flight; the freed pages are
		// simply reclaimed on a later maintenance run.
	}
	invalidateCachedJellyfinItems();
	return { evictedEntries: staleKeys.length };
}

async function writeEntry(key, data) {
	const database = await getDatabase();
	if (!database) return;

	await database.execute(
		`INSERT INTO jellyfin_responses (cache_key, data, fetched_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
		[key, JSON.stringify(trimForCache(data)), new Date().toISOString()],
	);
	invalidateCachedJellyfinItems();
	if (syncKeyCapture) syncKeyCapture.add(key);
}

// During a manual library sync, capture the keys freshly written from the
// server so every cached response that was NOT rewritten can be purged as
// stale data once the sync succeeds.
let syncKeyCapture = null;

export function startJellyfinSyncCapture() {
	syncKeyCapture = new Set();
}

export function cancelJellyfinSyncCapture() {
	syncKeyCapture = null;
}

export async function finishJellyfinSyncCapture(serverUrl) {
	const touchedKeys = syncKeyCapture;
	syncKeyCapture = null;
	if (!touchedKeys) return { removedStaleEntries: 0 };

	const database = await getDatabase();
	if (!database) return { removedStaleEntries: 0 };

	const server = new URL(serverUrl);
	const serverPath = server.pathname.replace(/\/+$/, "");
	const rows = await database.select("SELECT cache_key FROM jellyfin_responses");
	const staleKeys = rows
		.map((row) => row.cache_key)
		.filter((key) => {
			const request = new URL(key);
			const isForServer = request.origin === server.origin
				&& (!serverPath
					|| request.pathname === serverPath
					|| request.pathname.startsWith(`${serverPath}/`));
			return isForServer && !touchedKeys.has(key);
		});

	const chunkSize = 40;
	for (let index = 0; index < staleKeys.length; index += chunkSize) {
		const chunk = staleKeys.slice(index, index + chunkSize);
		const placeholders = chunk.map((_, offset) => `$${offset + 1}`).join(", ");
		await database.execute(
			`DELETE FROM jellyfin_responses WHERE cache_key IN (${placeholders})`,
			chunk,
		);
	}
	await maintainJellyfinCache();
	invalidateCachedJellyfinItems();
	return { removedStaleEntries: staleKeys.length };
}

// Identical requests issued while another is still in flight (for example
// the connect flow and the auth effect both loading the library, or a page
// and a sync hitting the same endpoint) share one network response.
const inFlightRequests = new Map();

async function requestJellyfinJson(url, headers, database) {
	let response;
	try {
		response = await fetch(url, {
			method: "GET",
			headers,
			cache: "no-store",
		});
	} catch (error) {
		await recordAppLog("error", "jellyfin-http", "Jellyfin request failed", {
			path: new URL(url).pathname,
			message: error.message,
		});
		throw error;
	}

	if (response.ok) {
		const data = await response.json();
		if (database) await writeEntry(url, data);
		return { ok: true, status: response.status, statusText: response.statusText, data };
	}

	await recordAppLog("error", "jellyfin-http", "Jellyfin returned an error response", {
		path: new URL(url).pathname,
		status: response.status,
	});
	return { ok: false, status: response.status, statusText: response.statusText, data: null };
}

// Mutating playlist membership (add track / create playlist) changes server
// state the response cache cannot know about: drop every cached entry keyed
// by the playlist id so its items query and detail refetch fresh data.
export async function invalidateJellyfinPlaylistEntries(playlistId) {
	const database = await getDatabase();
	if (!database || !playlistId) return;

	const result = await database.execute(
		"DELETE FROM jellyfin_responses WHERE cache_key LIKE $1",
		[`%${playlistId}%`],
	);
	if ((result?.rowsAffected ?? 0) > 0) invalidateCachedJellyfinItems();
}

// Favorites are user-mutable server state the response cache cannot know
// about: after a favorite toggle, drop every cached entry that carries
// favorite state — the IsFavorite-filtered collection responses and any
// item detail keyed by the item id — so the next read refetches fresh data.
export async function invalidateJellyfinFavoriteEntries(itemId = null) {
	const database = await getDatabase();
	if (!database) return;

	const patterns = ["%IsFavorite=true%"];
	if (itemId) patterns.push(`%${itemId}%`);
	let deleted = 0;
	for (const pattern of patterns) {
		const result = await database.execute(
			"DELETE FROM jellyfin_responses WHERE cache_key LIKE $1",
			[pattern],
		);
		deleted += result?.rowsAffected ?? 0;
	}
	if (deleted > 0) invalidateCachedJellyfinItems();
}

export async function fetchCachedJellyfinJson(url, headers, { forceRefresh = false } = {}) {
	const key = url;
	const database = await getDatabase();
	if (database && !forceRefresh) {
		const cachedData = await readEntry(key);
		if (cachedData !== undefined) {
			// Callers only use .ok, .status and .json(); a real Response would
			// stringify the payload again just so it can be parsed straight back.
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => cachedData,
			};
		}
	}

	let pending = inFlightRequests.get(key);
	if (!pending) {
		pending = requestJellyfinJson(url, headers, database).finally(() => {
			inFlightRequests.delete(key);
		});
		inFlightRequests.set(key, pending);
	}
	const result = await pending;
	return {
		ok: result.ok,
		status: result.status,
		statusText: result.statusText,
		json: async () => result.data,
	};
}

export async function getStoredJellyfinServers() {
	const database = await getDatabase();
	if (!database) return [];

	const rows = await database.select("SELECT data FROM jellyfin_servers");
	return rows
		.map((row) => {
			try {
				return JSON.parse(row.data);
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.filter((server) => server?.serverUrl && server?.accessToken && server?.userId);
}

export async function upsertStoredJellyfinServer(server) {
	const database = await getDatabase();
	if (!database) {
		throw new Error("Jellyfin server storage requires the Sonara desktop app");
	}

	await database.execute(
		`INSERT INTO jellyfin_servers (server_url, data)
		 VALUES ($1, $2)
		 ON CONFLICT(server_url) DO UPDATE SET data = excluded.data`,
		[normalizeServerUrl(server.serverUrl), JSON.stringify(server)],
	);
}

export async function removeStoredJellyfinServer(serverUrl) {
	const database = await getDatabase();
	if (!database) {
		throw new Error("Jellyfin server storage requires the Sonara desktop app");
	}

	await database.execute("DELETE FROM jellyfin_servers WHERE server_url = $1", [
		normalizeServerUrl(serverUrl),
	]);
}

// Cache keys and sync markers are namespaced by the server's base URL, so a
// saved server can be updated in place (rename) or re-keyed to a new address
// while carrying its cached content over. Returns how many cache entries
// were migrated when the address changed.
export async function updateStoredJellyfinServer(oldServerUrl, updatedServer) {
	const database = await getDatabase();
	if (!database) {
		throw new Error("Jellyfin server storage requires the Sonara desktop app");
	}

	const oldKey = normalizeServerUrl(oldServerUrl);
	const newKey = normalizeServerUrl(updatedServer.serverUrl);
	if (!oldKey || !newKey) {
		throw new Error("A server address is required to update a saved server");
	}

	if (oldKey === newKey) {
		// Name-only edit (or identical address): refresh the stored record.
		// Cached content keys stay valid, so nothing else needs to move.
		await database.execute(
			"UPDATE jellyfin_servers SET data = $1 WHERE server_url = $2",
			[JSON.stringify(updatedServer), oldKey],
		);
		return { addressChanged: false, migratedCacheEntries: 0 };
	}

	// Re-key the saved server row to the new address.
	await database.execute(
		"UPDATE jellyfin_servers SET server_url = $1, data = $2 WHERE server_url = $3",
		[newKey, JSON.stringify(updatedServer), oldKey],
	);

	// Same server content under a new address (e.g. the server moved hosts or
	// ports): rewrite every cached response key and sync marker so the
	// existing cache keeps serving instead of being refetched or duplicated.
	let migratedCacheEntries = 0;
	const cacheRows = await database.select("SELECT cache_key FROM jellyfin_responses");
	for (const row of cacheRows) {
		const key = String(row.cache_key);
		if (!key.toLowerCase().startsWith(oldKey)) continue;
		await database.execute(
			"UPDATE jellyfin_responses SET cache_key = $1 WHERE cache_key = $2",
			[newKey + key.slice(oldKey.length), key],
		);
		migratedCacheEntries += 1;
	}

	const markerRows = await database.select(
		"SELECT state_key FROM app_state WHERE state_key LIKE $1",
		[`${SYNC_MARKER_PREFIX}${oldKey}%`],
	);
	for (const row of markerRows) {
		await database.execute(
			"UPDATE app_state SET state_key = $1 WHERE state_key = $2",
			[
				`${SYNC_MARKER_PREFIX}${newKey}${row.state_key.slice(SYNC_MARKER_PREFIX.length + oldKey.length)}`,
				row.state_key,
			],
		);
	}

	invalidateCachedJellyfinItems();
	return { addressChanged: true, migratedCacheEntries };
}

// Drop every cached response and sync marker that belongs to a server
// address. Used when an edited address now hosts different content, so no
// stale entries linger under either the old or the new key.
export async function purgeJellyfinServerCache(serverUrl) {
	const database = await getDatabase();
	if (!database) return { removedCacheEntries: 0 };

	const key = normalizeServerUrl(serverUrl);
	if (!key) return { removedCacheEntries: 0 };

	const cacheRows = await database.select("SELECT cache_key FROM jellyfin_responses");
	const doomedKeys = cacheRows
		.map((row) => String(row.cache_key))
		.filter((cacheKey) => cacheKey.toLowerCase().startsWith(key));

	const chunkSize = 40;
	for (let index = 0; index < doomedKeys.length; index += chunkSize) {
		const chunk = doomedKeys.slice(index, index + chunkSize);
		const placeholders = chunk.map((_, offset) => `$${offset + 1}`).join(", ");
		await database.execute(
			`DELETE FROM jellyfin_responses WHERE cache_key IN (${placeholders})`,
			chunk,
		);
	}

	const markerRows = await database.select(
		"SELECT state_key FROM app_state WHERE state_key LIKE $1",
		[`${SYNC_MARKER_PREFIX}${key}%`],
	);
	for (const row of markerRows) {
		await database.execute("DELETE FROM app_state WHERE state_key = $1", [row.state_key]);
	}

	invalidateCachedJellyfinItems();
	return { removedCacheEntries: doomedKeys.length };
}

export function normalizeServerUrl(serverUrl) {
	return String(serverUrl || "").replace(/\/+$/, "").toLowerCase();
}

// ---- Lyrics cache (LRCLIB lookups, persisted for offline use) ----

function lyricsCacheKey(artist, title) {
	const artistName = String(artist || "").trim().toLowerCase();
	const trackName = String(title || "").trim().toLowerCase();
	if (!artistName || !trackName) return null;
	return `${artistName}::${trackName}`;
}

// Returns the stored lyrics object, null when the track is known to have no
// lyrics, or undefined when nothing is stored for it yet.
export async function getStoredLyrics(artist, title) {
	const key = lyricsCacheKey(artist, title);
	if (!key) return undefined;
	const database = await getDatabase();
	if (!database) return undefined;

	const rows = await database.select(
		"SELECT data FROM lyrics_cache WHERE cache_key = $1",
		[key],
	);
	if (rows.length === 0) return undefined;
	try {
		return JSON.parse(rows[0].data);
	} catch {
		return undefined;
	}
}

export async function saveStoredLyrics(artist, title, lyrics) {
	const key = lyricsCacheKey(artist, title);
	if (!key) return;
	const database = await getDatabase();
	if (!database) {
		throw new Error("Lyrics storage requires the Sonara desktop app");
	}

	await database.execute(
		`INSERT INTO lyrics_cache (cache_key, data, fetched_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
		[key, JSON.stringify(lyrics), new Date().toISOString()],
	);
}

// Locally generated library collage thumbnails (square JPEG data URLs). These live only in the app database and are never pushed to Jellyfin.
export async function getStoredLibraryThumbnails() {
	const database = await getDatabase();
	if (!database) return new Map();

	const rows = await database.select("SELECT library_id, data, generated_at FROM library_thumbnails");
	const thumbnails = new Map();
	for (const row of rows) {
		try {
			const parsed = JSON.parse(row.data);
			if (parsed?.dataUrl) {
				thumbnails.set(row.library_id, {
					dataUrl: parsed.dataUrl,
					kind: parsed.kind || null,
					generatedAt: row.generated_at || null,
				});
			}
		} catch {
			// Corrupt rows are ignored; generation will rebuild them.
		}
	}
	return thumbnails;
}

export async function getStoredLibraryThumbnail(libraryId) {
	const thumbnails = await getStoredLibraryThumbnails();
	return thumbnails.get(libraryId)?.dataUrl || null;
}

export async function saveStoredLibraryThumbnail(libraryId, dataUrl, generatedAt, kind = null) {
	const database = await getDatabase();
	if (!database) {
		throw new Error("Library thumbnail storage requires the Sonara desktop app");
	}

	await database.execute(
		`INSERT INTO library_thumbnails (library_id, data, generated_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT(library_id) DO UPDATE SET data = excluded.data, generated_at = excluded.generated_at`,
		[libraryId, JSON.stringify({ kind, dataUrl }), generatedAt],
	);
}

export async function getStoredJellyfinSession() {
	const database = await getDatabase();
	if (!database) return null;

	const rows = await database.select(
		"SELECT data FROM jellyfin_session WHERE id = 1",
	);
	return rows.length > 0 ? JSON.parse(rows[0].data) : null;
}

export async function saveStoredJellyfinSession(session) {
	const database = await getDatabase();
	if (!database) {
		throw new Error("Jellyfin session storage requires the Sonara desktop app");
	}

	await database.execute(
		`INSERT INTO jellyfin_session (id, data)
		 VALUES (1, $1)
		 ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
		[JSON.stringify(session)],
	);
}

export async function removeStoredJellyfinSession() {
	const database = await getDatabase();
	if (!database) {
		throw new Error("Jellyfin session storage requires the Sonara desktop app");
	}

	await database.execute("DELETE FROM jellyfin_session WHERE id = 1");
}

// Queue persistence is split so the (potentially 1000-track) queue array is
// only rewritten when the queue itself changes, while the tiny playback
// pointer row updates on every track change.
export async function getStoredPlayerQueue() {
	const database = await getDatabase();
	if (!database) return null;

	const rows = await database.select(
		"SELECT state_key, data FROM app_state WHERE state_key IN ($1, $2)",
		["player_queue_state", "player_queue_tracks"],
	);
	const byKey = new Map(rows.map((row) => [row.state_key, row.data]));

	const stateRow = byKey.get("player_queue_state");
	if (stateRow !== undefined) {
		try {
			const state = JSON.parse(stateRow);
			const tracksRow = byKey.get("player_queue_tracks");
			const tracks = tracksRow === undefined ? [] : JSON.parse(tracksRow);
			if (tracksRow !== undefined) {
				// One-time cleanup of the duplicate pre-split row.
				database.execute(
					"DELETE FROM app_state WHERE state_key = $1",
					["player_queue"],
				).catch(() => {});
			}
			return { ...state, queue: Array.isArray(tracks) ? tracks : [] };
		} catch {
			return null;
		}
	}

	// Legacy single-row format written by earlier versions.
	const legacyRow = await database.select(
		"SELECT data FROM app_state WHERE state_key = $1",
		["player_queue"],
	);
	if (legacyRow.length === 0) return null;
	try {
		return JSON.parse(legacyRow[0].data);
	} catch {
		return null;
	}
}

export async function saveStoredPlayerQueueTracks(tracks) {
	const database = await getDatabase();
	if (!database) return false;

	await database.execute(
		`INSERT INTO app_state (state_key, data)
		 VALUES ($1, $2)
		 ON CONFLICT(state_key) DO UPDATE SET data = excluded.data`,
		["player_queue_tracks", JSON.stringify(tracks)],
	);
	return true;
}

export async function saveStoredPlayerQueueState(queueState) {
	const database = await getDatabase();
	if (!database) return false;

	await database.execute(
		`INSERT INTO app_state (state_key, data)
		 VALUES ($1, $2)
		 ON CONFLICT(state_key) DO UPDATE SET data = excluded.data`,
		["player_queue_state", JSON.stringify(queueState)],
	);
	return true;
}

export async function recordAppLog(level, source, message, details = null) {
	try {
		const database = await getDatabase();
		if (!database) return;

		await database.execute(
			`INSERT INTO app_logs (created_at, level, source, message, details)
			 VALUES ($1, $2, $3, $4, $5)`,
			[
				new Date().toISOString(),
				level,
				source,
				String(message).slice(0, 4000),
				details == null ? null : JSON.stringify(details).slice(0, 12000),
			],
		);
		await database.execute(
			"DELETE FROM app_logs WHERE id NOT IN (SELECT id FROM app_logs ORDER BY id DESC LIMIT 5000)",
		);
	} catch (error) {
		console.error("Could not save application log to the database:", error);
	}
}

export async function getAppLogs(limit = 500) {
	const database = await getDatabase();
	if (!database) return [];

	return database.select(
		"SELECT id, created_at, level, source, message, details FROM app_logs ORDER BY id DESC LIMIT $1",
		[Math.max(1, Math.min(Number(limit) || 500, 5000))],
	);
}
