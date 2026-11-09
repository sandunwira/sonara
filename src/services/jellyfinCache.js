const DATABASE_NAME = "sonara_jellyfin_cache";
const STORE_NAME = "responses";
const DATABASE_VERSION = 1;

const memoryCache = new Map();
let databasePromise;
let cacheGeneration = 0;

function openDatabase() {
	if (typeof indexedDB === "undefined") return Promise.resolve(null);
	if (databasePromise) return databasePromise;

	databasePromise = new Promise((resolve) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			console.warn("Could not open the Jellyfin cache database:", request.error);
			resolve(null);
		};
	});

	return databasePromise;
}

async function readEntry(key) {
	if (memoryCache.has(key)) return memoryCache.get(key);

	const database = await openDatabase();
	if (!database) return undefined;

	return new Promise((resolve) => {
		const transaction = database.transaction(STORE_NAME, "readonly");
		const request = transaction.objectStore(STORE_NAME).get(key);
		request.onsuccess = () => {
			const data = request.result?.data;
			if (data !== undefined) memoryCache.set(key, data);
			resolve(data);
		};
		request.onerror = () => {
			console.warn("Could not read the Jellyfin cache:", request.error);
			resolve(undefined);
		};
	});
}

async function writeEntry(key, data, generation) {
	if (generation !== cacheGeneration) return;
	memoryCache.set(key, data);

	const database = await openDatabase();
	if (!database) return;

	await new Promise((resolve) => {
		const transaction = database.transaction(STORE_NAME, "readwrite");
		transaction.objectStore(STORE_NAME).put({ key, data });
		transaction.oncomplete = resolve;
		transaction.onerror = () => {
			console.warn("Could not save the Jellyfin cache:", transaction.error);
			resolve();
		};
		transaction.onabort = () => {
			console.warn("Could not save the Jellyfin cache:", transaction.error);
			resolve();
		};
	});
}

export async function fetchCachedJellyfinJson(url, headers, { forceRefresh = false } = {}) {
	const key = url;
	if (!forceRefresh) {
		const cachedData = await readEntry(key);
		if (cachedData !== undefined) {
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => cachedData,
			};
		}
	}

	const generation = cacheGeneration;
	const response = await fetch(url, {
		method: "GET",
		headers,
	});

	if (response.ok) {
		try {
			const data = await response.clone().json();
			await writeEntry(key, data, generation);
		} catch (error) {
			console.warn("Could not cache the Jellyfin response:", error);
		}
	}

	return response;
}

export async function clearJellyfinCache() {
	cacheGeneration += 1;
	memoryCache.clear();

	const database = await openDatabase();
	if (!database) return;

	await new Promise((resolve, reject) => {
		const transaction = database.transaction(STORE_NAME, "readwrite");
		transaction.objectStore(STORE_NAME).clear();
		transaction.oncomplete = resolve;
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}
