import {
	fetchCachedJellyfinJson,
	getCachedJellyfinItems,
	readJellyfinCacheEntry,
	isJellyfinLibrarySynced,
	markJellyfinLibrarySynced,
	startJellyfinSyncCapture,
	cancelJellyfinSyncCapture,
	finishJellyfinSyncCapture,
	getStoredLibraryThumbnails,
} from "./jellyfinCache";

const CLIENT_NAME = "Sonara";
const CLIENT_VERSION = "0.1.0";
const DEVICE_NAME = "Windows Desktop";
const DEVICE_ID = "sonara-desktop-client-v1";

export function cleanUrl(url) {
	if (!url) return "";
	let cleaned = url.trim();
	if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
		cleaned = `http://${cleaned}`;
	}
	return cleaned.replace(/\/+$/, "");
}

export function getAuthHeaders(token = null) {
	const authValue = `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`;
	const headers = {
		Accept: "application/json",
		"Content-Type": "application/json",
		"X-Emby-Authorization": authValue,
	};
	if (token) {
		headers["X-Emby-Token"] = token;
		headers["X-MediaBrowser-Token"] = token;
	}
	return headers;
}

export async function testServer(serverUrl) {
	const base = cleanUrl(serverUrl);
	const res = await fetch(`${base}/System/Info/Public`, {
		method: "GET",
		headers: getAuthHeaders(),
	});
	if (!res.ok) {
		throw new Error(`Failed to reach Jellyfin server (${res.status} ${res.statusText})`);
	}
	return await res.json();
}

export async function authenticateByName(serverUrl, username, password) {
	const base = cleanUrl(serverUrl);
	const res = await fetch(`${base}/Users/AuthenticateByName`, {
		method: "POST",
		headers: getAuthHeaders(),
		body: JSON.stringify({
			Username: username,
			Pw: password,
		}),
	});

	if (!res.ok) {
		if (res.status === 401 || res.status === 400) {
			throw new Error("Invalid username or password");
		}
		throw new Error(`Authentication failed (${res.status} ${res.statusText})`);
	}

	const data = await res.json();
	return {
		serverUrl: base,
		accessToken: data.AccessToken,
		serverId: data.ServerId,
		userId: data.User?.Id,
		username: data.User?.Name || username,
	};
}

export function getAudioStreamUrl(serverUrl, itemId, token, userId) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({
		UserId: userId,
		DeviceId: DEVICE_ID,
		Container: "mp3",
		TranscodingContainer: "mp3",
		TranscodingProtocol: "http",
		AudioCodec: "mp3",
		EnableRedirection: "false",
		api_key: token,
	});
	return `${base}/Audio/${itemId}/universal?${params}`;
}

export function getImageUrl(serverUrl, itemId, token, albumId = null) {
	const base = cleanUrl(serverUrl);
	const targetId = itemId || albumId;
	if (!targetId) return null;
	return `${base}/Items/${targetId}/Images/Primary?maxHeight=400&maxWidth=400&quality=90&api_key=${token}`;
}

export async function fetchUserMusic(serverUrl, userId, token, limit = 50, options = {}) {
	const base = cleanUrl(serverUrl);
	const url = `${base}/Users/${userId}/Items?IncludeItemTypes=Audio&Recursive=true&SortBy=PlayCount,DateCreated&SortOrder=Descending&Limit=${limit}&Fields=MediaSources,MediaStreams,PrimaryImageAspectRatio,Genres,AlbumId,Artists`;
	const res = await fetchCachedJellyfinJson(url, getAuthHeaders(token), options);

	if (!res.ok) {
		throw new Error(`Failed to fetch music items (${res.status})`);
	}

	const data = await res.json();
	return (data.Items || []).map((item) => formatJellyfinTrack(base, item, token, userId));
}

export async function fetchRecentlyPlayed(serverUrl, userId, token, limit = 50, options = {}) {
	const base = cleanUrl(serverUrl);
	const url = `${base}/Users/${userId}/Items?IncludeItemTypes=Audio&Recursive=true&IsPlayed=true&SortBy=DatePlayed&SortOrder=Descending&Limit=${limit}&Fields=MediaSources,MediaStreams,PrimaryImageAspectRatio,Genres,AlbumId,Artists`;
	const res = await fetchCachedJellyfinJson(url, getAuthHeaders(token), options);

	if (!res.ok) {
		throw new Error(`Failed to fetch recently played (${res.status})`);
	}

	const data = await res.json();
	return (data.Items || []).map((item) => formatJellyfinTrack(base, item, token, userId));
}

