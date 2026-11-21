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
	IconDotsVertical,
	IconMusic,
	IconArrowsExchange,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlayer, subscribePlayerProgress, getPlayerProgress } from "../context/PlayerContext";
import { useJellyfin } from "../context/JellyfinContext";
import { fetchMusicArtists, getThumbnailUrl, getTrackAlbumLink } from "../services/jellyfin";
import useFavoriteToggle from "../hooks/useFavoriteToggle";
import Artwork from "../components/Artwork";
import { useNavigate } from "react-router-dom";

function formatSeconds(sec) {
	if (!sec || isNaN(sec) || !isFinite(sec)) return "0:00";
	const minutes = Math.floor(sec / 60);
	const seconds = Math.floor(sec % 60);
	return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

// Progress ticks ~4x/second ("timeupdate"). Instead of re-rendering on every
// tick, this subscribes to the progress store imperatively and writes the
// slider position, its filled track and the two time labels straight to the
// DOM. The labels only change when the whole second (or the duration) does,
// so most ticks are a single style write. The component itself now renders
// only when the player bar does (track change, play/pause, volume, ...).
function PlayerProgressBar({ seek, fallbackDuration }) {
	const inputRef = useRef(null);
	const currentTimeRef = useRef(null);
	const durationRef = useRef(null);
	const lastSecondRef = useRef(null);
	const lastDurationRef = useRef(null);
	// Latest props for the subscription and the input handler, without
	// re-subscribing or re-rendering on every parent update.
	const seekRef = useRef(seek);
	const fallbackDurationRef = useRef(fallbackDuration);
	seekRef.current = seek;
	fallbackDurationRef.current = fallbackDuration;

	useLayoutEffect(() => {
		const paint = () => {
			const { currentTime, duration } = getPlayerProgress();
			const total = duration > 0 ? duration : (fallbackDurationRef.current || 180);
			const percent = Math.min(100, Math.max(0, (currentTime / total) * 100));

			const input = inputRef.current;
			if (input) {
				input.value = String(percent);
				input.style.background = `linear-gradient(to right, #ffffff ${percent}%, #272731 ${percent}%)`;
			}

			const second = Math.floor(currentTime);
			if (currentTimeRef.current && second !== lastSecondRef.current) {
				lastSecondRef.current = second;
				currentTimeRef.current.textContent = formatSeconds(currentTime);
			}
			if (durationRef.current && total !== lastDurationRef.current) {
				lastDurationRef.current = total;
				durationRef.current.textContent = formatSeconds(total);
			}
		};

		// Paint before the first frame so the labels never flash empty.
		paint();
		return subscribePlayerProgress(paint);
	}, []);

	const handleSeek = (e) => {
		const { duration } = getPlayerProgress();
		const total = duration > 0 ? duration : (fallbackDurationRef.current || 180);
		seekRef.current((parseFloat(e.target.value) / 100) * total);
	};

	return (
		<div className="mt-1 flex w-full items-center gap-2">
			<span ref={currentTimeRef} className="w-7 text-right text-[10px] text-zinc-400" />

			<div className="group relative flex flex-1 items-center">
				<input
					ref={inputRef}
					type="range"
					min="0"
					max="100"
					step="0.1"
					defaultValue={0}
					onChange={handleSeek}
					className="h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-white transition-all group-hover:h-1.5 focus:outline-none"
				/>
			</div>

			<span ref={durationRef} className="w-7 text-left text-[10px] text-zinc-400" />
		</div>
	);
}

// Crossfade length control: a compact trigger in the player bar opens a
// portal-rendered panel above it (so it never gets clipped by the footer),
// closing on Escape, scroll, resize or a click-away.
const MAX_CROSSFADE_SECONDS = 12;
const CROSSFADE_PANEL_WIDTH = 224;

function formatCrossfade(seconds) {
	if (!seconds) return "Off";
	return `${seconds}s`;
}

function CrossfadeControl() {
	const { crossfadeDuration, setCrossfadeDuration } = usePlayer();
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState(null);
	const triggerRef = useRef(null);

	const close = () => {
		setIsOpen(false);
		setPosition(null);
	};

	const open = () => {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			// Anchored to the trigger and above it; the bar sits at the bottom,
			// so there is always room in that direction.
			bottom: window.innerHeight - rect.top + 8,
			right: Math.max(
				8,
				Math.min(window.innerWidth - rect.right, window.innerWidth - CROSSFADE_PANEL_WIDTH - 8),
			),
		});
		setIsOpen(true);
	};

	useEffect(() => {
		if (!isOpen) return undefined;
		const onKeyDown = (event) => {
			if (event.key === "Escape") close();
		};
		const onScroll = () => close();
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [isOpen]);

	const percent = (crossfadeDuration / MAX_CROSSFADE_SECONDS) * 100;
	const isEnabled = crossfadeDuration > 0;

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => (isOpen ? close() : open())}
				aria-label="Crossfade duration"
				aria-expanded={isOpen}
				title={isEnabled ? `Crossfade: ${formatCrossfade(crossfadeDuration)}` : "Crossfade off"}
				className={`transition hover:scale-110 cursor-pointer ${isEnabled ? "text-blue-500" : "text-zinc-400 hover:text-white"}`}
			>
				<IconArrowsExchange size={14} stroke={1.8} />
			</button>

			{isOpen && position && createPortal(
				<>
					<div className="fixed inset-0 z-50" onClick={close} />
					<div
						style={position}
						className="fixed z-60 w-56 rounded-xs border border-[#2b2b36] bg-[#18181f] p-3 shadow-xl"
						role="dialog"
						aria-label="Crossfade duration"
					>
						<div className="mb-2 flex items-center justify-between">
							<span className="font-display text-[10px] font-medium tracking-[0.14em] text-zinc-400">
								Crossfade
							</span>
							<span className="text-[11px] font-semibold text-white">
								{formatCrossfade(crossfadeDuration)}
							</span>
						</div>
						<input
							type="range"
							min="0"
							max={MAX_CROSSFADE_SECONDS}
							step="1"
							value={crossfadeDuration}
							onChange={(event) => setCrossfadeDuration(Number(event.target.value))}
							aria-label="Crossfade duration in seconds"
							aria-valuetext={formatCrossfade(crossfadeDuration)}
							className="volume-slider h-4 w-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
							style={{ "--volume": `${percent}%` }}
						/>
						<div className="mt-1.5 flex items-center justify-between text-[9px] uppercase tracking-wide text-zinc-600">
							<span>Off</span>
							<span>{MAX_CROSSFADE_SECONDS}s</span>
						</div>
					</div>
				</>,
				document.body,
			)}
		</>
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
	// Album page for the current track, resolved the same way as the track
	// options menu (real Jellyfin album, or a virtual album keyed on its tags).
	const albumLink = currentTrack ? getTrackAlbumLink(currentTrack) : null;

	return (
		<footer className="relative z-40 flex h-20 w-full shrink-0 items-center justify-between border-t border-[#1b1b22] bg-[#0c0c0e] px-4 text-zinc-300">
			{/* Left section: Current playing track album art & details */}
			<div className="flex w-1/4 min-w-48 items-center gap-3">
				{currentTrack ? (
					<>
						{/* Artwork doubles as a link to the playing track's album. */}
						<button
							type="button"
							onClick={() => {
								if (!albumLink) return;
								navigate(`/albums/${albumLink.id}`, {
									state: { title: currentTrack.album || albumLink.title },
								});
							}}
							disabled={!albumLink}
							title="Go to album"
							aria-label={albumLink ? `Go to album ${currentTrack.album || albumLink.title}` : undefined}
							className="group h-12 w-12 aspect-square cursor-pointer rounded-md border border-[#22222a] bg-[#18181f] disabled:cursor-default"
						>
							<Artwork
								src={currentTrack.cover ? getThumbnailUrl(currentTrack.cover, 96) : currentTrack.cover}
								alt={currentTrack.title}
								loading="eager"
								className="h-full w-full object-cover object-center rounded-md"
							/>
						</button>

						<div className="flex min-w-0 flex-col justify-center">
							<div className="flex items-center gap-2">
								<span
									onClick={(event) => {
										event.stopPropagation();
										navigate(`/tracks/${currentTrack.id}`, { state: { currentTrack } });
									}}
									title={currentTrack.title}
									className="block truncate text-xs font-semibold text-white cursor-pointer hover:underline underline-offset-2 transition-all duration-200"
								>
									{currentTrack.title}
								</span>
								{/* {onTrackOptions && (
									<button
										type="button"
										onClick={onTrackOptions}
										aria-label="Track options"
										className="text-zinc-400 hover:text-white"
									>
										<IconDotsVertical size={12} stroke={2} />
									</button>
								)} */}
							</div>
							<span
								onClick={(event) => {
									event.stopPropagation();
									navigateToArtist();
								}}
								title={currentTrack.artist}
								className="block truncate text-[11px] font-light text-zinc-400 cursor-pointer hover:text-white hover:underline underline-offset-2 transition-all duration-200">
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
				{/* Crossfade duration */}
				<CrossfadeControl />

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