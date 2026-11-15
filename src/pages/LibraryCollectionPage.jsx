import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { IconChevronLeft, IconSearch, IconServer, IconDotsVertical } from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { usePlayer } from "../context/PlayerContext";
import { fetchMusicCollection, fetchMusicItem, getTrackAlbumLink } from "../services/jellyfin";
import useGenrePlayback from "../hooks/useGenrePlayback";
import GenrePlayButton from "../components/GenrePlayButton";
import TrackPlayButton from "../components/TrackPlayButton";
import Artwork from "../components/Artwork";

function formatDuration(seconds) {
	if (!seconds || !Number.isFinite(seconds)) return "";
	return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function LibraryCollectionPage({
	title,
	icon: Icon,
	loadItems,
	detailId,
	detailFilter,
	detailPath,
	entityList = false,
	isFolderList = false,
	genreCards = false,
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const { session, isAuthenticated, openServerModal, libraryVersion } = useJellyfin();
	const { playTrack, currentTrack, isPlaying: isPlayerPlaying, togglePlay: togglePlayerPlay } = usePlayer();
	const { playGenre, pendingGenreIds, activeGenreId, currentGenreNames, isPlaying, togglePlay } = useGenrePlayback();
	const [items, setItems] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [search, setSearch] = useState("");
	const [detailTitle, setDetailTitle] = useState(location.state?.title || "");

	useEffect(() => {
		if (!isAuthenticated || !session) {
			setItems([]);
			return undefined;
		}

		let cancelled = false;
		setDetailTitle(location.state?.title || "");
		const load = async () => {
			setIsLoading(true);
			setError("");
			try {
				let data;
				if (detailId) {
					const entity = await fetchMusicItem(
						session.serverUrl,
						session.userId,
						session.accessToken,
						detailId,
					);
					if (!cancelled) setDetailTitle(location.state?.title || entity.title);
					const filter = { [detailFilter]: detailId };
					if (isFolderList) filter.includeItemTypes = ["Audio"];
					data = await fetchMusicCollection(
						session.serverUrl,
						session.userId,
						session.accessToken,
						filter,
					);
				} else {
					data = await loadItems(session);
				}
				if (!cancelled) setItems(data);
			} catch (loadError) {
				console.error(`Failed to load ${title.toLowerCase()}:`, loadError);
				if (!cancelled) {
					setError(navigator.onLine
						? `Could not load ${title.toLowerCase()}. Please try again.`
						: "You are offline and this section was not cached. Connect to the server and sync your library.");
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [detailFilter, detailId, isAuthenticated, isFolderList, libraryVersion, loadItems, location.state?.title, session, title]);

	const visibleItems = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return items;
		return items.filter((item) =>
			[item.title, item.name, item.artist, item.album]
				.some((value) => value?.toLowerCase().includes(query)),
		);
	}, [items, search]);

	const pageTitle = detailId ? detailTitle || title.slice(0, -1) : title;
	const playFromList = (track) => {
		const index = visibleItems.findIndex((item) => item.id === track.id);
		playTrack(track, index < 0 ? [track] : visibleItems.slice(index));
	};

	return (
		<div className="flex flex-col">
			<header className="sticky top-0 z-30 flex flex-col gap-4 bg-[#0a0a0d] sm:flex-row sm:items-center sm:justify-between py-7">
				<div className="flex items-center">
					{detailId && (
						<button
							type="button"
							onClick={() => navigate(detailPath)}
							aria-label={`Back to ${title}`}
							className="flex h-8 w-8 items-center justify-center text-zinc-400 transition hover:text-white cursor-pointer"
						>
							<IconChevronLeft size={16} />
						</button>
					)}
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-2">
							<Icon size={19} stroke={1.7} />
							<h1 className="text-xl font-bold tracking-tight text-white">{pageTitle}</h1>
						</div>
						{!isLoading && !error && (
							<span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
								{visibleItems.length}
							</span>
						)}
					</div>
				</div>

				{isAuthenticated && items.length > 0 && (
					<div className="relative flex items-center">
						<IconSearch size={14} className="pointer-events-none absolute left-3 text-zinc-400" />
						<input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={`Search ${title.toLowerCase()}...`}
							className="h-8 w-full rounded-xs border border-[#2b2b35] bg-[#141419] pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none sm:w-56"
						/>
					</div>
				)}
			</header>

			{!isAuthenticated ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xs border border-blue-500/20 bg-blue-500/10 text-blue-400">
						<IconServer size={24} />
					</div>
					<h2 className="text-sm font-semibold text-zinc-200">Server Not Connected</h2>
					<p className="mb-4 mt-1 max-w-sm text-xs text-zinc-400">
						Connect to Jellyfin to browse your music library.
					</p>
					<button
						type="button"
						onClick={openServerModal}
						className="rounded-xs bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
					>
						Connect Server
					</button>
				</div>
			) : isLoading ? (
				<div className="py-16 text-center text-xs text-zinc-500">Loading library…</div>
			) : error ? (
				<div className="py-16 text-center text-xs text-red-400">{error}</div>
			) : visibleItems.length === 0 ? (
				<div className="py-16 text-center">
					<Icon size={30} className="mx-auto mb-2 text-zinc-600" />
					<p className="text-sm font-medium text-zinc-400">
						{search ? "No matching items" : `No ${title.toLowerCase()} found`}
					</p>
					<p className="mt-1 text-xs text-zinc-600">
						{search ? "Try a different search." : "This library does not contain any items yet."}
					</p>
				</div>
			) : entityList && !detailId ? (
				genreCards ? (
					<div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
						{visibleItems.map((genre) => {
							const nameKey = String(genre.name || "").toLowerCase();
							const isPending = pendingGenreIds?.has(genre.id) || false;
							const isCurrentGenre = currentGenreNames?.has(nameKey) || false;
							const isActiveGenre = activeGenreId != null && activeGenreId === genre.id;
							const navigateToGenre = () =>
								navigate(`${detailPath}/${genre.id}`, { state: { title: genre.name } });
							return (
								<div
									key={genre.id}
									role="button"
									tabIndex={0}
									onClick={navigateToGenre}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											navigateToGenre();
										}
									}}
									aria-label={`Open ${genre.name}`}
									className="group relative flex h-11 items-center overflow-hidden rounded-xs border border-[#22222b]/80 bg-[#141419] px-3 text-left transition-all duration-200 hover:border-zinc-700 hover:bg-[#1f1f28] focus:outline-none focus-visible:border-blue-500 cursor-pointer"
								>
									<span
										className="absolute bottom-0 left-0 top-0 w-1 rounded-l-xs transition-all group-hover:w-1.5"
										style={{ backgroundColor: genre.color }}
									/>
									<span className="truncate pl-1.5 pr-7 text-xs font-medium text-zinc-200 group-hover:text-white">
										{genre.name}
									</span>
									<GenrePlayButton
										genre={genre}
										isPlaying={isPlaying}
										isPending={isPending}
										isCurrentGenre={isCurrentGenre}
										isActiveGenre={isActiveGenre}
										onPlay={playGenre}
										onTogglePlay={togglePlay}
									/>
								</div>
							);
						})}
					</div>
				) : (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
						{visibleItems.map((item) => (
							<div
								key={item.id}
								role="button"
								tabIndex={0}
								onClick={() => navigate(`${detailPath}/${item.id}`, { state: { title: item.title || item.name } })}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										navigate(`${detailPath}/${item.id}`, { state: { title: item.title || item.name } });
									}
								}}
								aria-label={`Open ${item.title || item.name}`}
								className="min-w-0 text-left group cursor-pointer"
							>
								<div className={`relative aspect-square rounded-xs border border-[#22222a] bg-[#141419] brightness-90 grayscale-60 group-hover:grayscale-0 group-hover:brightness-100 group-focus:outline-none group-focus-visible:brightness-100 transition-all duration-200 ${isFolderList && !item.cover ? "flex items-center justify-center" : ""}`}>
									{isFolderList && item.cover ? (
										<Artwork src={item.cover} alt={item.title || item.name} className="h-full w-full object-cover cursor-pointer" />
									) : isFolderList ? (
										<Icon size={48} stroke={1.2} className="text-zinc-300 group-hover:text-white transition-all duration-200 cursor-pointer" />
									) : (
										<Artwork src={item.cover} alt="" className="h-full w-full object-cover cursor-pointer" />
									)}
								</div>
								<div className="mt-2 flex flex-row items-center justify-between">
									<span className="block truncate text-xs font-semibold text-zinc-300 group-hover:text-white transition-all duration-200 cursor-pointer" title={item.title || item.name}>
										{item.title || item.name}
									</span>
									{/* Options Dropdown */}
									<button
										type="button"
										onClick={(event) => {
											event.stopPropagation();
											// Handle more actions for the item (e.g., show a dropdown menu)
										}}
										onKeyDown={(event) => event.stopPropagation()}
										aria-label="More actions"
										className="text-zinc-400 hover:text-white p-1 cursor-pointer transition"
									>
										<IconDotsVertical size={14} stroke={1.5} />
									</button>
								</div>
							</div>
						))}
					</div>
				)
			) : (
				<div className="overflow-hidden rounded-xs border border-[#22222a] bg-[#101014]">
					<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] gap-3 border-b border-[#22222a] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_4rem]">
						<span className="block text-center">#</span>
						<span>Title</span>
						<span className="block">Album</span>
						<span className="text-right">Time</span>
						<span></span>
					</div>
					{visibleItems.map((track, index) => {
						const albumLink = getTrackAlbumLink(track);
						return (
							<div
								key={track.id}
								role="button"
								tabIndex={0}
								onClick={() => playFromList(track)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										playFromList(track);
									}
								}}
								aria-label={`Play ${track.title || "track"}`}
								className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] items-center gap-3 border-b border-[#1b1b22] px-3 py-2 text-left last:border-b-0 hover:bg-white/5 focus:outline-none focus-visible:bg-white/5 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_4rem]"
							>
								<TrackPlayButton
									index={index}
									isCurrent={currentTrack?.id === track.id}
									isPlaying={isPlayerPlaying}
									onPlay={() => playFromList(track)}
									onTogglePlay={togglePlayerPlay}
								/>
								<span className="flex min-w-0 items-center gap-3">
									<Artwork src={track.cover} alt="" className="h-9 w-9 shrink-0 rounded-xs object-cover" />
									<span className="min-w-0">
										<span
											onClick={(event) => {
												event.stopPropagation();
												navigate(`/tracks/${track.id}`, { state: { track } });
											}}
											title="View track details"
											className={`block truncate text-xs font-semibold ${currentTrack?.id === track.id ? "text-blue-500" : "text-white"} cursor-pointer hover:underline underline-offset-2 transition-all duration-200`}
										>
											{track.title}
										</span>
										{track.raw?.ArtistItems?.[0]?.Id ? (
											<span
												onClick={(event) => {
													event.stopPropagation();
													navigate(`/artists/${track.raw.ArtistItems[0].Id}`, { state: { title: track.artist } });
												}}
												title="View artist details"
												className="block truncate text-[11px] font-light text-zinc-400 hover:text-white cursor-pointer hover:underline underline-offset-2 transition-all duration-200">
												{track.artist}
											</span>
										) : (
											<span className="block truncate text-[11px] font-light text-zinc-400">
												{track.artist}
											</span>
										)}
									</span>
								</span>
								<span className="block">
									{albumLink ? (
										<span
											onClick={(event) => {
												event.stopPropagation();
												navigate(`/albums/${albumLink.id}`, { state: { title: albumLink.title } });
											}}
											title="View album"
											className="block cursor-pointer truncate text-xs text-zinc-500 hover:text-white hover:underline underline-offset-2"
										>
											{track.album}
										</span>
									) : (
										<span className="block truncate text-xs text-zinc-500">{track.album}</span>
									)}
								</span>
								<span className="text-right text-[11px] text-zinc-500">{formatDuration(track.duration)}</span>
								<span className="flex justify-end">
									<button
										type="button"
										onClick={(event) => {
											event.stopPropagation();
											// Handle more actions for the track (e.g., show a dropdown menu)
										}}
										aria-label="More actions"
										className="text-zinc-400 hover:text-white p-0.5 cursor-pointer transition"
									>
										<IconDotsVertical size={14} stroke={1.5} />
									</button>
								</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