export async function fetchMusicCollection(serverUrl, userId, token, {
	parentId,
	artistId,
	genreId,
	isFavorite,
	includeItemTypes = ["Audio"],
	sortBy = "SortName",
	sortOrder = "Ascending",
	formatEntities = false,
forceRefresh = false,
} = {}) {
const base = cleanUrl(serverUrl);
const items = [];
const limit = 200;
let startIndex = 0;
let totalRecordCount = Infinity;
// Cached fallback now also covers unfiltered fetches (albums, all tracks,
// etc.) whenever the library has been synced at least once.
const canUseSyncedData = !forceRefresh
	&& await isJellyfinLibrarySynced(base, userId);

while (startIndex < totalRecordCount) {
		const params = new URLSearchParams({
			userId,
			Recursive: "true",
			IncludeItemTypes: includeItemTypes.join(","),
			SortBy: sortBy,
			SortOrder: sortOrder,
			StartIndex: String(startIndex),
			Limit: String(limit),
			Fields: "MediaSources,MediaStreams,PrimaryImageAspectRatio,Genres,GenreItems,AlbumId,ArtistItems,Artists,UserData,Path,DateCreated",
		});
		if (parentId) params.set("ParentId", parentId);
		if (artistId) params.set("ArtistIds", artistId);
		if (genreId) params.set("GenreIds", genreId);
		if (isFavorite !== undefined) params.set("IsFavorite", String(isFavorite));

		let res;
		try {
			res = await fetchCachedJellyfinJson(
				`${base}/Users/${userId}/Items?${params}`,
				getAuthHeaders(token),
				{ forceRefresh },
			);
		} catch (error) {
			if (!canUseSyncedData) throw error;

			const cachedItems = await getCachedJellyfinItems(base, userId);
			const libraries = parentId
				? cachedItems.filter((item) => item.Id === parentId && item.Type === "CollectionFolder")
				: [];
			const libraryPath = libraries[0]?.Path?.replace(/[\\/]+$/, "").toLowerCase();
			const filteredItems = cachedItems.filter((item) => {
				if (!includeItemTypes.includes(item.Type)) return false;
				if (parentId) {
					const isAlbumTrack = item.AlbumId === parentId;
					const isLibraryTrack = item.ParentId === parentId
						|| (libraryPath && item.Path?.toLowerCase().startsWith(`${libraryPath}\\`));
					if (!isAlbumTrack && !isLibraryTrack) return false;
				}
				if (artistId && !item.ArtistItems?.some((artist) => artist.Id === artistId)) return false;
				if (genreId && !item.GenreItems?.some((genre) => genre.Id === genreId)) return false;
				if (isFavorite !== undefined && Boolean(item.UserData?.IsFavorite) !== isFavorite) return false;
				return true;
			});
			return filteredItems.map((item) => (
				formatEntities
					? formatJellyfinEntity(base, item, token)
					: formatJellyfinTrack(base, item, token, userId)
			));
		}
		if (!res.ok) {
			throw new Error(`Failed to fetch music collection (${res.status})`);
		}

		const data = await res.json();
		const pageItems = data.Items || [];
		items.push(...pageItems);
		if (pageItems.length < limit) break;
		totalRecordCount = data.TotalRecordCount ?? Infinity;
		startIndex += pageItems.length;
	}

	return items.map((item) => (
		formatEntities
			? formatJellyfinEntity(base, item, token)
			: formatJellyfinTrack(base, item, token, userId)
	));
}

