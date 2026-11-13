import { useEffect } from "react";
import {
	IconChevronDown,
	IconChevronUp,
	IconMusic,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { usePlayer } from "../context/PlayerContext";
import Artwork from "../components/Artwork";

// Collapsible right-side panel with a now-playing preview and the queue.
// The wrapper animates its width so the panel slides open/closed without
// shifting the window controls, and it is fully closable from its own X and
// Escape, or via the queue toggle in the bottom player bar.
function QueuePanel({ isOpen, onClose }) {
	const {
		currentTrack,
		queue,
		queueIndex,
		removeQueuedTrack,
		moveQueuedTrack,
		clearQueue,
		playQueueItem,
	} = usePlayer();

	const upcomingStartIndex = Math.max(queueIndex + 1, 0);
	const upcomingTracks = queue.slice(upcomingStartIndex);

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
			className={`h-full shrink-0 overflow-hidden border-l transition-all duration-300 ease-out ${
				isOpen
					? "w-72 border-[#1b1b22] opacity-100"
					: "w-0 border-transparent opacity-0"
			} ${isOpen ? "" : "pointer-events-none"}`}
		>
			<div className="flex h-full w-72 flex-col bg-[#0d0d10] text-zinc-200">
				{/* Panel header */}
				<header className="flex shrink-0 items-center justify-between border-b border-[#1b1b22] px-4 py-3">
					<div>
						<h2 className="text-sm font-semibold text-white">Queue</h2>
						<p className="text-[11px] text-zinc-500">
							{upcomingTracks.length} upcoming{" "}
							{upcomingTracks.length === 1 ? "track" : "tracks"}
						</p>
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={clearQueue}
							disabled={upcomingTracks.length === 0}
							title="Clear upcoming tracks"
							aria-label="Clear upcoming tracks"
							className="flex items-center gap-1 rounded-xs px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
						>
							<IconTrash size={13} />
							Clear
						</button>
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

				<div className="flex-1 overflow-y-auto">
					{/* Now playing preview */}
					<div className="px-4 py-4">
						<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
							Now Playing
						</p>
						{currentTrack ? (
							<div className="rounded-xs border border-[#22222a] bg-[#141419]">
								<div className="relative overflow-hidden rounded-t-xs bg-[#101014]">
									<Artwork
										src={currentTrack.cover}
										alt={currentTrack.title}
										className="aspect-square w-full object-cover"
									/>
								</div>
								<div className="p-3">
									<p className="w-fit truncate text-sm font-semibold text-white cursor-pointer hover:underline underline-offset-2 transition-all duration-200">
										{currentTrack.title}
									</p>
									<p className="w-fit truncate text-xs font-light text-zinc-400 hover:text-white cursor-pointer hover:underline underline-offset-2 transition-all duration-200">
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

					{/* Upcoming tracks */}
					<div className="px-2 pb-2">
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
											className="group flex items-center gap-2 rounded-xs px-2 py-2 hover:bg-white/5"
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
		</section>
	);
}

export default QueuePanel;
