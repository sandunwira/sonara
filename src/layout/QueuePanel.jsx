import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	IconChevronDown,
	IconChevronUp,
	IconMusic,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { usePlayer, subscribePlayerProgress, getPlayerProgress } from "../context/PlayerContext";
import Artwork from "../components/Artwork";
import { fetchLyrics } from "../services/lyrics";
import { getThumbnailUrl, getTrackArtistLink, getTrackAlbumLink } from "../services/jellyfin";

// Index of the lyric line being sung at `currentTime` (a small offset
// compensates for latency).
function findActiveLyricIndex(synced, currentTime) {
	if (!synced) return -1;
	let index = -1;
	for (let i = 0; i < synced.length; i += 1) {
		if (synced[i].time <= currentTime + 0.3) index = i;
		else break;
	}
	return index;
}

// Lyrics for the current track (LRCLIB, persisted in the local database).
// Collapsible like the sidebar sections and collapsed by default: while it
// stays closed nothing is fetched, no playback-position subscription is
// active and nothing renders. Playback position is read imperatively instead
// of through usePlayerProgress, so even when expanded the highlight only
// re-renders when a new line starts (no work on ordinary 4x/second ticks).
function Lyrics({ track, onSeek }) {
	const [isOpen, setIsOpen] = useState(false);
	// { trackId, lines }: tagged with its track so lyrics resolved for a
	// previous track are never shown while the next one is still loading.
	// lines === undefined → not resolved yet, null → no lyrics available.
	const [lyrics, setLyrics] = useState(null);
	const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
	const lyricsScrollRef = useRef(null);
	const lyricLineRefs = useRef([]);
	// Manual scrolling pauses the follow-the-line auto scroll briefly.
	const userScrollUntilRef = useRef(0);
	// Latest lines/position for the subscription without re-subscribing.
	const lyricsRef = useRef(null);
	const currentTimeRef = useRef(0);

	const lines = lyrics && lyrics.trackId === track?.id ? lyrics.lines : undefined;
	lyricsRef.current = lines;

	// Only fetch while expanded. Results are cached in memory and in the
	// local database, so reopening the section does not hit the network.
	useEffect(() => {
		if (!isOpen) return undefined;
		const trackId = track?.id ?? null;
		if (!track?.title || !track?.artist) {
			setLyrics({ trackId, lines: null });
			return undefined;
		}
		let cancelled = false;
		lyricLineRefs.current = [];
		userScrollUntilRef.current = 0;
		fetchLyrics(track.artist, track.title).then((result) => {
			if (cancelled) return;
			setLyrics({ trackId, lines: result });
		});
		return () => {
			cancelled = true;
		};
	}, [isOpen, track?.id, track?.title, track?.artist]);

	// Follow the playback position while expanded: progress ticks ~4x/second
	// but the highlight changes only when a line starts, and setState bails
	// out for every other tick, so ordinary ticks cause no render.
	useEffect(() => {
		if (!isOpen) return undefined;
		const followPosition = () => {
			const { currentTime } = getPlayerProgress();
			currentTimeRef.current = currentTime;
			const nextIndex = findActiveLyricIndex(lyricsRef.current?.synced, currentTime);
			setActiveLyricIndex((previous) => (previous === nextIndex ? previous : nextIndex));
		};
		followPosition();
		return subscribePlayerProgress(followPosition);
	}, [isOpen]);

	// Lyrics arrive asynchronously mid-track, so resolve the highlight for the
	// current position as soon as they are available.
	useEffect(() => {
		setActiveLyricIndex(findActiveLyricIndex(lines?.synced, currentTimeRef.current));
	}, [lines]);

	// Keep the active line centred in the lyrics box.
	useEffect(() => {
		if (activeLyricIndex < 0) return;
		if (Date.now() < userScrollUntilRef.current) return;
		const container = lyricsScrollRef.current;
		const line = lyricLineRefs.current[activeLyricIndex];
		if (!container || !line) return;
		const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
		container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
	}, [activeLyricIndex]);

	const lyricLineClass = (index) => {
		if (index === activeLyricIndex) return "text-sm font-semibold text-white";
		if (index < activeLyricIndex) return "text-xs text-zinc-600 hover:text-zinc-400";
		return "text-xs text-zinc-500 hover:text-zinc-300";
	};

	// Nothing to attach lyrics to.
	if (!track) return null;

	return (
		<div>
			{/* Collapsible header, same pattern as the sidebar sections. */}
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				aria-expanded={isOpen}
				className="flex w-full items-center justify-between py-1.5 cursor-pointer"
			>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
					Lyrics
				</p>
				<IconChevronDown
					size={13}
					className={`transition-transform duration-200 ${isOpen ? "-rotate-180" : "rotate-0"}`}
				/>
			</button>

			{isOpen && (
				<div className="mt-1 space-y-2">
					{lines?.synced && (
						<div
							ref={lyricsScrollRef}
							onWheel={() => {
								userScrollUntilRef.current = Date.now() + 4000;
							}}
							className="relative max-h-36 overflow-y-auto overscroll-none pr-1 p-3 leading-loose rounded-xs bg-[#101014] border border-zinc-900"
						>
							{lines.synced.map((line, index) => (
								line.text ? (
									<button
										key={index}
										type="button"
										ref={(el) => {
											lyricLineRefs.current[index] = el;
										}}
										onClick={() => onSeek(line.time)}
										className={`block w-full text-left leading-loose transition-colors duration-200 ${lyricLineClass(index)}`}
									>
										{line.text}
									</button>
								) : (
									<div
										key={index}
										ref={(el) => {
											lyricLineRefs.current[index] = el;
										}}
										className="h-3"
									/>
								)
							))}
						</div>
					)}
					{lines?.plain && (
						<p className="rounded-xs border border-[#22222a] bg-[#141419] px-3 py-2 whitespace-pre-line text-xs leading-relaxed text-zinc-400">
							{lines.plain}
						</p>
					)}
					{!lines && (
						<p className="text-[10px] text-zinc-600">
							{lines === undefined ? "Finding lyrics…" : "No lyrics available for this track."}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

// Collapsible right-side panel with a now-playing preview, lyrics for the
// current track (when LRCLIB has any) and the queue. The wrapper animates its
// width so the panel slides open/closed without shifting the window controls,
// and it is fully closable from its own X and Escape, or via the queue toggle
// in the bottom player bar. The body only mounts while open: a restored
// 300+ track queue would otherwise build a hidden list at startup.
function QueuePanel({ isOpen, onClose }) {
	const navigate = useNavigate();
	const {
		currentTrack,
		seek,
		queue,
		queueIndex,
		removeQueuedTrack,
		moveQueuedTrack,
		clearQueue,
		playQueueItem,
	} = usePlayer();

	const upcomingStartIndex = Math.max(queueIndex + 1, 0);
	const upcomingTracks = queue.slice(upcomingStartIndex);
	// Album page for the current track, resolved exactly like the track
	// options menu and the bottom player bar's artwork link.
	const albumLink = currentTrack ? getTrackAlbumLink(currentTrack) : null;

	useEffect(() => {
		if (!isOpen) return undefined;
		const handleKeyDown = (event) => {
			if (event.key === "Escape") onClose?.();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	return (
		<section
			aria-label="Playback queue"
			aria-hidden={!isOpen}
			className={`h-full shrink-0 overflow-hidden border-l bg-[#0d0d10] transition-all duration-300 ease-out ${isOpen
				? "w-72 border-[#1b1b22] opacity-100"
				: "w-0 border-transparent opacity-0"
				} ${isOpen ? "" : "pointer-events-none"}`}
		>
			{isOpen && (
				<div className="flex h-full w-72 flex-col bg-[#0d0d10] text-zinc-200">
					{/* Panel header */}
					<header className="flex shrink-0 items-center justify-between px-4 py-3">
						<h2 className="font-display text-base font-semibold text-white">Queue</h2>
						<div className="flex items-center gap-2">
							<p className="text-[10px] font-semibold text-zinc-400">
								{queueIndex + 1}/{queue.length}
							</p>
							<button
								type="button"
								onClick={onClose}
								aria-label="Close queue panel"
								className="rounded-xs p-1 text-zinc-400 transition hover:bg-white/5 hover:text-white"
							>
								<IconX size={15} />
							</button>
						</div>
					</header>

					<div className="flex-1 overflow-y-auto overscroll-none space-y-8 px-4 pb-4">
						{/* Now playing preview */}
						<div className="space-y-2">
							<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
								Now Playing
							</p>
							{currentTrack ? (
								<div className="rounded-xs space-y-2">
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
										className="block w-full cursor-pointer rounded-sm bg-[#101014] border border-zinc-900 disabled:cursor-default"
									>
										<Artwork
											src={currentTrack.cover}
											alt={currentTrack.title}
											className="rounded-sm aspect-square w-full object-cover"
										/>
									</button>
									<div>
										<p
											onClick={() => currentTrack?.id && navigate(`/tracks/${currentTrack.id}`, { state: { track: currentTrack } })}
											title="View track details"
											className="block truncate text-sm font-semibold text-white cursor-pointer hover:underline underline-offset-2 transition-all duration-200"
										>
											{currentTrack.title}
										</p>
										<p
											onClick={() => {
												const artistLink = getTrackArtistLink(currentTrack);
												if (artistLink) navigate(`/artists/${artistLink.id}`, { state: { name: currentTrack.artist } });
											}}
											title="View artist"
											className="block truncate text-xs font-light text-zinc-400 hover:text-white cursor-pointer hover:underline underline-offset-2 transition-all duration-200"
										>
											{currentTrack.artist}
										</p>
									</div>
								</div>
							) : (
								<div className="flex flex-col items-center justify-center rounded-xs border border-dashed border-[#22222a] bg-[#141419] px-3 py-8 text-center">
									<IconMusic size={22} stroke={1.5} className="mb-2 text-zinc-600" />
									<span className="text-xs font-medium text-zinc-400">
										No track playing
									</span>
									<span className="mt-0.5 text-[10px] text-zinc-600">
										Select a song to play
									</span>
								</div>
							)}
						</div>

						{/* Lyrics, collapsible and collapsed by default (nothing is fetched or followed until it is expanded) */}
						<Lyrics track={currentTrack} onSeek={seek} />

						{/* Upcoming tracks */}
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
									Up Next
								</p>
								<button
									type="button"
									onClick={clearQueue}
									disabled={upcomingTracks.length === 0}
									title="Clear upcoming tracks"
									aria-label="Clear upcoming tracks"
									className="flex items-center gap-1 uppercase rounded-xs px-2 py-1 text-[10px] text-zinc-400 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
								>
									<IconTrash size={10} stroke={1.5} />
									Clear
								</button>
							</div>
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
												className="queue-row group flex items-center gap-2 rounded-xs px-2 py-2 hover:bg-white/5"
											>
												<button
													type="button"
													onClick={() => playQueueItem(index)}
													aria-label={`Play ${track.title}`}
													className="flex min-w-0 flex-1 items-center gap-3 text-left"
												>
													<Artwork
														src={track.cover ? getThumbnailUrl(track.cover, 96) : track.cover}
														alt=""
														className="h-9 w-9 shrink-0 rounded-xs object-cover"
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
														className="rounded-xs p-1 text-zinc-400 hover:text-white disabled:opacity-30"
													>
														<IconChevronUp size={14} />
													</button>
													<button
														type="button"
														onClick={() => moveQueuedTrack(index, index + 1)}
														disabled={offset === upcomingTracks.length - 1}
														aria-label={`Move ${track.title} down`}
														className="rounded-xs p-1 text-zinc-400 hover:text-white disabled:opacity-30"
													>
														<IconChevronDown size={14} />
													</button>
													<button
														type="button"
														onClick={() => removeQueuedTrack(index)}
														aria-label={`Remove ${track.title} from queue`}
														className="rounded-xs p-1 text-zinc-500 hover:text-red-400"
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
				</div>
			)}
		</section>
	);
}

export default QueuePanel;