export async function fetchMusicAlbums(serverUrl, userId, token, { forceRefresh = false } = {}) {
	const albums = await fetchMusicCollection(serverUrl, userId, token, {
		includeItemTypes: ["MusicAlbum"],
		formatEntities: true,
		forceRefresh,
	});
	if (albums.length > 0) return albums;

	const libraries = await fetchMusicLibraries(serverUrl, userId, token);
	const albumsByLibrary = await Promise.all(libraries.map((library) =>
		fetchMusicCollection(serverUrl, userId, token, {
			parentId: library.id,
			includeItemTypes: ["MusicAlbum"],
			formatEntities: true,
			forceRefresh,
		}),
	));
	const flatAlbums = [...new Map(albumsByLibrary.flat().map((album) => [album.id, album])).values()];
	if (flatAlbums.length > 0) return flatAlbums;

	// Folder-based music libraries have no MusicAlbum entities, so the
	// server cannot return albums at all. Group the track list on its
	// Album tag AND album artist, and serve virtual album entities
	// instead, keeping the Albums page and track-to-album links
	// functional while letting different artists share an album name.
	const allTracks = await fetchMusicCollection(serverUrl, userId, token, { forceRefresh });
	const groups = new Map();
	for (const track of allTracks) {
		const name = track.album?.trim();
		if (!name || name.toLowerCase() === "unknown album") continue;
		const artistId = track.raw?.AlbumArtists?.[0]?.Id
			|| track.raw?.ArtistItems?.[0]?.Id
			|| "";
		const groupKey = `${artistId}|${name.toLowerCase()}`;
		if (!groups.has(groupKey)) groups.set(groupKey, []);
		groups.get(groupKey).push(track);
	}
	return [...groups.values()].map((albumTracks) => {
		const first = albumTracks[0];
		const name = first.album.trim();
		const artistId = first.raw?.AlbumArtists?.[0]?.Id || first.raw?.ArtistItems?.[0]?.Id || null;
		return {
			id: makeVirtualAlbumId(name, artistId),
			title: name,
			name,
			artist: first.raw?.AlbumArtists?.[0]?.Name || first.artist || "",
			cover: first.cover || null,
			isJellyfin: true,
			isVirtual: true,
			raw: {},
		};
	});
}

// Virtual album ids encode the album's artist id and name
// ("album:<artistId>@<encoded name>") so that two different artists may
// share an album name without their pages merging. The artist id comes
// first because it is always a 32-char hex string (or empty), so the
// first "@" is unambiguously the separator. Jellyfin item ids are also
// 32-char hex strings, so the "album:" prefix can never collide.
export function makeVirtualAlbumId(albumName, artistId = null) {
	return `album:${artistId || ""}@${encodeURIComponent(albumName)}`;
}

export function getVirtualAlbumName(albumId) {
	if (typeof albumId !== "string" || !albumId.startsWith("album:")) return null;
	const rest = albumId.slice("album:".length);
	const separatorIndex = rest.indexOf("@");
	if (separatorIndex === -1) return null;
	const artistId = rest.slice(0, separatorIndex) || null;
	const name = rest.slice(separatorIndex + 1);
	return name ? { name, artistId } : null;
}

// Resolves the album page a track should link to: the real album entity
// when Jellyfin provides an AlbumId, otherwise a virtual album keyed on
// the track's Album tag and album artist (so same-named albums by
// different artists stay separate). Returns null when there is nothing
// to link to.
export function getTrackAlbumLink(track) {
	if (track?.albumId && /^[0-9a-f]{32}$/i.test(track.albumId)) {
		return { id: track.albumId, title: track.album || "" };
	}
	const name = track?.album?.trim();
	if (!name || name.toLowerCase() === "unknown album") return null;
	const artistId = track?.raw?.AlbumArtists?.[0]?.Id
		|| track?.raw?.ArtistItems?.[0]?.Id
		|| null;
	return { id: makeVirtualAlbumId(name, artistId), title: name };
}

export async function fetchMusicArtists(serverUrl, userId, token, { forceRefresh = false } = {}) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({
		userId,
		SortBy: "SortName",
		SortOrder: "Ascending",
		EnableImages: "true",
	});
	let res;
	try {
		res = await fetchCachedJellyfinJson(`${base}/Artists?${params}`, getAuthHeaders(token), { forceRefresh });
	} catch (error) {
		if (forceRefresh || !await isJellyfinLibrarySynced(base, userId)) throw error;
		const cachedItems = await getCachedJellyfinItems(base, userId);
		const artists = cachedItems.filter((item) => item.Type === "MusicArtist");
		if (artists.length === 0) throw error;
		return artists.map((item) => formatJellyfinEntity(base, item, token));
	}
	if (!res.ok) {
		throw new Error(`Failed to fetch artists (${res.status})`);
	}
	const data = await res.json();
	return (data.Items || []).map((item) => formatJellyfinEntity(base, item, token));
}

