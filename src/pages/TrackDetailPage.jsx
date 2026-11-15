import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
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
import { fetchMusicItem, getTrackAlbumLink } from "../services/jellyfin";

function formatDuration(seconds) {
	if (!seconds || !Number.isFinite(seconds)) return "";
	return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatDate(iso) {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Detail page for a single track: album art plus title, artists, album, year
// and other metadata from the Jellyfin item. Header, cards and buttons follow
// the LibraryCollectionPage styling.
export default function TrackDetailPage() {
	const { trackId } = useParams();
	const location = useLocation();
	const navigate = useNavigate();
	const { session, isAuthenticated, openServerModal, libraryVersion } = useJellyfin();
	const { currentTrack, isPlaying, playTrack, togglePlay, playNext, playLast } = usePlayer();

	// The queue/track list can pass the track object along for an instant
	// render; it is replaced by the fresh fetch right after.
	const [track, setTrack] = useState(location.state?.track || null);
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
		setTrack(location.state?.track || null);
		setError("");
		// Jellyfin item ids are 32-char hex strings; anything else (e.g. a
		// literal "undefined" from a stale link) has nothing to fetch.
		const isValidId = /^[0-9a-f]{32}$/i.test(trackId || "");
		if (!isAuthenticated || !session || !isValidId) return undefined;

		let cancelled = false;
		const load = async () => {
			setIsLoading(true);
			try {
				const item = await fetchMusicItem(
					session.serverUrl,
					session.userId,
					session.accessToken,
					trackId,
				);
				if (!cancelled && item?.isJellyfin) {
					setTrack(item);
				}
			} catch (loadError) {
				console.error("Failed to load track:", loadError);
				if (!cancelled) {
					setError(navigator.onLine
						? "Could not load this track. Please try again."
						: "You are offline and this track was not cached.");
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated, session, trackId, libraryVersion, location.state?.track]);

	const isCurrentTrack = Boolean(currentTrack && currentTrack.id === trackId);
	const raw = track?.raw || {};
	const trackGenres = Array.isArray(raw.Genres) ? raw.Genres.join(", ") : "";
	const trackNumber = raw.IndexNumber
		? (raw.ParentIndexNumber ? `Disc ${raw.ParentIndexNumber} · Track ${raw.IndexNumber}` : `Track ${raw.IndexNumber}`)
		: null;
	const audioFormat = [
		raw.Container ? String(raw.Container).toUpperCase() : null,
		raw.Bitrate ? `${Math.round(raw.Bitrate / 1000)} kbps` : null,
	].filter(Boolean).join(" · ");
	const detailRows = [
		["Artist", track?.artist],
		["Album", track?.album],
		["Year", raw.ProductionYear ? String(raw.ProductionYear) : ""],
		["Duration", formatDuration(track?.duration)],
		["Genres", trackGenres],
		["Position", trackNumber],
		["Format", audioFormat],
		["Plays", raw.UserData?.PlayCount ? String(raw.UserData.PlayCount) : ""],
		["Last played", formatDate(raw.UserData?.LastPlayedDate)],
	].filter(([, value]) => value !== null && value !== undefined && value !== "");

	const handlePlay = () => {
		if (!track) return;
		if (isCurrentTrack) {
			togglePlay();
			return;
		}
		playTrack(track, [track]);
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
			) : !track && isLoading ? (
				<div className="py-16 text-center text-xs text-zinc-500">Loading track…</div>
			) : !track ? (
				<div className="py-16 text-center">
					<IconMusic size={30} className="mx-auto mb-2 text-zinc-600" />
					<p className="text-sm font-medium text-zinc-400">Track not found</p>
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
							{track?.title || "Track"}
						</span>
					</div>

					{/* Hero banner: full-bleed album cover with the track title, artist
					    and album links anchored bottom-left (same layout as the artist
					    and album pages). */}
					<section className="-mx-7 -mt-16 bg-[#141419] flex items-center justify-center h-72">
						{track.cover ? (
							<div
								className="h-full w-full flex flex-col justify-end bg-[#141419]"
								style={{ backgroundImage: `linear-gradient(#0a0a0d00, #0a0a0da0, #0a0a0dff), url(${track.cover})`, backgroundSize: "cover", backgroundPosition: "center" }}
							>
								<div className="p-7 pb-6">
									<h1 className="wrap-break-word text-4xl font-extrabold leading-none tracking-tighter text-white sm:text-6xl">
										{track.title || "Track"}
									</h1>
									<p className="mt-2 truncate text-xs text-zinc-300">
										{track.artistId ? (
											<button
												type="button"
												onClick={() => navigate(`/artists/${track.artistId}`, { state: { title: track.artist } })}
												title="View artist"
												className="cursor-pointer font-semibold text-zinc-100 hover:underline underline-offset-2"
											>
												{track.artist}
											</button>
										) : (
											<span className="font-semibold text-zinc-100">{track.artist}</span>
										)}
									</p>
									{track.album && (
										<button
											type="button"
											onClick={() => {
												const albumLink = getTrackAlbumLink(track);
												if (albumLink) navigate(`/albums/${albumLink.id}`, { state: { title: track.album } });
											}}
											disabled={!getTrackAlbumLink(track)}
											className="mt-1 flex w-fit items-center gap-1.5 truncate text-xs text-zinc-300 transition hover:text-white disabled:cursor-default"
										>
											<IconDisc size={13} stroke={1.8} />
											<span className="truncate">
												{track.album}
												{raw.ProductionYear ? ` · ${raw.ProductionYear}` : ""}
											</span>
										</button>
									)}
								</div>
							</div>
						) : (
							<IconMusic size={64} className="text-zinc-700" />
						)}
					</section>

					{/* Action bar: large play pill and an overflow menu holding the
					    queue actions (single track, so no shuffle toggle). */}
					<div className="mb-6 flex items-center gap-5 py-4">
						<button
							type="button"
							onClick={handlePlay}
							title={isCurrentTrack && isPlaying ? "Pause" : "Play"}
							aria-label={isCurrentTrack && isPlaying ? "Pause this track" : "Play this track"}
							className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-500 cursor-pointer"
						>
							{isCurrentTrack && isPlaying
								? <IconPlayerPauseFilled size={20} />
								: <IconPlayerPlayFilled size={20} />}
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
												playNext(track);
												setIsMenuOpen(false);
											}}
											title="Play next"
											className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white"
										>
											<IconPlayerTrackNext size={14} stroke={1.8} />
											Play Next
										</button>
										<button
											type="button"
											onClick={() => {
												playLast(track);
												setIsMenuOpen(false);
											}}
											title="Add to queue"
											className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white"
										>
											<IconPlaylistAdd size={14} stroke={1.8} />
											Add to Queue
										</button>
									</div>
								</>
							)}
						</div>
					</div>

					{/* Metadata */}
					<section>
						<div className="overflow-hidden rounded-xs border border-[#22222a] bg-[#101014]">
							{detailRows.map(([label, value], index) => (
								<div
									key={label}
									className={`grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-3 py-2 ${index > 0 ? "border-t border-[#1b1b22]" : ""}`}
								>
									<span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
										{label}
									</span>
									<span className="wrap-break-word text-xs text-zinc-200">{value}</span>
								</div>
							))}
						</div>
					</section>
				</>
			)}
		</div>
	);
}
