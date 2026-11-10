import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

const DATABASE_URL = "sqlite:sonara_cache.db";

let databasePromise;

async function getDatabase() {
	if (!isTauri()) return null;
	if (!databasePromise) {
		databasePromise = Database.load(DATABASE_URL).catch((error) => {
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

export async function getCachedJellyfinItems(serverUrl, userId) {
	const database = await getDatabase();
	if (!database) return [];

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
			if (!previous || JSON.stringify(item).length > JSON.stringify(previous).length) {
				itemsById.set(item.Id, item);
			}
		}
	}
	return [...itemsById.values()];
}

export async function readJellyfinCacheEntry(key) {
	return readEntry(key);
}

function syncMarkerKey(serverUrl, userId) {
	return `jellyfin_sync:${serverUrl.replace(/\/+$/, "").toLowerCase()}:${userId}`;
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

async function writeEntry(key, data) {
	const database = await getDatabase();
	if (!database) return;

	await database.execute(
		`INSERT INTO jellyfin_responses (cache_key, data)
		 VALUES ($1, $2)
		 ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data`,
		[key, JSON.stringify(data)],
	);
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
	return { removedStaleEntries: staleKeys.length };
}

export async function fetchCachedJellyfinJson(url, headers, { forceRefresh = false } = {}) {
	const key = url;
	const database = await getDatabase();
	if (database && !forceRefresh) {
		const cachedData = await readEntry(key);
		if (cachedData !== undefined) {
			return new Response(JSON.stringify(cachedData), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
	}

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

	if (database && response.ok) {
		const data = await response.clone().json();
		await writeEntry(key, data);
	} else if (!response.ok) {
		await recordAppLog("error", "jellyfin-http", "Jellyfin returned an error response", {
			path: new URL(url).pathname,
			status: response.status,
		});
	}

	return response;
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

export async function getStoredPlayerQueue() {
	const database = await getDatabase();
	if (!database) return null;

	const rows = await database.select(
		"SELECT data FROM app_state WHERE state_key = $1",
		["player_queue"],
	);
	return rows.length > 0 ? JSON.parse(rows[0].data) : null;
}

export async function saveStoredPlayerQueue(queueState) {
	const database = await getDatabase();
	if (!database) return false;

	await database.execute(
		`INSERT INTO app_state (state_key, data)
		 VALUES ($1, $2)
		 ON CONFLICT(state_key) DO UPDATE SET data = excluded.data`,
		["player_queue", JSON.stringify(queueState)],
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