export async function fetchMusicLibraries(serverUrl, userId, token, { forceRefresh = false } = {}) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({ userId });
	let res;
	let entities;
	try {
		res = await fetchCachedJellyfinJson(`${base}/UserViews?${params}`, getAuthHeaders(token), { forceRefresh });
	} catch (error) {
		if (forceRefresh || !await isJellyfinLibrarySynced(base, userId)) throw error;
		const cachedItems = await getCachedJellyfinItems(base, userId);
		const libraries = cachedItems.filter((item) => item.Type === "CollectionFolder"
			&& (!item.CollectionType || item.CollectionType === "music"));
		if (libraries.length === 0) throw error;
		entities = libraries.map((item) => formatJellyfinEntity(base, item, token));
	}
	if (!entities) {
		if (!res.ok) {
			throw new Error(`Failed to fetch music libraries (${res.status})`);
		}
		const data = await res.json();
		entities = (data.Items || [])
			.filter((item) => !item.CollectionType || item.CollectionType === "music")
			.map((item) => formatJellyfinEntity(base, item, token));
	}

	// Attach locally generated collage thumbnails where present. These live
	// only in the app database and are never pushed to Jellyfin.
	const thumbnails = await getStoredLibraryThumbnails();
	if (thumbnails.size > 0) {
		for (const library of entities) {
			const storedThumbnail = thumbnails.get(library.id);
			if (storedThumbnail) library.cover = storedThumbnail.dataUrl;
		}
	}
	return entities;
}

export async function fetchMusicItem(serverUrl, userId, token, itemId, { forceRefresh = false } = {}) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({ userId });
	let res;
	try {
		res = await fetchCachedJellyfinJson(
			`${base}/Items/${itemId}?${params}`,
			getAuthHeaders(token),
			{ forceRefresh },
		);
	} catch (error) {
		if (!forceRefresh && await isJellyfinLibrarySynced(base, userId)) {
			const cachedItem = (await getCachedJellyfinItems(base, userId)).find((item) => item.Id === itemId);
			if (cachedItem) {
				return cachedItem.Type === "Audio"
					? formatJellyfinTrack(base, cachedItem, token, userId)
					: formatJellyfinEntity(base, cachedItem, token);
			}
		}
		throw error;
	}
	if (!res.ok) {
		throw new Error(`Failed to fetch music item (${res.status})`);
	}
	const item = await res.json();
	return item.Type === "Audio"
		? formatJellyfinTrack(base, item, token, userId)
		: formatJellyfinEntity(base, item, token);
}

export async function fetchMusicGenres(serverUrl, userId, token, options = {}) {
	const base = cleanUrl(serverUrl);
	const url = `${base}/MusicGenres?userId=${userId}`;
	let res;
	try {
		res = await fetchCachedJellyfinJson(url, getAuthHeaders(token), options);
	} catch (error) {
		if (options.forceRefresh || !await isJellyfinLibrarySynced(base, userId)) throw error;
		const data = await readJellyfinCacheEntry(url);
		if (!data?.Items?.length) throw error;
		return data.Items.map((genre) => ({
			id: genre.Id,
			name: genre.Name,
			color: getRandomGenreColor(genre.Name),
		}));
	}

	if (!res.ok) {
		throw new Error(`Failed to fetch music genres (${res.status})`);
	}

	const data = await res.json();
	return (data.Items || []).map((genre) => ({
		id: genre.Id,
		name: genre.Name,
		color: getRandomGenreColor(genre.Name),
	}));
}

export async function syncJellyfinLibrary(serverUrl, userId, token) {
	const base = cleanUrl(serverUrl);
	startJellyfinSyncCapture();
	try {
		const results = await Promise.all([
			fetchMusicCollection(base, userId, token, { forceRefresh: true }),
			fetchUserMusic(base, userId, token, 50, { forceRefresh: true }),
			fetchRecentlyPlayed(base, userId, token, 50, { forceRefresh: true }),
			fetchMusicCollection(base, userId, token, {
				includeItemTypes: ["MusicAlbum"],
				formatEntities: true,
				forceRefresh: true,
			}),
			fetchMusicCollection(base, userId, token, { isFavorite: true, forceRefresh: true }),
			fetchMusicArtists(base, userId, token, { forceRefresh: true }),
			fetchMusicLibraries(base, userId, token, { forceRefresh: true }),
			fetchMusicGenres(base, userId, token, { forceRefresh: true }),
		]);
		const libraries = results[6];
		await Promise.all(libraries.map((library) =>
			Promise.all([
				fetchMusicCollection(base, userId, token, {
					parentId: library.id,
					forceRefresh: true,
				}),
				fetchMusicCollection(base, userId, token, {
					parentId: library.id,
					includeItemTypes: ["MusicAlbum"],
					formatEntities: true,
					forceRefresh: true,
				}),
			]),
		));
		await markJellyfinLibrarySynced(base, userId);
		// Every cached response that was not rewritten during this sync belongs
		// to an older browsing state, so drop it to keep filtered/detail pages
		// consistent with the freshly synced data.
		const purgeSummary = await finishJellyfinSyncCapture(base);
		return purgeSummary;
	} finally {
		// On a failed sync the capture is discarded so valid cached data is
		// never purged while the server is unreachable.
		cancelJellyfinSyncCapture();
	}
}

