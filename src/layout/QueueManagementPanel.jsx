import { useEffect } from "react";
import {
	IconChevronDown,
	IconChevronUp,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { usePlayer } from "../context/PlayerContext";
import Artwork from "../components/Artwork";
import { getThumbnailUrl } from "../services/jellyfin";

function QueueManagementPanel({ isOpen, onClose }) {
	const {
		queue,
		queueIndex,
		removeQueuedTrack,
		moveQueuedTrack,
		clearQueue,
		playQueueItem,
	} = usePlayer();

	const visibleStartIndex = Math.max(queueIndex, 0);
	const upcomingStartIndex = Math.max(queueIndex + 1, 0);
	const upcomingTracks = queue.slice(upcomingStartIndex);
	const visibleTracks = queue.slice(visibleStartIndex);

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
					<header className="flex shrink-0 items-center justify-between px-4 py-3">
						<h2 className="font-display text-base font-semibold text-white">Queue</h2>
						<div className="flex items-center gap-2">
							<p className="text-[10px] font-semibold text-zinc-300">
								{Math.max(queueIndex + 1, 0)}/{queue.length}
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

					<div className="flex-1 overflow-y-auto overscroll-none px-4 pb-4">
						<div className="flex items-center justify-between">
							<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
								Tracks
							</p>
							<button
								type="button"
								onClick={clearQueue}
								disabled={upcomingTracks.length === 0}
								title="Clear upcoming tracks"
								aria-label="Clear upcoming tracks"
								className="flex items-center gap-1 uppercase rounded-xs px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
							>
								<IconTrash size={10} stroke={1.5} />
								Clear
							</button>
						</div>

						{visibleTracks.length === 0 ? (
							<p className="px-2 py-4 text-center text-xs text-zinc-400">
								No tracks in the queue
							</p>
						) : (
							<ul className="mt-2 space-y-1">
								{visibleTracks.map((track, offset) => {
									const index = visibleStartIndex + offset;
									const isCurrentTrack = index === queueIndex;
									const canManage = index > queueIndex;
									return (
										<li
											key={`${track.id}-${index}`}
											className={`queue-row group flex items-center gap-2 rounded-xs px-2 py-2 ${isCurrentTrack ? "bg-white/5" : "hover:bg-white/5"}`}
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
													<span className="block truncate text-[11px] text-zinc-400">
														{isCurrentTrack ? "Now Playing" : track.artist}
													</span>
												</span>
											</button>
											{canManage && (
												<div className="flex shrink-0 items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
													<button
														type="button"
														onClick={() => moveQueuedTrack(index, index - 1)}
														disabled={index === upcomingStartIndex}
														aria-label={`Move ${track.title} up`}
														className="rounded-xs p-1 text-zinc-400 hover:text-white disabled:opacity-30"
													>
														<IconChevronUp size={14} />
													</button>
													<button
														type="button"
														onClick={() => moveQueuedTrack(index, index + 1)}
														disabled={index === queue.length - 1}
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
											)}
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>
			)}
		</section>
	);
}

export default QueueManagementPanel;
