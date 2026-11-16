import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useJellyfin } from "../context/JellyfinContext";
import { setJellyfinFavorite } from "../services/jellyfin";
import { invalidateJellyfinFavoriteEntries } from "../services/jellyfinCache";

// Shared favorite toggle (track options menu + bottom player bar):
// optimistic local flag synced to the server, revert + toast on failure,
// then cache invalidation and a libraryVersion bump so the Favorites
// section refetches. `onSuccess` lets callers run post-success side
// effects (e.g. closing the options menu).
export function useFavoriteToggle(track, { onSuccess } = {}) {
	const { session, bumpLibraryVersion } = useJellyfin();
	const [isFavorite, setIsFavorite] = useState(Boolean(track?.raw?.UserData?.IsFavorite));

	// The raw UserData flag is the source of truth; re-sync whenever the
	// track changes or fresh metadata arrives.
	useEffect(() => {
		setIsFavorite(Boolean(track?.raw?.UserData?.IsFavorite));
	}, [track?.id, track?.raw?.UserData?.IsFavorite]);

	const toggleFavorite = useCallback(async () => {
		if (!track?.id || !session) return;
		const next = !isFavorite;
		setIsFavorite(next);
		try {
			await setJellyfinFavorite(
				session.serverUrl,
				session.userId,
				track.id,
				session.accessToken,
				next,
			);
			// Keep the raw item (the favorite state's source of truth) in
			// sync so a re-render can't revert the optimistic flag.
			if (track.raw?.UserData) {
				track.raw.UserData.IsFavorite = next;
			}
			// The response cache holds stale favorite state: drop the cached
			// favorites collection and this item's cached detail, then let
			// open pages (e.g. the Favorites section) refetch fresh data.
			await invalidateJellyfinFavoriteEntries(track.id);
			bumpLibraryVersion();
			onSuccess?.(next);
		} catch (error) {
			setIsFavorite(!next);
			toast.error(error?.message || "Could not update favorites");
		}
	}, [track, session, isFavorite, bumpLibraryVersion, onSuccess]);

	return { isFavorite, toggleFavorite };
}

export default useFavoriteToggle;