export async function markItemPlayed(serverUrl, userId, itemId, token) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({ userId });
	const res = await fetch(`${base}/UserPlayedItems/${itemId}?${params}`, {
		method: "POST",
		headers: getAuthHeaders(token),
	});

	if (!res.ok) {
		throw new Error(`Failed to update play history (${res.status})`);
	}
}

export async function reportPlaybackEvent(serverUrl, event, payload, token) {
	const paths = {
		start: "/Sessions/Playing",
		progress: "/Sessions/Playing/Progress",
		stop: "/Sessions/Playing/Stopped",
	};
	const path = paths[event];
	if (!path) {
		throw new Error(`Unsupported playback event: ${event}`);
	}

	const res = await fetch(`${cleanUrl(serverUrl)}${path}`, {
		method: "POST",
		headers: getAuthHeaders(token),
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		throw new Error(`Failed to report playback ${event} (${res.status})`);
	}
}

function formatJellyfinTrack(serverUrl, item, token, userId) {
	const durationSeconds = item.RunTimeTicks
		? Math.round(item.RunTimeTicks / 10000000)
		: 180;

	const artist =
		item.Artists?.join(", ") ||
		item.AlbumArtist ||
		"Unknown Artist";

	// Stable artist id for navigation (e.g. the bottom player bar). Persisted with the queue, so it survives app restarts (unlike `raw`, which is stripped when the queue is saved). The displayed artist string is matched against the item's artist entries first so feature tracks link to the artist actually shown.
	const artistId =
		item.ArtistItems?.find((entry) => entry.Name === artist)?.Id
		|| item.AlbumArtists?.find((entry) => entry.Name === artist)?.Id
		|| item.ArtistItems?.[0]?.Id
		|| item.AlbumArtists?.[0]?.Id
		|| null;

	const cover =
		getImageUrl(serverUrl, item.Id, token) ||
		(item.AlbumId ? getImageUrl(serverUrl, item.AlbumId, token) : null);

	return {
		id: item.Id,
		title: item.Name || "Untitled Track",
		artist: artist,
		artistId: artistId,
		album: item.Album || "Unknown Album",
		albumId: item.AlbumId,
		duration: durationSeconds,
		cover: cover,
		streamUrl: getAudioStreamUrl(serverUrl, item.Id, token, userId),
		isJellyfin: true,
		raw: item,
	};
}

function formatJellyfinEntity(serverUrl, item, token) {
	return {
		id: item.Id,
		title: item.Name || "Untitled",
		name: item.Name || "Untitled",
		artist: item.AlbumArtist || item.ArtistItems?.map((artist) => artist.Name).join(", ") || "",
		album: item.Album || "",
		cover: getImageUrl(serverUrl, item.Id, token),
		isJellyfin: true,
		raw: item,
	};
}

const GENRE_COLORS = [
	"#eab308", "#f97316", "#06b6d4", "#0ea5e9", "#22c55e",
	"#ec4899", "#818cf8", "#facc15", "#6366f1", "#3b82f6",
	"#f59e0b", "#d946ef", "#38bdf8", "#fb923c", "#a855f7",
	"#10b981", "#fb7185"
];

export function getRandomGenreColor(name) {
	if (!name) return GENRE_COLORS[0];
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = name.charCodeAt(i) + ((hash << 5) - hash);
	}
	const index = Math.abs(hash) % GENRE_COLORS.length;
	return GENRE_COLORS[index];
}
