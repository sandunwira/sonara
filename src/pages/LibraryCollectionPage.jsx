import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	IconCircleCheckFilled,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconSearch,
	IconServer,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { usePlayer } from "../context/PlayerContext";
import { fetchMusicCollection, fetchMusicItem, getThumbnailUrl, getTrackAlbumLink } from "../services/jellyfin";
import useGenrePlayback from "../hooks/useGenrePlayback";
import GenrePlayButton from "../components/GenrePlayButton";
import TrackPlayButton from "../components/TrackPlayButton";
import TrackOptionsMenu from "../components/TrackOptionsMenu";
import { useDownloadedTracks } from "../services/offlineDownloads";
import Artwork from "../components/Artwork";

function formatDuration(seconds) {
	if (!seconds || !Number.isFinite(seconds)) return "";
	return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

// Track tables render incrementally: the first screenful is painted
// immediately and another chunk is appended whenever the sentinel below the
// list scrolls into view. Mounting all 3,000 rows at once was the main reason
// opening the Tracks page felt slow; search/queue actions still use the full
// (unrendered) item list.
const INITIAL_TRACK_ROWS = 100;
const TRACK_ROW_CHUNK = 250;

// One row of the track table. Memoized so play/pause or a track change only
// re-renders the affected row instead of every row in a 3,000-track library.
// Actions arrive through a ref so their identity stays stable while always
// pointing at the latest handlers. The "track-row" class also lets the
// browser skip layout/paint for rows scrolled out of view.
// Clicking the row body does nothing — playback starts only from the play
// button in the number column; the rest of the row holds navigation links
// and the options dropdown.
const TrackRow = memo(function TrackRow({ track, index, isCurrent, isPlaying, actionsRef }) {
	const { session } = useJellyfin();
	// Offline indicator: subscribed to the downloaded-tracks store so the
	// check mark appears the moment a download finishes.
	const downloadedTracks = useDownloadedTracks(session?.serverUrl);
	const isDownloaded = downloadedTracks.has(track.id);
	const albumLink = getTrackAlbumLink(track);
	return (
		<div
			className="track-row group grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] items-center gap-3 border-b border-[#1b1b22] px-3 py-2 text-left last:border-b-0 hover:bg-white/5 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_4rem]"
		>
			<TrackPlayButton
				index={index}
				isCurrent={isCurrent}
				isPlaying={isPlaying}
				onPlay={() => actionsRef.current.play(track)}
				onTogglePlay={() => actionsRef.current.togglePlay()}
			/>
			<span className="flex min-w-0 items-center gap-3">
				<Artwork src={track.cover ? getThumbnailUrl(track.cover, 96) : track.cover} alt="" className="h-9 w-9 shrink-0 rounded-xs object-cover" />
				<span className="min-w-0">
					<span
						onClick={(event) => {
							event.stopPropagation();
							actionsRef.current.openTrack(track);
						}}
						title="View track details"
						className={`block truncate text-xs font-semibold ${isCurrent ? "text-blue-500" : "text-white"} cursor-pointer hover:underline underline-offset-2 transition-all duration-200`}
					>
						{track.title}
					</span>
					{track.raw?.ArtistItems?.[0]?.Id ? (
						<span
							onClick={(event) => {
								event.stopPropagation();
								actionsRef.current.openArtist(track.raw.ArtistItems[0].Id, track.artist);
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
							actionsRef.current.openAlbum(albumLink.id, albumLink.title);
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
			<span className="flex flex-row items-center justify-end gap-2">
				{isDownloaded && (
					<IconCircleCheckFilled
						size={16}
						className="text-blue-500"
						title="Saved for offline"
					/>
				)}
				{/* Hover fade lives on the trigger only: the dropdown itself is a
				    sibling of the fade wrapper, so it stays visible when the
				    cursor moves off the row onto the overhanging menu. */}
				<span className="relative">
					<TrackOptionsMenu
						track={track}
						iconSize={14}
						align="right"
						className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200"
					/>
				</span>
			</span>
		</div>
	);
});

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
	// Show a play/pause button next to the headline that starts (or
	// pauses) playback of this whole collection.
	playAll = false,
	// Empty-state copy for a detail view (e.g. "This playlist is empty"),
	// shown instead of the collection-level "No {title} found" message.
	detailEmptyTitle,
	detailEmptySubtitle,
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const { session, isAuthenticated, openServerModal, libraryVersion } = useJellyfin();
	const { playTrack, currentTrack, isPlaying: isPlayerPlaying, togglePlay: togglePlayerPlay, playbackSource, setPlaybackSource } = usePlayer();
	const { playGenre, pendingGenreIds, activeGenreId, currentGenreNames, isPlaying, togglePlay } = useGenrePlayback();
	// Loaded data is tagged with the collection it belongs to (server + detail
	// route). When that key changes, the old items are not rendered at all:
	// otherwise navigating from a folder/genre grid into its detail showed the
	// previous grid entities through the track-list branch for one frame before
	// the effect cleared them.
	const collectionKey = `${session?.serverUrl || ""}|${session?.userId || ""}|${detailId || ""}`;
	const [loadedCollection, setLoadedCollection] = useState({ key: null, items: [] });
	const [errorState, setErrorState] = useState({ key: null, message: "" });
	const [isLoading, setIsLoading] = useState(false);
	const [search, setSearch] = useState("");
	const [detailTitle, setDetailTitle] = useState(location.state?.title || "");

	const isSelectionPending = loadedCollection.key !== collectionKey;
	const items = isSelectionPending ? [] : loadedCollection.items;
	const error = errorState.key === collectionKey ? errorState.message : "";

	// Header play/pause: playback stamped with this collection's source id
	// (detail id, or the page title for whole-library pages) is playing this
	// list — playTrack clears the stamp on any other start, so a stale
	// source can't keep the pause icon lit on the wrong page.
	const playAllSourceId = detailId || title.toLowerCase();
	const isCollectionActive = playAll
		&& playbackSource?.type === "collection"
		&& playbackSource?.id === playAllSourceId;
	const handlePlayAll = () => {
		if (!items.length) return;
		if (isCollectionActive) {
			togglePlayerPlay();
			return;
		}
		playTrack(items[0], items);
		setPlaybackSource({ type: "collection", id: playAllSourceId, name: pageTitle });
	};

	useEffect(() => {
		if (!isAuthenticated || !session) {
			setLoadedCollection({ key: null, items: [] });
			return undefined;
		}

		const requestKey = collectionKey;
		let cancelled = false;
		setDetailTitle(location.state?.title || "");
		const load = async () => {
			// Stale-while-revalidate: when this collection already has data on
			// screen (e.g. a background refetch after a favorite toggle bumps
			// libraryVersion), keep the current list visible instead of
			// flashing the blocking loading state.
			const hasCurrentData = loadedCollection.key === requestKey && loadedCollection.items.length > 0;
			if (!hasCurrentData) {
				setIsLoading(true);
				setErrorState({ key: requestKey, message: "" });
			}
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
				if (!cancelled) {
					// Background refresh of unchanged data (cache hit returns
					// fresh objects every time): skip the state update when
					// the item sequence is identical, so memoized rows,
					// scroll position and incremental rendering stay put.
					const previous = loadedCollection.key === requestKey ? loadedCollection.items : null;
					const unchanged = Boolean(previous)
						&& previous.length === data.length
						&& previous.every((item, index) => item === data[index] || item.id === data[index]?.id);
					if (!unchanged) {
						setLoadedCollection({ key: requestKey, items: data });
					}
				}
			} catch (loadError) {
				console.error(`Failed to load ${title.toLowerCase()}:`, loadError);
				// A failed background refresh keeps the already-rendered list;
				// a failed first load shows the error state.
				if (!cancelled && !hasCurrentData) {
					setLoadedCollection({ key: requestKey, items: [] });
					setErrorState({
						key: requestKey,
						message: navigator.onLine
							? `Could not load ${title.toLowerCase()}. Please try again.`
							: "You are offline and this section was not cached. Connect to the server and sync your library.",
					});
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [collectionKey, detailFilter, detailId, isAuthenticated, isFolderList, libraryVersion, loadItems, location.state?.title, session, title]);

	const visibleItems = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return items;
		return items.filter((item) =>
			[item.title, item.name, item.artist, item.album]
				.some((value) => value?.toLowerCase().includes(query)),
		);
	}, [items, search]);

	// Incremental row rendering for long track tables (see constants above).
	const [renderedCount, setRenderedCount] = useState(INITIAL_TRACK_ROWS);
	const loadMoreRef = useRef(null);
	const renderedItems = useMemo(
		() => visibleItems.slice(0, renderedCount),
		[visibleItems, renderedCount],
	);

	useEffect(() => {
		setRenderedCount(INITIAL_TRACK_ROWS);
	}, [items, search]);

	useEffect(() => {
		if (renderedCount >= visibleItems.length) return undefined;
		const node = loadMoreRef.current;
		if (!node) return undefined;
		// Scroll container is the layout's <main>; observing against it keeps
		// the trigger accurate wherever this table is used.
		const root = node.closest("main");
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setRenderedCount((count) => Math.min(count + TRACK_ROW_CHUNK, visibleItems.length));
			}
		}, { root, rootMargin: "600px 0px" });
		observer.observe(node);
		return () => observer.disconnect();
	}, [renderedCount, visibleItems.length]);

	const pageTitle = detailId ? detailTitle || title.slice(0, -1) : title;
	const playFromList = (track) => {
		const index = visibleItems.findIndex((item) => item.id === track.id);
		playTrack(track, index < 0 ? [track] : visibleItems.slice(index));
	};
	// Stable container for row handlers; refreshed every render so memoized
	// rows always invoke the latest closures without re-rendering themselves.
	const trackActionsRef = useRef(null);
	trackActionsRef.current = {
		play: playFromList,
		togglePlay: togglePlayerPlay,
		openTrack: (track) => navigate(`/tracks/${track.id}`, { state: { track } }),
		openAlbum: (albumId, title) => navigate(`/albums/${albumId}`, { state: { title } }),
		openArtist: (artistId, title) => navigate(`/artists/${artistId}`, { state: { title } }),
	};

	return (
		<div className="flex flex-col">
			<header className="sticky top-0 z-30 flex flex-col gap-4 bg-[#0a0a0d] sm:flex-row sm:items-center sm:justify-between py-7">
				<div className="flex items-center">
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-2">
							<Icon size={19} stroke={1.7} />
							{/* Play/pause this whole collection (favorites, tracks,
							libraries, playlists) */}
							{playAll && !isLoading && !isSelectionPending && !error && items.length > 0 && (
								<button
									type="button"
									onClick={handlePlayAll}
									aria-label={isCollectionActive && isPlayerPlaying ? `Pause ${pageTitle}` : `Play ${pageTitle}`}
									title={isCollectionActive && isPlayerPlaying ? `Pause ${pageTitle}` : `Play ${pageTitle}`}
									className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-500"
								>
									{isCollectionActive && isPlayerPlaying ? (
										<IconPlayerPauseFilled size={12} />
									) : (
										<IconPlayerPlayFilled size={12} className="ml-0.5" />
									)}
								</button>
							)}
							<h1 className="font-display text-xl font-bold tracking-tight text-white">{pageTitle}</h1>
						</div>
						{!isLoading && !isSelectionPending && !error && (
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
			) : isLoading || isSelectionPending ? (
				<div className="py-16 text-center text-xs text-zinc-500">Loading library…</div>
			) : error ? (
				<div className="py-16 text-center text-xs text-red-400">{error}</div>
			) : visibleItems.length === 0 ? (
				<div className="py-16 text-center">
					<Icon size={30} className="mx-auto mb-2 text-zinc-600" />
					<p className="text-sm font-medium text-zinc-400">
						{search
							? "No matching items"
							: detailId && detailEmptyTitle
								? detailEmptyTitle
								: `No ${title.toLowerCase()} found`}
					</p>
					<p className="mt-1 text-xs text-zinc-600">
						{search
							? "Try a different search."
							: detailId && detailEmptySubtitle
								? detailEmptySubtitle
								: "This library does not contain any items yet."}
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
										<Artwork src={getThumbnailUrl(item.cover, 200)} alt={item.title || item.name} className="h-full w-full object-cover cursor-pointer" />
									) : isFolderList ? (
										<Icon size={48} stroke={1.2} className="text-zinc-300 group-hover:text-white transition-all duration-200 cursor-pointer" />
									) : (
										<Artwork src={item.cover ? getThumbnailUrl(item.cover, 200) : item.cover} alt="" className="h-full w-full object-cover cursor-pointer" />
									)}
								</div>
								<div className="mt-2 flex flex-row items-center justify-between">
									<span className="block truncate text-xs font-semibold text-zinc-300 group-hover:text-white transition-all duration-200 cursor-pointer" title={item.title || item.name}>
										{item.title || item.name}
									</span>
								</div>
							</div>
						))}
					</div>
				)
			) : (
				<>
					<div className="overflow-hidden rounded-xs border border-[#22222a] bg-[#101014]">
						<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] gap-3 border-b border-[#22222a] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_4rem]">
							<span className="block text-center">#</span>
							<span>Title</span>
							<span className="block">Album</span>
							<span className="text-right">Time</span>
							<span></span>
						</div>
						{renderedItems.map((track, index) => {
							const isCurrent = currentTrack?.id === track.id;
							return (
								<TrackRow
									key={track.id}
									track={track}
									index={index}
									isCurrent={isCurrent}
									isPlaying={isCurrent ? isPlayerPlaying : false}
									actionsRef={trackActionsRef}
								/>
							);
						})}
					</div>
					{renderedCount < visibleItems.length && (
						<div ref={loadMoreRef} className="h-px w-full" aria-hidden="true" />
					)}
				</>
			)}
		</div>
	);
}
