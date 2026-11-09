import { useEffect, useRef, useState } from "react";
import {
	IconArrowsShuffle,
	IconPlayerSkipBackFilled,
	IconPlayerSkipForwardFilled,
	IconPlayerPlayFilled,
	IconPlayerPauseFilled,
	IconRepeat,
	IconPlaylist,
	IconChevronUp,
	IconChevronDown,
	IconTrash,
	IconX,
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
import { usePlayer } from "../context/PlayerContext";
import Artwork from "../components/Artwork";

function formatSeconds(sec) {
	if (!sec || isNaN(sec) || !isFinite(sec)) return "0:00";
	const minutes = Math.floor(sec / 60);
	const seconds = Math.floor(sec % 60);
	return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

function BottomPlayerBar({ onTrackOptions }) {
	const {
		currentTrack,
		isPlaying,
		currentTime,
		duration,
		volume,
		isMuted,
		setVolume,
		toggleMute,
		isShuffle,
		toggleShuffle,
		isRepeat,
		toggleRepeat,
		togglePlay,
		nextTrack,
		prevTrack,
		seek,
		queue,
		queueIndex,
		removeQueuedTrack,
		moveQueuedTrack,
		clearQueue,
		playQueueItem,
	} = usePlayer();

	const [isFavorite, setIsFavorite] = useState(false);
	const [isQueueOpen, setIsQueueOpen] = useState(false);
	const queueMenuRef = useRef(null);
	const queueToggleRef = useRef(null);

	const validDuration = duration && duration > 0 ? duration : 180;
	const progressPercent = Math.min(100, Math.max(0, (currentTime / validDuration) * 100));

	const handleSeek = (e) => {
		const newPercent = parseFloat(e.target.value);
		seek((newPercent / 100) * validDuration);
	};
	const upcomingStartIndex = Math.max(queueIndex + 1, 0);
	const upcomingTracks = queue.slice(upcomingStartIndex);

	useEffect(() => {
		if (!isQueueOpen) return undefined;

		const handlePointerDown = (event) => {
			if (
				!queueMenuRef.current?.contains(event.target)
				&& !queueToggleRef.current?.contains(event.target)
			) {
				setIsQueueOpen(false);
			}
		};
		const handleKeyDown = (event) => {
			if (event.key === "Escape") setIsQueueOpen(false);
		};

		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isQueueOpen]);

	return (
		<footer className="relative z-40 flex h-20 w-full shrink-0 items-center justify-between border-t border-[#1b1b22] bg-[#0c0c0e] px-4 text-zinc-300">
			{isQueueOpen && (
				<section
					ref={queueMenuRef}
					aria-label="Playback queue"
					className="absolute bottom-full right-4 z-60 mb-2 flex max-h-[min(70vh,32rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden border border-zinc-700 bg-[#111115] text-zinc-200 shadow-2xl"
				>
					<header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
						<div>
							<h2 className="text-sm font-semibold text-white">Queue</h2>
							<p className="text-[11px] text-zinc-500">
								{upcomingTracks.length} upcoming {upcomingTracks.length === 1 ? "track" : "tracks"}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={clearQueue}
								disabled={upcomingTracks.length === 0}
								title="Clear upcoming tracks"
								aria-label="Clear upcoming tracks"
								className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
							>
								<IconTrash size={13} />
								Clear
							</button>
							<button
								type="button"
								onClick={() => setIsQueueOpen(false)}
								aria-label="Close queue"
								className="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
							>
								<IconX size={15} />
							</button>
						</div>
					</header>

					<div className="overflow-y-auto p-2">
						{currentTrack && (
							<div className="mb-2">
								<p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
									Now Playing
								</p>
								<div className="flex items-center gap-3 rounded bg-white/5 px-2 py-2">
									<Artwork
										src={currentTrack.cover}
										alt=""
										className="h-9 w-9 rounded object-cover"
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-xs font-medium text-white">{currentTrack.title}</p>
										<p className="truncate text-[11px] text-zinc-400">{currentTrack.artist}</p>
									</div>
									<span className="shrink-0 text-[10px] text-blue-400">
										{isPlaying ? "Playing" : "Paused"}
									</span>
								</div>
							</div>
						)}

						<div>
							<p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
								Up Next
							</p>
							{upcomingTracks.length === 0 ? (
								<p className="px-2 py-4 text-center text-xs text-zinc-500">
									No tracks in the queue
								</p>
							) : (
								<ul className="space-y-1">
									{upcomingTracks.map((track, offset) => {
										const index = upcomingStartIndex + offset;
										return (
											<li
												key={`${track.id}-${index}`}
												className="group flex items-center gap-2 rounded px-2 py-2 hover:bg-white/5"
											>
												<button
													type="button"
													onClick={() => playQueueItem(index)}
													aria-label={`Play ${track.title}`}
													className="flex min-w-0 flex-1 items-center gap-3 text-left"
												>
													<Artwork
														src={track.cover}
														alt=""
														className="h-9 w-9 shrink-0 rounded object-cover"
													/>
													<span className="min-w-0 flex-1">
														<span className="block truncate text-xs font-medium text-zinc-200">
															{track.title}
														</span>
														<span className="block truncate text-[11px] text-zinc-500">
															{track.artist}
														</span>
													</span>
												</button>
												<div className="flex shrink-0 items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
													<button
														type="button"
														onClick={() => moveQueuedTrack(index, index - 1)}
														disabled={offset === 0}
														aria-label={`Move ${track.title} up`}
														className="rounded p-1 text-zinc-400 hover:text-white disabled:opacity-30"
													>
														<IconChevronUp size={14} />
													</button>
													<button
														type="button"
														onClick={() => moveQueuedTrack(index, index + 1)}
														disabled={offset === upcomingTracks.length - 1}
														aria-label={`Move ${track.title} down`}
														className="rounded p-1 text-zinc-400 hover:text-white disabled:opacity-30"
													>
														<IconChevronDown size={14} />
													</button>
													<button
														type="button"
														onClick={() => removeQueuedTrack(index)}
														aria-label={`Remove ${track.title} from queue`}
														className="rounded p-1 text-zinc-500 hover:text-red-400"
													>
														<IconX size={14} />
													</button>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>
				</section>
			)}
			{/* Left section: Current playing track album art & details */}
			<div className="flex w-1/4 min-w-48 items-center gap-3">
				{currentTrack ? (
					<>
						<div className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-[#18181f] shadow-md border border-[#22222a]">
							<Artwork
								src={currentTrack.cover}
								alt={currentTrack.title}
								loading="eager"
								className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
							/>
						</div>

						<div className="flex min-w-0 flex-1 flex-col justify-center">
							<div className="flex items-center gap-1.5">
								<span className="truncate text-xs font-semibold text-zinc-100 hover:text-white cursor-pointer">
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
							<span className="truncate text-[11px] text-zinc-400 hover:text-zinc-300 cursor-pointer">
								{currentTrack.artist}
							</span>
							{currentTrack.album && (
								<span className="truncate text-[10px] text-zinc-500">
									{currentTrack.album}
								</span>
							)}
						</div>
					</>
				) : (
					<div className="flex items-center gap-2.5 text-zinc-500">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#22222a] bg-[#141419]">
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
						className={`transition hover:scale-110 ${isShuffle ? "text-blue-500" : "text-zinc-400 hover:text-white"
							}`}
					>
						<IconArrowsShuffle size={14} stroke={2} />
					</button>

					{/* Previous */}
					<button
						type="button"
						onClick={prevTrack}
						aria-label="Previous track"
						className="text-zinc-300 hover:text-white transition hover:scale-110"
					>
						<IconPlayerSkipBackFilled size={13} />
					</button>

					{/* Play / Pause circular button */}
					<button
						type="button"
						onClick={togglePlay}
						aria-label={isPlaying ? "Pause" : "Play"}
						className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-zinc-950 shadow-md transition hover:scale-105 active:scale-95"
					>
						{isPlaying ? (
							<IconPlayerPauseFilled size={13} />
						) : (
							<IconPlayerPlayFilled size={13} className="ml-0.5" />
						)}
					</button>

					{/* Next */}
					<button
						type="button"
						onClick={nextTrack}
						aria-label="Next track"
						className="text-zinc-300 hover:text-white transition hover:scale-110"
					>
						<IconPlayerSkipForwardFilled size={13} />
					</button>

					{/* Repeat */}
					<button
						type="button"
						onClick={toggleRepeat}
						aria-label="Toggle repeat"
						className={`transition hover:scale-110 ${isRepeat ? "text-blue-500" : "text-zinc-400 hover:text-white"
							}`}
					>
						<IconRepeat size={14} stroke={2} />
					</button>

					{/* Playlist / Queue */}
					<button
						type="button"
						ref={queueToggleRef}
						onClick={() => setIsQueueOpen((open) => !open)}
						aria-label="View queue"
						aria-expanded={isQueueOpen}
						className={`relative text-zinc-400 transition hover:scale-110 hover:text-white ${isQueueOpen ? "text-white" : ""}`}
					>
						<IconPlaylist size={14} stroke={2} />
						{upcomingTracks.length > 0 && (
							<span className="absolute -right-1.5 -top-1.5 min-w-3 rounded-full bg-blue-500 px-0.5 text-center text-[8px] leading-3 text-white">
								{upcomingTracks.length}
							</span>
						)}
					</button>
				</div>

				{/* Progress Scrubber */}
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
			</div>

			{/* Right auxiliary tools & volume */}
			<div className="flex w-1/4 min-w-50 items-center justify-end gap-3 text-zinc-400">
				{/* Favorite */}
				<button
					type="button"
					onClick={() => setIsFavorite(!isFavorite)}
					aria-label="Favorite"
					className={`transition hover:text-white ${isFavorite ? "text-red-500 hover:text-red-400" : ""
						}`}
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
						className="hover:text-white transition"
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