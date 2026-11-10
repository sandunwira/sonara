import { useNavigate } from "react-router-dom";

function GenresGrid({ genres, onSelectGenre, onViewMore }) {
	const navigate = useNavigate();

	const handleViewMore = () => {
		if (onViewMore) {
			onViewMore();
		} else {
			navigate("/genres");
		}
	};

	return (
		<section className="mb-7">
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
				{genres.map((genre) => (
					<button
						key={genre.id}
						type="button"
						onClick={() => onSelectGenre && onSelectGenre(genre)}
						className="group relative flex h-11 items-center overflow-hidden rounded-xs border border-[#22222b]/80 bg-[#141419] px-3 transition-all duration-200 hover:bg-[#1f1f28] hover:border-zinc-700 text-left cursor-pointer"
					>
						{/* Left colored accent pill */}
						<div
							className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xs transition-all group-hover:w-1.5"
							style={{ backgroundColor: genre.color }}
						/>

						<span className="truncate pl-1.5 text-xs font-medium text-zinc-200 group-hover:text-white">
							{genre.name}
						</span>
					</button>
				))}
			</div>
		</section>
	);
}

export default GenresGrid;
