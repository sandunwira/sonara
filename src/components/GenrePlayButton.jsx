import {
	IconLoader2,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
} from "@tabler/icons-react";

// Circular play/pause overlay button for genre cards (Home grid + Genres
// page). Visible on card hover; stays visible (and un-faded) while the
// genre's tracks load, while a track from the genre is the current one, or
// while any of its tracks sit in the queue. Pause icon only shows while the
// current track from this genre is actually playing.
function GenrePlayButton({
	genre,
	isCurrentGenre = false,
	isQueuedGenre = false,
	isPending = false,
	isPlaying = false,
	onPlay,
	onTogglePlay,
}) {
	const genreName = genre?.name || "genre";
	const showAlways = isPending || isQueuedGenre;
	const showPauseIcon = isCurrentGenre && isPlaying;

	const handleClick = (event) => {
		event.stopPropagation();
		event.preventDefault();
		if (isPending) return;
		if (isCurrentGenre) {
			onTogglePlay?.();
		} else {
			onPlay?.(genre);
		}
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			onKeyDown={(event) => event.stopPropagation()}
			aria-label={
				isPending
					? `Loading ${genreName}`
					: showPauseIcon
						? `Pause ${genreName}`
						: `Play ${genreName}`
			}
			title={
				isPending
					? "Loading tracks…"
					: showPauseIcon
						? "Pause"
						: `Play ${genreName}`
			}
			className={`absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-white text-zinc-950 shadow-md transition-all duration-150 hover:scale-110 active:scale-95 ${showAlways ? "opacity-100" : "opacity-0 group-hover:opacity-100"
				}`}
		>
			{isPending ? (
				<IconLoader2 size={13} className="animate-spin" />
			) : showPauseIcon ? (
				<IconPlayerPauseFilled size={13} />
			) : (
				<IconPlayerPlayFilled size={13} className="ml-0.5" />
			)}
		</button>
	);
}

export default GenrePlayButton;
