import { useRef, useState } from "react";
import {
	IconRefresh,
	IconChevronLeft,
	IconChevronRight,
	IconHeart,
	IconPlayerPlayFilled,
	IconPlayerPauseFilled,
	IconPlayerTrackNext,
	IconPlaylist,
	IconDots,
} from "@tabler/icons-react";
import Artwork from "../Artwork";

function AlbumCarousel({
	title,
	items = [],
	onPlayItem,
	onPlayNow,
	onTogglePlay,
	onPlayNext,
	onPlayLast,
	currentPlayingId,
	isPlaying,
	onRefresh,
	isRefreshing = false,
	compact = false,
}) {
	const scrollContainerRef = useRef(null);
	const [hoveredId, setHoveredId] = useState(null);
	const [favorites, setFavorites] = useState({});

	const scrollLeft = () => {
		if (scrollContainerRef.current) {
			const scrollAmount = scrollContainerRef.current.clientWidth * 0.75;
			scrollContainerRef.current.scrollBy({ left: -scrollAmount, behavior: "smooth" });
		}
	};

	const scrollRight = () => {
		if (scrollContainerRef.current) {
			const scrollAmount = scrollContainerRef.current.clientWidth * 0.75;
			scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
		}
	};

	const toggleFavorite = (id, e) => {
		e.stopPropagation();
		setFavorites((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	const runTrackAction = (action, item, e) => {
		e.stopPropagation();
		action?.(item);
	};

	return (
		<section>
			{/* Section Header */}
			<div className="mb-3 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h2 className="text-base font-semibold tracking-tight text-white">
						{title}
					</h2>
					<button
						type="button"
						onClick={onRefresh}
						aria-label={`Refresh ${title}`}
						disabled={!onRefresh || isRefreshing}
						className="rounded-xs p-0.5 text-zinc-400 hover:text-white transition disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
					>
						<IconRefresh
							size={12}
							stroke={2}
							className={isRefreshing ? "animate-spin" : ""}
						/>
					</button>
				</div>

				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={scrollLeft}
						aria-label="Scroll left"
						className="flex h-5 w-5 items-center justify-center rounded-xs text-zinc-400 hover:text-white transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
					>
						<IconChevronLeft size={14} stroke={2} />
					</button>
					<button
						type="button"
						onClick={scrollRight}
						aria-label="Scroll right"
						className="flex h-5 w-5 items-center justify-center rounded-xs text-zinc-400 hover:text-white transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
					>
						<IconChevronRight size={14} stroke={2} />
					</button>
				</div>
			</div>

			{/* Albums Carousel (Strictly 1 Row) */}
			<div
				ref={scrollContainerRef}
				className={`carousel-row pb-1 ${compact ? "compact" : ""}`}
			>
				{items.map((item) => {
					const isCardSelected = item.isSelected;
					const isCurrentlyPlaying = isPlaying && currentPlayingId === item.id;
					const isHovered = hoveredId === item.id || item.showHoverOverlayPreview;
					const isFav = favorites[item.id];

					return (
						<div
							key={item.id}
							onMouseEnter={() => setHoveredId(item.id)}
							onMouseLeave={() => setHoveredId(null)}
							onClick={() => onPlayItem && onPlayItem(item)}
							className="group cursor-pointer"
						>
							{/* Album Artwork Container */}
							<div
								className={`relative aspect-square w-full overflow-hidden rounded-xs bg-[#16161c] transition-all duration-200 ${isCardSelected
									? "ring-2 ring-red-600 shadow-lg shadow-red-900/30"
									: null
									}`}
							>
								<Artwork
									src={item.cover}
									alt={item.title}
									className="h-full w-full object-cover"
								/>

								{/* Hover Action Overlay matching screenshot */}
								<div
									className={`absolute inset-0 flex flex-col justify-between bg-black/65 p-2 transition-opacity duration-200 ${isHovered ? "opacity-100" : "opacity-0"
										}`}
								>
									{/* Top right Heart */}
									<div className="flex justify-start">
										<button
											type="button"
											onClick={(e) => toggleFavorite(item.id, e)}
											aria-label="Like"
											className="text-zinc-200 hover:text-red-500 transition"
										>
											<IconHeart
												size={15}
												stroke={1.8}
												className={isFav ? "fill-red-500 text-red-500" : ""}
											/>
										</button>
									</div>

									{/* Queue actions */}
									<div className="flex items-center justify-center gap-2">
										<button
											type="button"
											onClick={(e) => runTrackAction(onPlayNext, item, e)}
											aria-label={`Play ${item.title} next`}
											title="Play Next"
											className="flex h-7 w-7 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white active:scale-95"
										>
											<IconPlayerTrackNext size={15} stroke={2} />
										</button>
										<button
											type="button"
											onClick={(e) => runTrackAction(
												isCurrentlyPlaying ? onTogglePlay : (onPlayNow || onPlayItem),
												isCurrentlyPlaying ? undefined : item,
												e,
											)}
											aria-label={`${isCurrentlyPlaying ? "Pause" : "Play"} ${item.title}`}
											title={isCurrentlyPlaying ? "Pause" : "Play"}
											className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-950 shadow-md transition hover:scale-110 active:scale-95"
										>
											{isCurrentlyPlaying ? (
												<IconPlayerPauseFilled size={15} />
											) : (
												<IconPlayerPlayFilled size={15} className="ml-0.5" />
											)}
										</button>
										<button
											type="button"
											onClick={(e) => runTrackAction(onPlayLast, item, e)}
											aria-label={`Play ${item.title} last`}
											title="Play Last"
											className="flex h-7 w-7 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white active:scale-95"
										>
											<IconPlaylist size={16} stroke={2} />
										</button>
									</div>

									{/* Bottom right options */}
									<div className="flex justify-end">
										<button
											type="button"
											aria-label="Options"
											className="text-zinc-300 hover:text-white transition"
										>
											<IconDots size={14} stroke={2} />
										</button>
									</div>
								</div>
							</div>

							{/* Album info below artwork */}
							<div className="mt-2 flex flex-col">
								<span className="truncate text-xs font-semibold text-zinc-100 group-hover:text-white">
									{item.title}
								</span>
								<span className="truncate text-[11px] text-zinc-400 group-hover:text-zinc-300">
									{item.artist}
								</span>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

export default AlbumCarousel;