import {
	IconArrowsShuffle,
	IconPlayerSkipBackFilled,
	IconPlayerSkipForwardFilled,
	IconPlayerPlayFilled,
	IconPlayerPauseFilled,
	IconRepeat,
	IconRepeatOnce,
	IconLayoutList,
	IconLayoutListFilled,
	IconPictureInPicture,
	IconDeviceSpeaker,
	IconHeart,
	IconVolume2,
	IconVolume,
	IconVolumeOff,
	IconMaximize,
	IconDots,
	IconMusic,
} from "@tabler/icons-react";
import { usePlayer, usePlayerProgress } from "../context/PlayerContext";
import { useJellyfin } from "../context/JellyfinContext";
import { fetchMusicArtists, getThumbnailUrl } from "../services/jellyfin";
import useFavoriteToggle from "../hooks/useFavoriteToggle";
import Artwork from "../components/Artwork";
import { useNavigate } from "react-router-dom";

function formatSeconds(sec) {
	if (!sec || isNaN(sec) || !isFinite(sec)) return "0:00";
	const minutes = Math.floor(sec / 60);
	const seconds = Math.floor(sec % 60);
	return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

// Progress ticks ~4x/second. Keeping the subscription in this small child
// means the rest of the player bar (artwork, buttons, volume) is not
// re-rendered while a track plays.
function PlayerProgressBar({ seek, fallbackDuration }) {
	const { currentTime, duration } = usePlayerProgress();
	const validDuration = duration && duration > 0 ? duration : (fallbackDuration || 180);
	const progressPercent = Math.min(100, Math.max(0, (currentTime / validDuration) * 100));

	const handleSeek = (e) => {
		const newPercent = parseFloat(e.target.value);
		seek((newPercent / 100) * validDuration);
	};

	return (
		<div className="mt-1 flex w-full items-center gap-2">
			<span className="w-7 text-right text-[10px] text-zinc-400">
				{formatSeconds(currentTime)}
			</span>

			<div className="group relative flex flex-1 items-center">
				<input
					type="range"
					min="0"
					max="100"
					step="0.1"
					value={progressPercent}
					onChange={handleSeek}
					className="h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-white transition-all group-hover:h-1.5 focus:outline-none"
					style={{
						background: `linear-gradient(to right, #ffffff ${progressPercent}%, #272731 ${progressPercent}%)`,
					}}
				/>
			</div>

			<span className="w-7 text-left text-[10px] text-zinc-400">
				{formatSeconds(validDuration)}
			</span>
		</div>
	);
}

function BottomPlayerBar({ onTrackOptions, isQueuePanelOpen = false, toggleQueuePanel }) {
	const {
		currentTrack,
		isPlaying,
		volume,
		isMuted,
		setVolume,
		toggleMute,
		isShuffle,
		toggleShuffle,
		repeatMode,
		toggleRepeat,
		togglePlay,
		nextTrack,
		prevTrack,
		seek,
		queue,
		queueIndex,
	} = usePlayer();
	const { session } = useJellyfin();
	const navigate = useNavigate();

	// Shared favorite toggle for the currently playing track (same logic as
	// the track options menu: server-backed, optimistic, toasts on failure).
	const { isFavorite, toggleFavorite } = useFavoriteToggle(currentTrack);

	// Navigates to the clicked artist's page. Tracks fetched through
	// formatJellyfinTrack carry a persisted artistId; tracks restored from an
	// older saved queue don't, so those are resolved by name against the
	// (cached) artist list instead of landing on a broken url.
	const navigateToArtist = async () => {
		if (currentTrack.artistId) {
			navigate(`/artists/${currentTrack.artistId}`, { state: { title: currentTrack.artist } });
			return;
		}
		if (!session || !currentTrack.artist) return;
		try {
			const artists = await fetchMusicArtists(session.serverUrl, session.userId, session.accessToken);
			const match = artists.find((artist) => artist.name === currentTrack.artist)
				|| artists.find((artist) => currentTrack.artist.includes(artist.name));
			if (match) {
				navigate(`/artists/${match.id}`, { state: { title: currentTrack.artist } });
			}
		} catch {
			// Offline or lookup failed; do nothing rather than navigating to a bad url.
		}
	};

	const upcomingStartIndex = Math.max(queueIndex + 1, 0);
	const upcomingCount = Math.max(queue.length - upcomingStartIndex, 0);

	return (
		<footer className="relative z-40 flex h-20 w-full shrink-0 items-center justify-between border-t border-[#1b1b22] bg-[#0c0c0e] px-4 text-zinc-300">
			{/* Left section: Current playing track album art & details */}
			<div className="flex w-1/4 min-w-48 items-center gap-3">
				{currentTrack ? (
					<>
						<div className="group relative h-12 w-12 rounded-md bg-[#18181f] border border-[#22222a]">
							<Artwork
								src={currentTrack.cover ? getThumbnailUrl(currentTrack.cover, 96) : currentTrack.cover}
								alt={currentTrack.title}
								loading="eager"
								className="h-full w-full object-cover rounded-md"
							/>
						</div>

						<div className="flex min-w-0 flex-1 flex-col justify-center">
							<div className="flex items-center gap-1.5">
								<span
									onClick={(event) => {
										event.stopPropagation();
										navigate(`/tracks/${currentTrack.id}`, { state: { currentTrack } });
									}}
									title={currentTrack.title}
									className="w-fit truncate text-xs font-semibold text-white cursor-pointer hover:underline underline-offset-2 transition-all duration-200"
								>
									{currentTrack.title}
								</span>
								{/* {onTrackOptions && (
									<button
										type="button"
										onClick={onTrackOptions}
										aria-label="Track options"
										className="shrink-0 text-zinc-400 hover:text-white"
									>
										<IconDots size={13} stroke={2} />
									</button>
								)} */}
							</div>
							<span
								onClick={(event) => {
									event.stopPropagation();
									navigateToArtist();
								}}
								title={currentTrack.artist}
								className="w-fit truncate text-[11px] font-light text-zinc-400 cursor-pointer hover:text-white hover:underline underline-offset-2 transition-all duration-200">
								{currentTrack.artist}
							</span>
						</div>
					</>
				) : (
					<div className="flex items-center gap-2.5 text-zinc-500">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs border border-[#22222a] bg-[#141419]">
							<IconMusic size={16} stroke={1.5} />
						</div>
						<div className="flex flex-col min-w-0">
							<span className="text-xs font-medium text-zinc-400 truncate">
								No track playing
							</span>
							<span className="text-[10px] text-zinc-600 truncate">
								Select a song to play
							</span>
						</div>
					</div>
				)}
			</div>

			{/* Center playback controls & scrubber */}
			<div className="flex flex-1 max-w-xl flex-col items-center justify-center">
				{/* Main playback control icons */}
				<div className="flex items-center gap-4">
					{/* Shuffle */}
					<button
						type="button"
						onClick={toggleShuffle}
						aria-label="Toggle shuffle"
						className={`transition hover:scale-110 ${isShuffle ? "text-blue-500" : "text-zinc-400 hover:text-white"} cursor-pointer`}
					>
						<IconArrowsShuffle size={14} stroke={2} />
					</button>

					{/* Previous */}
					<button
						type="button"
						onClick={prevTrack}
						aria-label="Previous track"
						className="text-zinc-300 hover:text-white transition hover:scale-110 cursor-pointer"
					>
						<IconPlayerSkipBackFilled size={13} />
					</button>

					{/* Play / Pause circular button */}
					<button
						type="button"
						onClick={togglePlay}
						aria-label={isPlaying ? "Pause" : "Play"}
						className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-zinc-950 shadow-md transition hover:scale-105 active:scale-95 cursor-pointer"
					>
						{isPlaying ? (
							<IconPlayerPauseFilled size={13} />
						) : (
							<IconPlayerPlayFilled size={13} />
						)}
					</button>

					{/* Next */}
					<button
						type="button"
						onClick={nextTrack}
						aria-label="Next track"
						className="text-zinc-300 hover:text-white transition hover:scale-110 cursor-pointer"
					>
						<IconPlayerSkipForwardFilled size={13} />
					</button>

					{/* Repeat: off → repeat all → repeat one */}
					<button
						type="button"
						onClick={toggleRepeat}
						aria-label={repeatMode === "one" ? "Repeat: one track" : repeatMode === "all" ? "Repeat: all" : "Repeat: off"}
						title={repeatMode === "one" ? "Repeating one track" : repeatMode === "all" ? "Repeating queue" : "Repeat off"}
						className={`transition hover:scale-110 ${repeatMode !== "off" ? "text-blue-500" : "text-zinc-400 hover:text-white"} cursor-pointer`}
					>
						{repeatMode === "one"
							? <IconRepeatOnce size={14} stroke={2} />
							: <IconRepeat size={14} stroke={2} />}
					</button>
				</div>

				{/* Progress Scrubber */}
				<PlayerProgressBar seek={seek} fallbackDuration={currentTrack?.duration} />
			</div>

			{/* Right auxiliary tools & volume */}
			<div className="flex w-1/4 min-w-50 items-center justify-end gap-3 text-zinc-400">
				{/* Playlist / Queue - toggles the collapsible right panel */}
				<button
					type="button"
					onClick={toggleQueuePanel}
					aria-label="View queue"
					aria-expanded={isQueuePanelOpen}
					className={`text-zinc-400 transition hover:text-white ${isQueuePanelOpen ? "text-white" : ""} cursor-pointer`}
				>
					{isQueuePanelOpen ? (
						<IconLayoutListFilled size={14} stroke={1.8} />
					) : (
						<IconLayoutList size={14} stroke={1.8} />
					)}
				</button>

				{/* Favorite */}
				<button
					type="button"
					onClick={toggleFavorite}
					title={isFavorite ? "Remove from favorites" : "Add to favorites"}
					aria-label="Favorite"
					className={`transition ${isFavorite ? "text-red-500 hover:text-red-400" : "hover:text-white"} cursor-pointer`}
				>
					<IconHeart
						size={14}
						stroke={1.8}
						className={isFavorite ? "fill-red-500" : ""}
					/>
				</button>

				{/* Volume control */}
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={toggleMute}
						aria-label="Mute toggle"
						className="hover:text-white transition cursor-pointer"
					>
						{isMuted || volume === 0 ? (
							<IconVolumeOff size={14} stroke={1.8} />
						) : volume < 50 ? (
							<IconVolume2 size={14} stroke={1.8} />
						) : (
							<IconVolume size={14} stroke={1.8} />
						)}
					</button>
					<input
						type="range"
						min="0"
						max="100"
						step="1"
						value={volume}
						onChange={(e) => setVolume(Number(e.target.value))}
						aria-label="Volume"
						aria-valuetext={`${volume}%`}
						className="volume-slider h-4 w-20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
						style={{
							"--volume": `${volume}%`,
						}}
					/>
				</div>
			</div>
		</footer>
	);
}

export default BottomPlayerBar;