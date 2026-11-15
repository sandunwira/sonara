import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
	IconArrowsShuffle,
	IconChevronLeft,
	IconDots,
	IconMusic,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconPlayerTrackNext,
	IconPlaylistAdd,
	IconRosetteDiscountCheck,
	IconServer,
	IconUser,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { usePlayer } from "../context/PlayerContext";
import { fetchMusicCollection, fetchMusicItem, getTrackAlbumLink } from "../services/jellyfin";
import TrackPlayButton from "../components/TrackPlayButton";
import Artwork from "../components/Artwork";

function formatDuration(seconds) {
	if (!seconds || !Number.isFinite(seconds)) return "";
	return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

// Detail page for a single artist: artist image, genres, their albums and
// their tracks. Header, cards and buttons follow the LibraryCollectionPage
// styling (same as the track and album details pages).
export default function ArtistDetailPage() {
	const { artistId } = useParams();
	const location = useLocation();
	const navigate = useNavigate();
	const { session, isAuthenticated, openServerModal, libraryVersion } = useJellyfin();
	const {
		currentTrack,
		isPlaying,
		isShuffle,
		playTrack,
		togglePlay,
		toggleShuffle,
		playNext,
		playLast,
	} = usePlayer();

	// Route state passed by the album page / artist cards allows an instant
	// render; the fresh fetches replace it right after.
	const [artist, setArtist] = useState(location.state?.entity || null);
	const [artistName, setArtistName] = useState(location.state?.title || "");
	const [albums, setAlbums] = useState([]);
	const [tracks, setTracks] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isScrolled, setIsScrolled] = useState(false);
	const pageRef = useRef(null);

	useEffect(() => {
		const scrollContainer = pageRef.current?.closest("main");
		if (!scrollContainer) return undefined;

		const handleScroll = () => setIsScrolled(scrollContainer.scrollTop > 25);
		handleScroll();
		scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
		return () => scrollContainer.removeEventListener("scroll", handleScroll);
	}, []);

	useEffect(() => {
		setArtist(location.state?.entity || null);
		setArtistName(location.state?.title || "");
		setAlbums([]);
		setTracks([]);
		setError("");
		// Jellyfin item ids are 32-char hex strings; anything else (e.g. a
		// literal "undefined" from a stale link) has nothing to fetch.
		const isValidId = /^[0-9a-f]{32}$/i.test(artistId || "");
		if (!isAuthenticated || !session || !isValidId) return undefined;

		let cancelled = false;
		const load = async () => {
			setIsLoading(true);
			try {
				const [entity, artistAlbums, artistTracks] = await Promise.all([
					fetchMusicItem(session.serverUrl, session.userId, session.accessToken, artistId),
					fetchMusicCollection(session.serverUrl, session.userId, session.accessToken, {
						artistId,
						includeItemTypes: ["MusicAlbum"],
						formatEntities: true,
						sortBy: "ProductionYear",
						sortOrder: "Descending",
					}),
					fetchMusicCollection(session.serverUrl, session.userId, session.accessToken, {
						artistId,
					}),
				]);
				if (cancelled) return;
				if (entity?.isJellyfin) {
					setArtist(entity);
					setArtistName(entity.title || location.state?.title || "Artist");
				}
				setAlbums(artistAlbums);
				setTracks(artistTracks);
			} catch (loadError) {
				console.error("Failed to load artist:", loadError);
				if (!cancelled) {
					setError(navigator.onLine
						? "Could not load this artist. Please try again."
						: "You are offline and this artist was not cached.");
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated, session, artistId, libraryVersion, location.state?.entity, location.state?.title]);

	const raw = artist?.raw || {};
	const isCurrentArtist = Boolean(currentTrack && tracks.some((track) => track.id === currentTrack.id));

	const playFromList = (track) => {
		const index = tracks.findIndex((item) => item.id === track.id);
		playTrack(track, index < 0 ? [track] : tracks.slice(index));
	};

	const handlePlay = () => {
		if (tracks.length === 0) return;
		if (isCurrentArtist) {
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
		// reverse keeps the intended order intact.
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
			) : !artist && isLoading ? (
				<div className="py-16 text-center text-xs text-zinc-500">Loading artist…</div>
			) : !artist ? (
				<div className="py-16 text-center">
					<IconUser size={30} className="mx-auto mb-2 text-zinc-600" />
					<p className="text-sm font-medium text-zinc-400">Artist not found</p>
					<p className="mt-1 text-xs text-zinc-600">
						They may have been removed from the library.
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
					</div>

					<section className="-mx-7 -mt-16 bg-[#141419] flex items-center justify-center h-72">
						{artist.cover ? (
							<div
								className="h-full w-full flex flex-col justify-end bg-[#141419] bg-cover bg-center"
								style={{ backgroundImage: `linear-gradient(#0a0a0d00, #0a0a0da0, #0a0a0dff), url(${artist.cover})`, backgroundSize: "cover", backgroundPosition: "center" }}
							>
								<div className="p-7 pb-6">
									<h1 className="wrap-break-word text-4xl font-extrabold leading-none tracking-tighter text-white sm:text-6xl">
										{artistName || artist?.title || "Artist"}
									</h1>
									<p className="mt-1 text-xs text-zinc-300">
										{[
											albums.length > 0 ? `${albums.length} album${albums.length === 1 ? "" : "s"}` : "",
											tracks.length > 0 ? `${tracks.length} track${tracks.length === 1 ? "" : "s"}` : "",
										].filter(Boolean).join(" · ")}
									</p>
								</div>
							</div>
						) : (
							<IconUser size={64} className="text-zinc-700" />
						)}
					</section>

					{/* Action bar: large play pill, shuffle toggle and an overflow menu holding the queue actions. */}
					<div className="mb-6 flex items-center gap-5 py-4">
						<button
							type="button"
							onClick={handlePlay}
							disabled={tracks.length === 0}
							title={isCurrentArtist && isPlaying ? "Pause" : "Play"}
							aria-label={isCurrentArtist && isPlaying ? "Pause this artist" : "Play this artist"}
							className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
						>
							{isCurrentArtist && isPlaying
								? <IconPlayerPauseFilled size={20} />
								: <IconPlayerPlayFilled size={20} />}
						</button>
						<button
							type="button"
							onClick={handleShuffle}
							disabled={tracks.length === 0}
							title="Shuffle play"
							aria-label="Shuffle play this artist"
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

					{/* Hero banner: full-bleed artist image with the name and library counts anchored bottom-left */}
					{/* <section className="relative -mx-7 overflow-hidden bg-[#141419] h-72">
						{artist.cover ? (
							<Artwork
								src={artist.cover}
								alt={artistName}
								className="absolute inset-0 h-full w-full object-cover object-center"
							/>
						) : (
							<IconUser size={64} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-700" />
						)}
						<div className="absolute inset-0 bg-linear-to-t from-[#0a0a0d] via-[#0a0a0d]/20 to-transparent" />
						<div className="absolute inset-0 bg-linear-to-r from-[#0a0a0d]/70 via-transparent to-transparent" />

						<button
							type="button"
							onClick={() => navigate(-1)}
							aria-label="Go back"
							className="absolute left-5 top-5 z-10 flex h-9 w-9 items-center justify-center backdrop-blur-md rounded-full border border-zinc-500 text-zinc-200 transition hover:text-white cursor-pointer"
						>
							<IconChevronLeft size={18} />
						</button>

						<div className="absolute inset-x-0 bottom-0 z-10 p-7 pb-6">
							<h1 className="wrap-break-word text-4xl font-extrabold leading-none tracking-tighter text-white sm:text-6xl">
								{artistName || artist?.title || "Artist"}
							</h1>
							<p className="mt-1 text-xs text-zinc-300">
								{[
									albums.length > 0 ? `${albums.length} album${albums.length === 1 ? "" : "s"}` : "",
									tracks.length > 0 ? `${tracks.length} track${tracks.length === 1 ? "" : "s"}` : "",
								].filter(Boolean).join(" · ")}
							</p>
						</div>
					</section> */}

					{/* Action bar: large play pill, shuffle toggle and an overflow menu holding the queue actions. */}
					{/* <div className="mb-6 flex items-center gap-5 py-4">
						<button
							type="button"
							onClick={handlePlay}
							disabled={tracks.length === 0}
							title={isCurrentArtist && isPlaying ? "Pause" : "Play"}
							aria-label={isCurrentArtist && isPlaying ? "Pause this artist" : "Play this artist"}
							className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
						>
							{isCurrentArtist && isPlaying
								? <IconPlayerPauseFilled size={20} />
								: <IconPlayerPlayFilled size={20} />}
						</button>
						<button
							type="button"
							onClick={handleShuffle}
							disabled={tracks.length === 0}
							title="Shuffle play"
							aria-label="Shuffle play this artist"
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
					</div> */}

					{/* Albums */}
					{albums.length > 0 && (
						<section className="mb-6">
							<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
								Albums
							</p>
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
								{albums.map((album) => (
									<button
										key={album.id}
										type="button"
										onClick={() => navigate(`/albums/${album.id}`, { state: { title: album.title || album.name } })}
										className="group min-w-0 text-left"
									>
										<div className="relative aspect-square overflow-hidden rounded-xs border border-[#22222a] bg-[#141419]">
											<Artwork
												src={album.cover}
												alt=""
												className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
											/>
										</div>
										<span className="mt-2 block truncate text-xs font-semibold text-zinc-100 group-hover:text-white">
											{album.title || album.name}
										</span>
										{album.raw?.ProductionYear && (
											<span className="block truncate text-[10px] text-zinc-500">
												{album.raw.ProductionYear}
											</span>
										)}
									</button>
								))}
							</div>
						</section>
					)}

					{/* Tracks */}
					{tracks.length > 0 && (
						<section>
							<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
								Tracks
							</p>
							<div className="overflow-hidden rounded-xs border border-[#22222a] bg-[#101014]">
								<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] gap-3 border-b border-[#22222a] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_4rem]">
									<span className="hidden sm:block">#</span>
									<span>Title</span>
									<span className="hidden truncate sm:block">Album</span>
									<span className="text-right">Time</span>
								</div>
								{tracks.map((track, index) => {
									const isCurrent = currentTrack?.id === track.id;
									const albumLink = getTrackAlbumLink(track);
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
											className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] items-center gap-3 border-b border-[#1b1b22] px-3 py-2 text-left last:border-b-0 hover:bg-white/5 focus:outline-none focus-visible:bg-white/5 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_4rem]"
										>
											<TrackPlayButton
												index={index}
												isCurrent={isCurrent}
												isPlaying={isPlaying}
												onPlay={() => playFromList(track)}
												onTogglePlay={togglePlay}
											/>
											<span className="flex min-w-0 items-center gap-2">
												<Artwork src={track.cover} alt="" className="h-9 w-9 shrink-0 rounded-xs object-cover" />
												<span
													onClick={(event) => {
														event.stopPropagation();
														navigate(`/tracks/${track.id}`, { state: { track } });
													}}
													title="View track details"
													className={`block cursor-pointer truncate text-xs font-medium hover:text-white hover:underline underline-offset-2 ${isCurrent ? "text-blue-500" : "text-zinc-200"}`}
												>
													{track.title}
												</span>
											</span>
											{albumLink ? (
												<span
													onClick={(event) => {
														event.stopPropagation();
														navigate(`/albums/${albumLink.id}`, { state: { title: track.album } });
													}}
													title="View album"
													className="block cursor-pointer truncate text-xs text-zinc-500 hover:text-white hover:underline underline-offset-2"
												>
													{track.album}
												</span>
											) : (
												<span className="block truncate text-xs text-zinc-500">{track.album}</span>
											)}
											<span className="text-right text-[11px] text-zinc-500">
												{formatDuration(track.duration)}
											</span>
										</div>
									);
								})}
							</div>
						</section>
					)}

					{albums.length === 0 && tracks.length === 0 && !isLoading && (
						<div className="py-16 text-center">
							<IconMusic size={30} className="mx-auto mb-2 text-zinc-600" />
							<p className="text-sm font-medium text-zinc-400">No music found</p>
							<p className="mt-1 text-xs text-zinc-600">
								This artist has no albums or tracks in the library.
							</p>
						</div>
					)}
				</>
			)}
		</div>
	);
}
