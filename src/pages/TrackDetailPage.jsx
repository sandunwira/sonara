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
import { fetchMusicItem, getTrackAlbumLink } from "../services/jellyfin";
import Artwork from "../components/Artwork";

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
		<div className="flex flex-col">
			{/* Header */}
			<header className="sticky top-0 z-30 flex items-center gap-2 bg-[#0a0a0d] py-7">
				<button
					type="button"
					onClick={() => navigate(-1)}
					aria-label="Back to Tracks"
					className="flex h-8 w-8 shrink-0 items-center justify-center text-zinc-400 transition hover:text-white"
				>
					<IconChevronLeft size={16} />
				</button>
				<div className="flex min-w-0 items-center gap-2">
					<IconMusic size={19} stroke={1.7} className="shrink-0" />
					<h1 className="truncate text-xl font-bold tracking-tight text-white">
						{track?.title || "Track"}
					</h1>
					{track?.duration && (
						<span className="shrink-0 rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
							{formatDuration(track.duration)}
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
					{/* Hero */}
					<section className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-start">
						<div className="aspect-square w-40 shrink-0 overflow-hidden rounded-xs border border-[#22222a] bg-[#141419] sm:w-48">
							<Artwork src={track.cover} alt={track.title} className="h-full w-full object-cover" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold text-zinc-100">{track.artist}</p>
							{track.album && (
								<button
									type="button"
									onClick={() => {
										const albumLink = getTrackAlbumLink(track);
										if (albumLink) navigate(`/albums/${albumLink.id}`, { state: { title: track.album } });
									}}
									disabled={!getTrackAlbumLink(track)}
									className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-zinc-500 transition hover:text-white disabled:cursor-default"
								>
									<IconDisc size={13} stroke={1.8} />
									<span className="truncate">
										{track.album}
										{raw.ProductionYear ? ` · ${raw.ProductionYear}` : ""}
									</span>
								</button>
							)}

							<div className="mt-4 flex items-center gap-2">
								<button
									type="button"
									onClick={handlePlay}
									className="flex items-center gap-2 rounded-xs bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-[0.99]"
								>
									{isCurrentTrack && isPlaying
										? <IconPlayerPauseFilled size={13} />
										: <IconPlayerPlayFilled size={13} />}
									{isCurrentTrack && isPlaying ? "Pause" : "Play"}
								</button>
								<button
									type="button"
									onClick={() => playNext(track)}
									title="Play next"
									aria-label="Play this track next"
									className="flex items-center gap-2 rounded-xs border border-[#2b2b36] bg-[#1a1a23] px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#252533] hover:text-white"
								>
									<IconPlayerTrackNext size={14} stroke={1.8} />
									Play Next
								</button>
								<button
									type="button"
									onClick={() => playLast(track)}
									title="Add to queue"
									aria-label="Add this track to the queue"
									className="flex items-center gap-2 rounded-xs border border-[#2b2b36] bg-[#1a1a23] px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#252533] hover:text-white"
								>
									<IconPlaylistAdd size={14} stroke={1.8} />
									Add to Queue
								</button>
							</div>
						</div>
					</section>

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
