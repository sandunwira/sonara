import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
	IconChevronLeft,
	IconDisc,
	IconMusic,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconPlayerTrackNext,
	IconPlaylistAdd,
	IconServer,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { usePlayer } from "../context/PlayerContext";
import { fetchMusicCollection, fetchMusicItem, getVirtualAlbumName } from "../services/jellyfin";
import Artwork from "../components/Artwork";

function formatDuration(seconds) {
	if (!seconds || !Number.isFinite(seconds)) return "";
	return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatTotalDuration(seconds) {
	if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
	if (seconds >= 3600) {
		return `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min`;
	}
	return `${Math.round(seconds / 60)} min`;
}

// Detail page for a single album: album art, artist, year, genres and its
// track list. Header, cards and buttons follow the LibraryCollectionPage
// styling (same as the track details page).
export default function AlbumDetailPage() {
	const { albumId } = useParams();
	const location = useLocation();
	const navigate = useNavigate();
	const { session, isAuthenticated, openServerModal, libraryVersion } = useJellyfin();
	const { currentTrack, isPlaying, playTrack, togglePlay, playNext, playLast } = usePlayer();

	// Route state passed by the track page / album cards allows an instant
	// render; the fresh fetches replace it right after.
	const [album, setAlbum] = useState(location.state?.entity || null);
	const [albumTitle, setAlbumTitle] = useState(location.state?.title || "");
	const [tracks, setTracks] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		setAlbum(location.state?.entity || null);
		setAlbumTitle(location.state?.title || "");
		setTracks([]);
		setError("");
		// Virtual albums ("album:<artistId>@<name>") have no server entity
		// and are resolved by grouping tracks on their Album tag and album
		// artist. Real ids must be 32-char hex Jellyfin item ids; anything
		// else has nothing to fetch.
		const virtualAlbum = getVirtualAlbumName(albumId);
		const isValidId = /^[0-9a-f]{32}$/i.test(albumId || "");
		if (!isAuthenticated || !session || (!isValidId && !virtualAlbum)) return undefined;

		let cancelled = false;
		const load = async () => {
			setIsLoading(true);
			try {
				if (virtualAlbum) {
					const allTracks = await fetchMusicCollection(
						session.serverUrl,
						session.userId,
						session.accessToken,
					);
					if (cancelled) return;
					const groupKey = virtualAlbum.name.trim().toLowerCase();
					const albumTracks = allTracks.filter((track) => {
						if ((track.album || "").trim().toLowerCase() !== groupKey) return false;
						if (!virtualAlbum.artistId) return true;
						const trackArtistId = track.raw?.AlbumArtists?.[0]?.Id
							|| track.raw?.ArtistItems?.[0]?.Id
							|| null;
						return trackArtistId === virtualAlbum.artistId;
					});
					const first = albumTracks[0] || null;
					if (first) {
						const name = first.album.trim();
						setAlbum({
							id: albumId,
							title: name,
							artist: first.raw?.AlbumArtists?.[0]?.Name || first.artist || "",
							cover: first.cover || null,
							isJellyfin: true,
							isVirtual: true,
							raw: {},
						});
						setAlbumTitle(name || location.state?.title || virtualAlbum.name);
					}
					setTracks(albumTracks);
					return;
				}

				const [entity, albumTracks] = await Promise.all([
					fetchMusicItem(session.serverUrl, session.userId, session.accessToken, albumId),
					fetchMusicCollection(session.serverUrl, session.userId, session.accessToken, {
						parentId: albumId,
					}),
				]);
				if (cancelled) return;
				if (entity?.isJellyfin) {
					setAlbum(entity);
					setAlbumTitle(entity.title || location.state?.title || "Album");
				}
				setTracks(albumTracks);
			} catch (loadError) {
				console.error("Failed to load album:", loadError);
				if (!cancelled) {
					setError(navigator.onLine
						? "Could not load this album. Please try again."
						: "You are offline and this album was not cached.");
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated, session, albumId, libraryVersion, location.state?.entity, location.state?.title]);

	const isVirtualAlbum = Boolean(album?.isVirtual);
	const raw = album?.raw || {};
	const albumArtist = album?.artist || "";
	const artistId = raw.AlbumArtists?.[0]?.Id
		|| raw.ArtistItems?.[0]?.Id
		|| (isVirtualAlbum
			? tracks[0]?.raw?.AlbumArtists?.[0]?.Id || tracks[0]?.raw?.ArtistItems?.[0]?.Id
			: null)
		|| null;
	const year = raw.ProductionYear
		? String(raw.ProductionYear)
		: (isVirtualAlbum && tracks[0]?.raw?.ProductionYear ? String(tracks[0].raw.ProductionYear) : "");
	const genres = Array.isArray(raw.Genres) && raw.Genres.length > 0
		? raw.Genres.join(", ")
		: (isVirtualAlbum
			? [...new Set(tracks.flatMap((track) => (
				Array.isArray(track.raw?.Genres) ? track.raw.Genres : []
			)))].join(", ")
			: "");
	const totalSeconds = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
	const isCurrentAlbum = Boolean(currentTrack && tracks.some((track) => track.id === currentTrack.id));

	const playFromList = (track) => {
		const index = tracks.findIndex((item) => item.id === track.id);
		playTrack(track, index < 0 ? [track] : tracks.slice(index));
	};

	const handlePlay = () => {
		if (tracks.length === 0) return;
		if (isCurrentAlbum) {
			togglePlay();
			return;
		}
		playTrack(tracks[0], tracks);
	};

	const handlePlayNext = () => {
		if (tracks.length === 0) return;
		if (!currentTrack) {
			playTrack(tracks[0], tracks);
			return;
		}
		// playNext inserts right after the current track, so queueing in
		// reverse keeps the album's order intact.
		for (let index = tracks.length - 1; index >= 0; index -= 1) {
			playNext(tracks[index]);
		}
	};

	const handleQueue = () => {
		if (tracks.length === 0) return;
		if (!currentTrack) {
			playTrack(tracks[0], tracks);
			return;
		}
		tracks.forEach((track) => playLast(track));
	};

	const summaryParts = [
		year,
		genres,
		tracks.length > 0 ? `${tracks.length} tracks` : "",
		formatTotalDuration(totalSeconds),
	];

	return (
		<div className="flex flex-col">
			{/* Header */}
			<header className="sticky top-0 z-30 flex items-center gap-2 bg-[#0a0a0d] py-7">
				<button
					type="button"
					onClick={() => navigate(-1)}
					aria-label="Back to Albums"
					className="flex h-8 w-8 shrink-0 items-center justify-center text-zinc-400 transition hover:text-white"
				>
					<IconChevronLeft size={16} />
				</button>
				<div className="flex min-w-0 items-center gap-2">
					<IconDisc size={19} stroke={1.7} className="shrink-0" />
					<h1 className="truncate text-xl font-bold tracking-tight text-white">
						{albumTitle || album?.title || "Album"}
					</h1>
					{tracks.length > 0 && (
						<span className="shrink-0 rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
							{tracks.length}
						</span>
					)}
				</div>
			</header>

			{!isAuthenticated ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xs border border-blue-500/20 bg-blue-500/10 text-blue-400">
						<IconServer size={24} />
					</div>
					<h2 className="text-sm font-semibold text-zinc-200">Server Not Connected</h2>
					<p className="mb-4 mt-1 max-w-sm text-xs text-zinc-400">
						Connect to Jellyfin to browse your music library.
					</p>
					<button
						type="button"
						onClick={openServerModal}
						className="rounded-xs bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
					>
						Connect Server
					</button>
				</div>
			) : error ? (
				<div className="py-16 text-center text-xs text-red-400">{error}</div>
			) : !album && isLoading ? (
				<div className="py-16 text-center text-xs text-zinc-500">Loading album…</div>
			) : !album ? (
				<div className="py-16 text-center">
					<IconDisc size={30} className="mx-auto mb-2 text-zinc-600" />
					<p className="text-sm font-medium text-zinc-400">Album not found</p>
					<p className="mt-1 text-xs text-zinc-600">
						It may have been removed from the library.
					</p>
				</div>
			) : (
				<>
					{/* Hero */}
					<section className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-start">
						<div className="aspect-square w-40 shrink-0 overflow-hidden rounded-xs border border-[#22222a] bg-[#141419] sm:w-48">
							<Artwork src={album.cover} alt={albumTitle} className="h-full w-full object-cover" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold text-zinc-100">
								{artistId && albumArtist ? (
									<button
										type="button"
										onClick={() => navigate(`/artists/${artistId}`, { state: { title: albumArtist } })}
										className="w-fit cursor-pointer hover:underline underline-offset-2"
									>
										{albumArtist}
									</button>
								) : (
									albumArtist || "Unknown artist"
								)}
							</p>
							{summaryParts.length > 0 && (
								<p className="mt-1 truncate text-xs text-zinc-500">
									{summaryParts.join(" · ")}
								</p>
							)}

							<div className="mt-4 flex items-center gap-2">
								<button
									type="button"
									onClick={handlePlay}
									disabled={tracks.length === 0}
									className="flex items-center gap-2 rounded-xs bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50"
								>
									{isCurrentAlbum && isPlaying
										? <IconPlayerPauseFilled size={13} />
										: <IconPlayerPlayFilled size={13} />}
									{isCurrentAlbum && isPlaying ? "Pause" : "Play"}
								</button>
								<button
									type="button"
									onClick={handlePlayNext}
									disabled={tracks.length === 0}
									title="Play album next"
									aria-label="Play this album next"
									className="flex items-center gap-2 rounded-xs border border-[#2b2b36] bg-[#1a1a23] px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#252533] hover:text-white disabled:opacity-50"
								>
									<IconPlayerTrackNext size={14} stroke={1.8} />
									Play Next
								</button>
								<button
									type="button"
									onClick={handleQueue}
									disabled={tracks.length === 0}
									title="Add album to queue"
									aria-label="Add this album to the queue"
									className="flex items-center gap-2 rounded-xs border border-[#2b2b36] bg-[#1a1a23] px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#252533] hover:text-white disabled:opacity-50"
								>
									<IconPlaylistAdd size={14} stroke={1.8} />
									Add to Queue
								</button>
							</div>
						</div>
					</section>

					{/* Track list */}
					{tracks.length > 0 ? (
						<div className="overflow-hidden rounded-xs border border-[#22222a] bg-[#101014]">
							<div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-3 border-b border-[#22222a] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:grid-cols-[2rem_minmax(0,2fr)_4rem]">
								<span className="hidden sm:block">#</span>
								<span>Title</span>
								<span className="text-right">Time</span>
							</div>
							{tracks.map((track, index) => {
								const isCurrent = currentTrack?.id === track.id;
								return (
									<button
										key={track.id}
										type="button"
										onClick={() => playFromList(track)}
										className="grid w-full grid-cols-[minmax(0,1fr)_4rem] items-center gap-3 border-b border-[#1b1b22] px-3 py-2 text-left last:border-b-0 hover:bg-white/5 sm:grid-cols-[2rem_minmax(0,2fr)_4rem]"
									>
										<span className="hidden text-[11px] text-zinc-600 sm:block">{index + 1}</span>
										<span className="flex min-w-0 items-center gap-2">
											<Artwork src={track.cover} alt="" className="h-9 w-9 shrink-0 rounded-xs object-cover" />
											<span
												className={`block w-fit cursor-pointer truncate text-xs font-medium hover:text-white hover:underline underline-offset-2 ${isCurrent ? "text-blue-500" : "text-zinc-200"}`}
											>
												{track.title}
											</span>
										</span>
										<span className="text-right text-[11px] text-zinc-500">
											{formatDuration(track.duration)}
										</span>
									</button>
								);
							})}
						</div>
					) : (
						!isLoading && (
							<div className="py-16 text-center">
								<IconMusic size={30} className="mx-auto mb-2 text-zinc-600" />
								<p className="text-sm font-medium text-zinc-400">No tracks found</p>
								<p className="mt-1 text-xs text-zinc-600">This album is empty.</p>
							</div>
						)
					)}
				</>
			)}
		</div>
	);
}
