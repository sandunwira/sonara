import {
	fetchMusicArtists,
	isJellyfinAdministrator,
	saveArtistProfileImageIfMissing,
} from "./jellyfin";
import { fetchArtistProfile } from "./ytmusic";

const ARTIST_REQUEST_PAUSE_MS = 300;

function pauseBetweenArtists() {
	return new Promise((resolve) => setTimeout(resolve, ARTIST_REQUEST_PAUSE_MS));
}

export async function preloadMissingArtistImages(session, isCancelled = () => false) {
	if (isCancelled() || !await isJellyfinAdministrator(session) || isCancelled()) return;

	const artists = await fetchMusicArtists(
		session.serverUrl,
		session.userId,
		session.accessToken,
		{ forceRefresh: true },
	);

	for (const artist of artists) {
		if (isCancelled()) return;
		const name = String(artist.name || "").trim();
		if (
			!artist.id
			|| !name
			|| artist.raw?.ImageTags?.Primary
			|| artist.raw?.PrimaryImageTag
		) {
			continue;
		}

		try {
			const profile = await fetchArtistProfile(name);
			if (isCancelled()) return;
			if (profile?.thumbnail) {
				await saveArtistProfileImageIfMissing(session, artist.id, name, profile.thumbnail);
			}
		} catch (error) {
			console.warn(`Could not preload the Jellyfin artist image for ${name}:`, error);
		}

		await pauseBetweenArtists();
	}
}
