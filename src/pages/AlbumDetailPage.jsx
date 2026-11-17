import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
	IconArrowsShuffle,
	IconChevronLeft,
	IconDisc,
	IconDots,
	IconMusic,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconPlayerTrackNext,
	IconPlaylistAdd,
	IconServer,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { usePlayer } from "../context/PlayerContext";
import { fetchMusicCollection, fetchMusicItem, getThumbnailUrl, getVirtualAlbumName } from "../services/jellyfin";
import TrackPlayButton from "../components/TrackPlayButton";
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
	const { currentTrack, isPlaying, isShuffle, playTrack, togglePlay, toggleShuffle, playNext, playLast } = usePlayer();

	// Route state passed by the track page / album cards allows an instant
	// render; the fresh fetches replace it right after.
	const [album, setAlbum] = useState(location.state?.entity || null);
	const [albumTitle, setAlbumTitle] = useState(location.state?.title || "");
	const [tracks, setTracks] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isScrolled, setIsScrolled] = useState(false);
	// The title fades into the sticky bar once the hero's own title has scrolled out of view.
	const [showHeaderTitle, setShowHeaderTitle] = useState(false);
	const pageRef = useRef(null);

	useEffect(() => {
		const scrollContainer = pageRef.current?.closest("main");
		if (!scrollContainer) return undefined;

		const handleScroll = () => {
			setIsScrolled(scrollContainer.scrollTop > 25);
			setShowHeaderTitle(scrollContainer.scrollTop > 120);
		};
		handleScroll();
		scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
		return () => scrollContainer.removeEventListener("scroll", handleScroll);
	}, []);

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

	const handleShuffle = () => {
		if (tracks.length === 0) return;
		if (!isShuffle) toggleShuffle();
		const randomIndex = Math.floor(Math.random() * tracks.length);
		playTrack(tracks[randomIndex], tracks);
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
		<div ref={pageRef} className="flex flex-col">
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
					<div
						className={`flex flex-row items-center sticky top-0 -mx-7 px-5 py-3.5 ${
							isScrolled ? "backdrop-blur-md bg-linear-to-b from-[#0a0a0d]/75 via-[#0a0a0d]/50 to-transparent" : "backdrop-blur-none bg-linear-to-b from-transparent via-transparent to-transparent"
						} transition-all duration-400`}
					>
						<button
							type="button"
							onClick={() => navigate(-1)}
							aria-label="Go back"
							className="flex h-9 w-9 items-center justify-center backdrop-blur-md rounded-full transition border border-zinc-500 text-zinc-200 hover:text-white bg-black/15 cursor-pointer"
						>
							<IconChevronLeft size={18} />
						</button>
						<span
							className={`ml-3 min-w-0 truncate text-sm font-bold tracking-tight text-white transition-all duration-300 ${showHeaderTitle ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
						>
							{albumTitle || album?.title || "Album"}
						</span>
					</div>

					{/* Hero banner: full-bleed album cover with the title, artist link
					    and summary anchored bottom-left (same layout as the artist page). */}
					<section className="-mx-7 -mt-16 bg-[#141419] flex items-center justify-center h-72">
						{album.cover ? (
							<div
								className="h-full w-full flex flex-col justify-end bg-[#141419]"
								style={{ backgroundImage: `linear-gradient(#0a0a0d00, #0a0a0da0, #0a0a0dff), url(${album.cover})`, backgroundSize: "cover", backgroundPosition: "center" }}
							>
								<div className="p-7 pb-6">
									<h1 className="font-display wrap-break-word text-4xl font-extrabold leading-none tracking-tighter text-white sm:text-6xl">
										{albumTitle || album?.title || "Album"}
									</h1>
									<p className="mt-2 truncate text-xs text-zinc-300">
										{artistId && albumArtist ? (
											<button
												type="button"
												onClick={() => navigate(`/artists/${artistId}`, { state: { title: albumArtist } })}
												title="View artist"
												className="cursor-pointer font-semibold text-zinc-100 hover:underline underline-offset-2"
											>
												{albumArtist}
											</button>
										) : (
											<span className="font-semibold text-zinc-100">{albumArtist || "Unknown artist"}</span>
										)}
										{summaryParts.filter(Boolean).length > 0 && (
											<span> · {summaryParts.filter(Boolean).join(" · ")}</span>
										)}
									</p>
								</div>
							</div>
						) : (
							<IconDisc size={64} className="text-zinc-700" />
						)}
					</section>

					{/* Action bar: large play pill, shuffle toggle and an overflow menu holding the queue actions. */}
					<div className="mb-6 flex items-center gap-5 py-4">
						<button
							type="button"
							onClick={handlePlay}
							disabled={tracks.length === 0}
							title={isCurrentAlbum && isPlaying ? "Pause" : "Play"}
							aria-label={isCurrentAlbum && isPlaying ? "Pause this album" : "Play this album"}
							className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
						>
							{isCurrentAlbum && isPlaying
								? <IconPlayerPauseFilled size={20} />
								: <IconPlayerPlayFilled size={20} />}
						</button>
						<button
							type="button"
							onClick={handleShuffle}
							disabled={tracks.length === 0}
							title="Shuffle play"
							aria-label="Shuffle play this album"
							className={`transition disabled:opacity-40 cursor-pointer disabled:cursor-default ${isShuffle ? "text-blue-500" : "text-zinc-400 hover:text-white disabled:hover:text-zinc-400"}`}
						>
							<IconArrowsShuffle size={20} />
						</button>
						<div className="relative">
							<button
								type="button"
								onClick={() => setIsMenuOpen((open) => !open)}
								title="More actions"
								aria-label="More actions"
								className="p-1 text-zinc-400 transition hover:text-white"
							>
								<IconDots size={20} />
							</button>
							{isMenuOpen && (
								<>
									<div
										className="fixed inset-0 z-40"
										onClick={() => setIsMenuOpen(false)}
									/>
									<div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xs border border-[#2b2b36] bg-[#18181f] py-1 shadow-xl">
										<button
											type="button"
											onClick={() => {
												handlePlayNext();
												setIsMenuOpen(false);
											}}
											disabled={tracks.length === 0}
											className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
										>
											<IconPlayerTrackNext size={14} stroke={1.8} />
											Play Next
										</button>
										<button
											type="button"
											onClick={() => {
												handleQueue();
												setIsMenuOpen(false);
											}}
											disabled={tracks.length === 0}
											className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
										>
											<IconPlaylistAdd size={14} stroke={1.8} />
											Add to Queue
										</button>
									</div>
								</>
							)}
						</div>
					</div>

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
									<div
										key={track.id}
										role="button"
										tabIndex={0}
										onClick={() => playFromList(track)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												playFromList(track);
											}
										}}
										aria-label={`Play ${track.title || "track"}`}
										className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_4rem] items-center gap-3 border-b border-[#1b1b22] px-3 py-2 text-left last:border-b-0 hover:bg-white/5 focus:outline-none focus-visible:bg-white/5 sm:grid-cols-[2rem_minmax(0,2fr)_4rem]"
									>
										<TrackPlayButton
											index={index}
											isCurrent={isCurrent}
											isPlaying={isPlaying}
											onPlay={() => playFromList(track)}
											onTogglePlay={togglePlay}
										/>
										<span className="flex min-w-0 items-center gap-2">
											<Artwork src={track.cover ? getThumbnailUrl(track.cover, 96) : track.cover} alt="" className="h-9 w-9 shrink-0 rounded-xs object-cover" />
											<span
												className={`block w-fit cursor-pointer truncate text-xs font-medium hover:text-white hover:underline underline-offset-2 ${isCurrent ? "text-blue-500" : "text-zinc-200"}`}
											>
												{track.title}
											</span>
										</span>
										<span className="text-right text-[11px] text-zinc-500">
											{formatDuration(track.duration)}
										</span>
									</div>
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
