import {
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
} from "@tabler/icons-react";

// Play/pause button for track table rows (library + detail pages). Rendered
// inside the "#" column: the row number is normally shown and is replaced
// by a play pill on row hover. The row of the currently loaded track keeps
// its pill visible at all times (blue) and reflects live playback state.
// The click handler must stopPropagation so the row's own play action
// (which would restart the track) does not also fire.
function TrackPlayButton({
	index,
	isCurrent = false,
	isPlaying = false,
	onPlay,
	onTogglePlay,
}) {
	const showPauseIcon = isCurrent && isPlaying;

	const handleClick = (event) => {
		event.stopPropagation();
		event.preventDefault();
		if (isCurrent) {
			onTogglePlay?.();
		} else {
			onPlay?.();
		}
	};

	return (
		<span className="relative items-center justify-center flex">
			<span
				aria-hidden="true"
				className={`absolute inset-0 flex items-center justify-center text-[11px] text-zinc-600 transition-opacity ${isCurrent ? "opacity-0" : "opacity-100 group-hover:opacity-0"}`}
			>
				{index + 1}
			</span>
			<button
				type="button"
				onClick={handleClick}
				onKeyDown={(event) => event.stopPropagation()}
				aria-label={showPauseIcon ? "Pause" : `Play ${index + 1}`}
				title={showPauseIcon ? "Pause" : "Play"}
				className={`absolute transition-all duration-150 ${
					isCurrent
						? "text-blue-500 opacity-100"
						: "text-white opacity-0 group-hover:opacity-100"
				}`}
			>
				{showPauseIcon
					? <IconPlayerPauseFilled size={13} />
					: <IconPlayerPlayFilled size={13} />}
			</button>
		</span>
	);
}

export default TrackPlayButton;
