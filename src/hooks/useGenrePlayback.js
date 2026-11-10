import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { usePlayer } from "../context/PlayerContext";
import { useJellyfin } from "../context/JellyfinContext";
import { fetchMusicCollection } from "../services/jellyfin";
import { recordAppLog } from "../services/jellyfinCache";

// Shared genre playback behaviour for genre cards (Home grid + Genres page).
// Genre tracks are not preloaded, so playGenre() fetches them (through the
// DB cache first) and then starts the queue at the first track. It also
// derives which genres the current track belongs to and which genres have
// any track in the queue, so cards can keep their play/pause button visible.
export function useGenrePlayback() {
	const { currentTrack, isPlaying, playTrack, togglePlay, queue } = usePlayer();
	const { session } = useJellyfin();
	const [pendingGenreIds, setPendingGenreIds] = useState(() => new Set());

	const setGenrePending = (genreId, pending) => {
		setPendingGenreIds((previous) => {
			const next = new Set(previous);
			if (pending) next.add(genreId);
			else next.delete(genreId);
			return next;
		});
	};

	const playGenre = async (genre) => {
		if (!session?.serverUrl || !session?.accessToken || !session?.userId) {
			toast.error("Connect to a Jellyfin server first");
			return;
		}
		if (!genre?.id) return;
		setGenrePending(genre.id, true);
		try {
			const genreTracks = await fetchMusicCollection(
				session.serverUrl,
				session.userId,
				session.accessToken,
				{ genreId: genre.id },
			);
			if (genreTracks.length === 0) {
				toast.error(`No tracks found for "${genre.name}"`);
				return;
			}
			playTrack(genreTracks[0], genreTracks);
		} catch (error) {
			console.error(`Could not play the "${genre.name}" genre:`, error);
			recordAppLog("error", "jellyfin-playback", `Could not play genre "${genre.name}"`, {
				message: error.message,
				genreId: genre.id,
			});
			toast.error(`Could not play "${genre.name}"`);
		} finally {
			setGenrePending(genre.id, false);
		}
	};

	// Genre names of the currently loaded track (playing or paused)
	const currentGenreNames = useMemo(() => {
		const names = new Set();
		(currentTrack?.raw?.Genres || currentTrack?.genreNames || []).forEach((name) => {
			if (name) names.add(String(name).toLowerCase());
		});
		return names;
	}, [currentTrack]);

	// Genre names with any track anywhere in the queue
	const queueGenreNames = useMemo(() => {
		const names = new Set(currentGenreNames);
		queue.forEach((track) => {
			(track?.raw?.Genres || track?.genreNames || []).forEach((name) => {
				if (name) names.add(String(name).toLowerCase());
			});
		});
		return names;
	}, [queue, currentGenreNames]);

	return { playGenre, pendingGenreIds, currentGenreNames, queueGenreNames, isPlaying, togglePlay };
}

export default useGenrePlayback;
