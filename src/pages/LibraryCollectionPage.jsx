import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { IconChevronLeft, IconSearch, IconServer } from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { usePlayer } from "../context/PlayerContext";
import { fetchMusicCollection, fetchMusicItem } from "../services/jellyfin";
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
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const { session, isAuthenticated, openServerModal, libraryVersion } = useJellyfin();
	const { playTrack } = usePlayer();
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
				if (!cancelled) setError(`Could not load ${title.toLowerCase()}. Please try again.`);
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
			<header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center">
					{detailId && (
						<button
							type="button"
							onClick={() => navigate(detailPath)}
							aria-label={`Back to ${title}`}
							className="flex h-8 w-8 items-center justify-center text-zinc-400 transition hover:text-white"
						>
							<IconChevronLeft size={16} />
						</button>
					)}
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-2">
							<Icon size={19} stroke={1.7} />
							<h1 className="text-xl font-bold tracking-tight text-white">{pageTitle}</h1>
						</div>
						<span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
							{visibleItems.length}
						</span>
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
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
					{visibleItems.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => navigate(`${detailPath}/${item.id}`, { state: { title: item.title || item.name } })}
							className="group min-w-0 text-left"
						>
							<div className={`relative aspect-square overflow-hidden rounded-xs border border-[#22222a] bg-[#141419] ${isFolderList ? "flex items-center justify-center" : ""}`}>
								{isFolderList ? (
									<Icon size={48} stroke={1.2} className="text-zinc-500 transition group-hover:text-blue-400" />
								) : (
									<Artwork src={item.cover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
								)}
							</div>
							<span className="mt-2 block truncate text-xs font-semibold text-zinc-100 group-hover:text-white">
								{item.title || item.name}
							</span>
						</button>
					))}
				</div>
			) : (
				<div className="overflow-hidden rounded-xs border border-[#22222a] bg-[#101014]">
					<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] gap-3 border-b border-[#22222a] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_4rem]">
						<span className="hidden sm:block">#</span>
						<span>Title</span>
						<span className="hidden sm:block">Artist</span>
						<span className="hidden sm:block">Album</span>
						<span className="text-right">Time</span>
					</div>
					{visibleItems.map((track, index) => (
						<button
							key={track.id}
							type="button"
							onClick={() => playFromList(track)}
							className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] items-center gap-3 border-b border-[#1b1b22] px-3 py-2 text-left last:border-b-0 hover:bg-white/5 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_4rem]"
						>
							<span className="hidden text-[11px] text-zinc-600 sm:block">{index + 1}</span>
							<span className="flex min-w-0 items-center gap-2">
								<Artwork src={track.cover} alt="" className="h-9 w-9 shrink-0 rounded-xs object-cover" />
								<span className="min-w-0">
									<span className="block truncate text-xs font-medium text-zinc-200">{track.title}</span>
									<span className="block truncate text-[10px] text-zinc-500 sm:hidden">{track.artist}</span>
								</span>
							</span>
							<span className="hidden truncate text-xs text-zinc-400 sm:block">{track.artist}</span>
							<span className="hidden truncate text-xs text-zinc-500 sm:block">{track.album}</span>
							<span className="text-right text-[11px] text-zinc-500">{formatDuration(track.duration)}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
