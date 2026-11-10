import { useNavigate } from "react-router-dom";
import GenrePlayButton from "../GenrePlayButton";

function GenresGrid({
	genres,
	onSelectGenre,
	onViewMore,
	onPlayGenre,
	onTogglePlay,
	isPlaying = false,
	pendingGenreIds,
	currentGenreNames,
	queueGenreNames,
}) {
	const navigate = useNavigate();

	const handleViewMore = () => {
		if (onViewMore) {
			onViewMore();
		} else {
			navigate("/genres");
		}
	};

	return (
		<section>
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-base font-semibold tracking-tight text-white">
					Genres
				</h2>
				<button
					type="button"
					onClick={handleViewMore}
					className="text-xs font-normal text-zinc-400 hover:text-white transition cursor-pointer"
				>
					View more
				</button>
			</div>

			<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5">
				{genres.map((genre) => {
					const nameKey = String(genre.name || "").toLowerCase();
					const isPending = pendingGenreIds?.has(genre.id) || false;
					// This genre's track is the one currently playing/paused
					const isCurrentGenre = currentGenreNames?.has(nameKey) || false;
					// Any track from this genre sits somewhere in the queue
					const isQueuedGenre = queueGenreNames?.has(nameKey) || false;

					const handleGenreClick = () => onSelectGenre && onSelectGenre(genre);

					return (
						<div
							key={genre.id}
							role="button"
							tabIndex={0}
							onClick={handleGenreClick}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									handleGenreClick();
								}
							}}
							aria-label={`Open ${genre.name}`}
							className="group relative flex h-11 items-center overflow-hidden rounded-xs border border-[#22222b]/80 bg-[#141419] px-3 transition-all duration-200 hover:bg-[#1f1f28] hover:border-zinc-700 text-left cursor-pointer focus:outline-none focus-visible:border-blue-500"
						>
							{/* Left colored accent pill */}
							<div
								className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xs transition-all group-hover:w-1.5"
								style={{ backgroundColor: genre.color }}
							/>

							<span className="truncate pl-1.5 pr-7 text-xs font-medium text-zinc-200 group-focus:text-white group-hover:text-white">
								{genre.name}
							</span>

							{/* Play/pause overlay: play on hover; pause/queue members stay visible */}
							<GenrePlayButton
								genre={genre}
								isPlaying={isPlaying}
								isPending={isPending}
								isCurrentGenre={isCurrentGenre}
								isQueuedGenre={isQueuedGenre}
								onPlay={onPlayGenre}
								onTogglePlay={onTogglePlay}
							/>
						</div>
					);
				})}
			</div>
		</section>
	);
}

export default GenresGrid;
