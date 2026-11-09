// Client identification required by Jellyfin
import { fetchCachedJellyfinJson } from "./jellyfinCache";

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

	while (startIndex < totalRecordCount) {
		const params = new URLSearchParams({
			userId,
			Recursive: "true",
			IncludeItemTypes: includeItemTypes.join(","),
			SortBy: sortBy,
			SortOrder: sortOrder,
			StartIndex: String(startIndex),
			Limit: String(limit),
			Fields: "MediaSources,MediaStreams,PrimaryImageAspectRatio,Genres,AlbumId,Artists",
		});
		if (parentId) params.set("ParentId", parentId);
		if (artistId) params.set("ArtistIds", artistId);
		if (genreId) params.set("GenreIds", genreId);
		if (isFavorite !== undefined) params.set("IsFavorite", String(isFavorite));

		const res = await fetchCachedJellyfinJson(
			`${base}/Users/${userId}/Items?${params}`,
			getAuthHeaders(token),
			{ forceRefresh },
		);
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

export async function fetchMusicAlbums(serverUrl, userId, token) {
	const albums = await fetchMusicCollection(serverUrl, userId, token, {
		includeItemTypes: ["MusicAlbum"],
		formatEntities: true,
	});
	if (albums.length > 0) return albums;

	const libraries = await fetchMusicLibraries(serverUrl, userId, token);
	const albumsByLibrary = await Promise.all(libraries.map((library) =>
		fetchMusicCollection(serverUrl, userId, token, {
			parentId: library.id,
			includeItemTypes: ["MusicAlbum"],
			formatEntities: true,
		}),
	));
	return [...new Map(albumsByLibrary.flat().map((album) => [album.id, album])).values()];
}

export async function fetchMusicArtists(serverUrl, userId, token) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({
		userId,
		SortBy: "SortName",
		SortOrder: "Ascending",
		EnableImages: "true",
	});
	const res = await fetchCachedJellyfinJson(`${base}/Artists?${params}`, getAuthHeaders(token));
	if (!res.ok) {
		throw new Error(`Failed to fetch artists (${res.status})`);
	}
	const data = await res.json();
	return (data.Items || []).map((item) => formatJellyfinEntity(base, item, token));
}

export async function fetchMusicLibraries(serverUrl, userId, token) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({ userId });
	const res = await fetchCachedJellyfinJson(`${base}/UserViews?${params}`, getAuthHeaders(token));
	if (!res.ok) {
		throw new Error(`Failed to fetch music libraries (${res.status})`);
	}
	const data = await res.json();
	return (data.Items || [])
		.filter((item) => !item.CollectionType || item.CollectionType === "music")
		.map((item) => formatJellyfinEntity(base, item, token));
}

export async function fetchMusicItem(serverUrl, userId, token, itemId) {
	const base = cleanUrl(serverUrl);
	const params = new URLSearchParams({ userId });
	const res = await fetchCachedJellyfinJson(`${base}/Items/${itemId}?${params}`, getAuthHeaders(token));
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
	const res = await fetchCachedJellyfinJson(url, getAuthHeaders(token), options);

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

	const cover =
		getImageUrl(serverUrl, item.Id, token) ||
		(item.AlbumId ? getImageUrl(serverUrl, item.AlbumId, token) : null);

	return {
		id: item.Id,
		title: item.Name || "Untitled Track",
		artist: artist,
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

function getRandomGenreColor(name) {
	if (!name) return GENRE_COLORS[0];
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = name.charCodeAt(i) + ((hash << 5) - hash);
	}
	const index = Math.abs(hash) % GENRE_COLORS.length;
	return GENRE_COLORS[index];
}
