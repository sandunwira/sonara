import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
	IconArrowBarToDown,
	IconChevronRight,
	IconCircleCheckFilled,
	IconDisc,
	IconDownload,
	IconDotsVertical,
	IconHeart,
	IconHeartFilled,
	IconInfoCircle,
	IconMusic,
	IconPlayerPlayFilled,
	IconPlayerTrackNext,
	IconPlaylistAdd,
	IconPlus,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { usePlayer } from "../context/PlayerContext";
import {
	addToJellyfinPlaylist,
	createJellyfinPlaylist,
	fetchJellyfinPlaylists,
	getTrackAlbumLink,
	getTrackArtistLink,
	setJellyfinFavorite,
} from "../services/jellyfin";
import { downloadTrackOffline, useDownloadedTracks } from "../services/offlineDownloads";
import PlaylistNameModal from "./modals/PlaylistNameModal";
import TrackFileInfoModal from "./modals/TrackFileInfoModal";

const MENU_WIDTH = "w-48";
const SUBMENU_WIDTH = "w-44";
const SUBMENU_MAX_HEIGHT = "max-h-60 overflow-y-auto";
// Roughly the tallest the main menu ever gets (8 items + dividers); used to
// decide whether it fits below the trigger or has to open upwards.
const MENU_ESTIMATED_HEIGHT = 320;

const itemClass =
	"flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white cursor-pointer";
const disabledItemClass =
	"flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-500 cursor-default";
const submenuItemClass =
	"flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white cursor-pointer";

function PlaylistSubmenuContent({ playlists, isLoading, error, onPick, onNew, onClose }) {
	if (isLoading) {
		return <div className="px-3 py-2 text-xs text-zinc-500">Loading playlists…</div>;
	}
	if (error) {
		return <div className="px-3 py-2 text-xs text-red-400/80">{error}</div>;
	}
	return (
		<>
			{playlists.length === 0 ? (
				<button
					type="button"
					onClick={() => {
						onClose();
						onNew();
					}}
					className={submenuItemClass}
				>
					<IconPlus size={14} stroke={1.8} />
					Create new playlist…
				</button>
			) : (
				<div className={SUBMENU_MAX_HEIGHT}>
					{playlists.map((playlist) => (
						<button
							key={playlist.id}
							type="button"
							onClick={() => {
								onClose();
								onPick(playlist);
							}}
							title={playlist.name}
							className={submenuItemClass}
						>
							<span className="truncate">{playlist.name}</span>
						</button>
					))}
				</div>
			)}
			{playlists.length > 0 && (
				<>
					<div className="my-1 border-t border-[#2b2b36]" />
					<button
						type="button"
						onClick={() => {
							onClose();
							onNew();
						}}
						className={submenuItemClass}
					>
						<IconPlus size={14} stroke={1.8} />
						New playlist…
					</button>
				</>
			)}
		</>
	);
}

// Reusable per-track options dropdown: Play (Now/Next/Last), Add to Queue,
// Add to Playlist (server-side Jellyfin playlists), Favorite, Download,
// Go to Album, Go to Artist and File Info.
//
// While open, the menu renders through a document.body portal with fixed
// viewport coordinates taken from the trigger's rect: track tables live in
// scroll containers, and an in-flow menu overhanging the container edge
// gets clipped (top) or pushes scroll extent (bottom). The menu closes on
// any scroll so it never detaches from its trigger.
export default function TrackOptionsMenu({
	track,
	iconSize = 14,
	align = "right",
	className = "",
}) {
	const { session } = useJellyfin();
	const { playNow, playNext, playLast, addToQueue } = usePlayer();
	const navigate = useNavigate();

	// Subscribed to the downloaded-tracks store: the menu item flips to
	// "Downloaded" with a blue check the moment the download finishes.
	const downloadedTracks = useDownloadedTracks(session?.serverUrl);
	const isDownloaded = downloadedTracks.has(track?.id);

	const buttonRef = useRef(null);
	const menuRef = useRef(null);
	const [isOpen, setIsOpen] = useState(false);
	const [openSubmenu, setOpenSubmenu] = useState(null);
	// Fixed viewport coordinates + flip decisions, computed once at open
	// time from the trigger's rect (see openMenu).
	const [placement, setPlacement] = useState({ style: null, flipUp: false, submenuLeft: false });
	const [playlists, setPlaylists] = useState([]);
	const [playlistsState, setPlaylistsState] = useState("idle"); // idle | loading | ready | error
	const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
	const [fileInfoOpen, setFileInfoOpen] = useState(false);
	const [isFavorite, setIsFavorite] = useState(Boolean(track?.raw?.UserData?.IsFavorite));

	// The raw UserData flag is the source of truth; re-sync whenever the
	// track row is re-rendered with a different item or fresh metadata.
	useEffect(() => {
		setIsFavorite(Boolean(track?.raw?.UserData?.IsFavorite));
	}, [track?.id, track?.raw?.UserData?.IsFavorite]);

	const closeMenu = useCallback(() => {
		setIsOpen(false);
		setOpenSubmenu(null);
	}, []);

	const loadPlaylists = useCallback(async () => {
		if (!session) return;
		setPlaylistsState("loading");
		try {
			const data = await fetchJellyfinPlaylists(
				session.serverUrl,
				session.userId,
				session.accessToken,
			);
			setPlaylists(data);
			setPlaylistsState("ready");
		} catch {
			setPlaylists([]);
			setPlaylistsState("error");
		}
	}, [session]);

	const openMenu = () => {
		if (!track || !session) return;
		const rect = buttonRef.current?.getBoundingClientRect();
		const flipUp = Boolean(rect
			&& rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight
			&& rect.top > MENU_ESTIMATED_HEIGHT);
		const submenuLeft = Boolean(rect && rect.right + 190 > window.innerWidth);
		const style = rect
			? {
				...(flipUp
					? { bottom: window.innerHeight - rect.top + 4 }
					: { top: rect.bottom + 4 }),
				...(align === "right"
					? { right: window.innerWidth - rect.right }
					: { left: rect.left }),
			}
			: { top: 8, right: 8 };
		setPlacement({ style, flipUp, submenuLeft });
		setOpenSubmenu(null);
		setIsOpen(true);
		loadPlaylists();
	};

	// Escape closes the menu (and any open submenu) without navigating.
	useEffect(() => {
		if (!isOpen) return undefined;
		const handleKeyDown = (event) => {
			if (event.key === "Escape") {
				closeMenu();
				event.stopPropagation();
			}
		};
		document.addEventListener("keydown", handleKeyDown, true);
		return () => document.removeEventListener("keydown", handleKeyDown, true);
	}, [isOpen, closeMenu]);

	// The portal-rendered menu is detached from the trigger, so scrolling or
	// resizing while it is open would leave it floating over the wrong spot.
	// Close on any scroll — except scrolls inside the menu itself (the
	// playlist list is scrollable).
	useEffect(() => {
		if (!isOpen) return undefined;
		const handleScroll = (event) => {
			if (menuRef.current?.contains(event.target instanceof Node ? event.target : null)) return;
			closeMenu();
		};
		// Capture phase so scrolls inside nested overflow containers are
		// caught too.
		document.addEventListener("scroll", handleScroll, true);
		window.addEventListener("resize", closeMenu);
		return () => {
			document.removeEventListener("scroll", handleScroll, true);
			window.removeEventListener("resize", closeMenu);
		};
	}, [isOpen, closeMenu]);

	if (!track) return null;

	const albumLink = getTrackAlbumLink(track);
	const artistLink = getTrackArtistLink(track);
	// Artist routes only resolve real Jellyfin ids; a name-derived virtual
	// artist (id === null) has no page to navigate to.
	const canOpenArtist = Boolean(artistLink && /^[0-9a-f]{32}$/i.test(artistLink.id || ""));

	const handleToggleFavorite = async () => {
		const next = !isFavorite;
		setIsFavorite(next);
		try {
			await setJellyfinFavorite(
				session.serverUrl,
				session.userId,
				track.id,
				session.accessToken,
				next,
			);
		} catch (error) {
			setIsFavorite(!next);
			toast.error(error?.message || "Could not update favorites");
		}
	};

	const handleAddToPlaylist = (playlist) => {
		toast.promise(
			addToJellyfinPlaylist(session.serverUrl, playlist.id, track.id, session.userId, session.accessToken),
			{
				loading: `Adding to "${playlist.name}"…`,
				success: `Added to "${playlist.name}"`,
				error: (error) => error?.message || `Could not add to "${playlist.name}"`,
			},
		);
	};

	const handleCreatePlaylist = async (name) => {
		await createJellyfinPlaylist(session.serverUrl, session.userId, session.accessToken, name, track.id);
		toast.success(`Created playlist "${name}"`);
	};

	const handleDownload = () => {
		toast.promise(downloadTrackOffline(session, track), {
			loading: `Downloading "${track.title}"…`,
			success: (result) => (result.cached
				? `"${track.title}" is already saved for offline`
				: `Saved "${track.title}" for offline`),
			error: (error) => error?.message || `Could not download "${track.title}"`,
		});
	};

	const trigger = (
		<button
			ref={buttonRef}
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				if (isOpen) closeMenu();
				else openMenu();
			}}
			onKeyDown={(event) => {
				// Enter/Space activate this button and must not bubble into the
				// row's own keyboard handler (which would start playback too).
				if (event.key === "Enter" || event.key === " ") {
					event.stopPropagation();
				}
			}}
			title="Track options"
			aria-label="Track options"
			aria-expanded={isOpen}
			className={`p-0.5 text-zinc-400 hover:text-white cursor-pointer transition ${className}`}
		>
			<IconDotsVertical size={iconSize} stroke={1.5} />
		</button>
	);

	if (!isOpen) {
		// The dropdown itself only renders while open, but the modals
		// (playlist name / file info) must stay mountable — actions in the
		// menu close the menu first, and the modal lives on after it.
		return (
			<>
				{trigger}
				{playlistModalOpen && (
					<PlaylistNameModal
						title="New Playlist"
						submitLabel="Create"
						onSubmit={handleCreatePlaylist}
						onClose={() => setPlaylistModalOpen(false)}
					/>
				)}
				{fileInfoOpen && (
					<TrackFileInfoModal
						track={track}
						onClose={() => setFileInfoOpen(false)}
					/>
				)}
			</>
		);
	}

	const playItems = [
		{
			key: "now",
			label: "Play Now",
			icon: <IconPlayerPlayFilled size={14} stroke={1.8} />,
			run: () => playNow(track),
		},
		{
			key: "next",
			label: "Play Next",
			icon: <IconPlayerTrackNext size={14} stroke={1.8} />,
			run: () => playNext(track),
		},
		{
			key: "last",
			label: "Play Last",
			icon: <IconArrowBarToDown size={14} stroke={1.8} />,
			run: () => playLast(track),
		},
	];

	// Flush against the menu on purpose: any hover gap between menu and
	// submenu would fire the menu's mouseleave and close the submenu while
	// the cursor crosses it. Vertical side mirrors the menu's own flip.
	const submenuSide = placement.submenuLeft ? "right-full" : "left-full";
	const submenuVertical = placement.flipUp ? "bottom-0" : "top-0";

	return (
		<>
			{trigger}
			{createPortal(
				<>
					{/* Click-away layer sits above the page but below the menu */}
					<div className="fixed inset-0 z-40" onClick={closeMenu} />
					<div
						ref={menuRef}
						style={placement.style}
						className={`fixed z-50 ${MENU_WIDTH} rounded-xs border border-[#2b2b36] bg-[#18181f] py-1 shadow-xl`}
						onMouseLeave={() => setOpenSubmenu(null)}
					>
						{/* Play ▸ Play Now / Play Next / Play Last */}
						<div className="relative">
							<button
								type="button"
								onMouseEnter={() => setOpenSubmenu("play")}
								onClick={() => setOpenSubmenu((current) => (current === "play" ? null : "play"))}
								className={itemClass}
							>
								<IconPlayerPlayFilled size={14} stroke={1.8} />
								<span className="flex-1">Play</span>
								<IconChevronRight size={12} stroke={2} className="text-zinc-500" />
							</button>
							{openSubmenu === "play" && (
								<div
									className={`absolute z-50 ${submenuVertical} ${submenuSide} ${SUBMENU_WIDTH} rounded-xs border border-[#2b2b36] bg-[#18181f] py-1 shadow-xl`}
								>
									{playItems.map((playItem) => (
										<button
											key={playItem.key}
											type="button"
											onMouseEnter={() => setOpenSubmenu("play")}
											onClick={() => {
												closeMenu();
												playItem.run();
											}}
											className={submenuItemClass}
										>
											{playItem.icon}
											{playItem.label}
										</button>
									))}
								</div>
							)}
						</div>

						{/* Add to Queue (appends to the end of the queue) */}
						<button
							type="button"
							onMouseEnter={() => setOpenSubmenu(null)}
							onClick={() => {
								closeMenu();
								addToQueue(track);
							}}
							className={itemClass}
						>
							<IconPlaylistAdd size={14} stroke={1.8} />
							Add to Queue
						</button>

						{/* Add to Playlist ▸ Jellyfin playlists */}
						<div className="relative">
							<button
								type="button"
								onMouseEnter={() => setOpenSubmenu("playlist")}
								onClick={() => setOpenSubmenu((current) => (current === "playlist" ? null : "playlist"))}
								className={itemClass}
							>
								<IconPlus size={14} stroke={1.8} />
								<span className="flex-1">Add to Playlist</span>
								<IconChevronRight size={12} stroke={2} className="text-zinc-500" />
							</button>
							{openSubmenu === "playlist" && (
								<div
									className={`absolute z-50 ${submenuVertical} ${submenuSide} ${SUBMENU_WIDTH} rounded-xs border border-[#2b2b36] bg-[#18181f] py-1 shadow-xl`}
								>
									<PlaylistSubmenuContent
										playlists={playlists}
										isLoading={playlistsState === "loading"}
										error={playlistsState === "error" ? "Could not load playlists" : ""}
										onPick={handleAddToPlaylist}
										onNew={() => setPlaylistModalOpen(true)}
										onClose={closeMenu}
									/>
								</div>
							)}
						</div>

						<div className="my-1 border-t border-[#2b2b36]" />

						{/* Favorite (toggles the server-side favorite flag) */}
						<button
							type="button"
							onMouseEnter={() => setOpenSubmenu(null)}
							onClick={handleToggleFavorite}
							className={itemClass}
						>
							{isFavorite
								? <IconHeartFilled size={14} className="text-red-500" />
								: <IconHeart size={14} stroke={1.8} />}
							{isFavorite ? "Remove Favorite" : "Favorite"}
						</button>

						{/* Download / Downloaded (via the Rust download command) */}
						<button
							type="button"
							onMouseEnter={() => setOpenSubmenu(null)}
							onClick={() => {
								closeMenu();
								handleDownload();
							}}
							title={isDownloaded ? "Saved for offline" : "Save for offline"}
							className={itemClass}
						>
							{isDownloaded
								? <IconCircleCheckFilled size={14} className="text-blue-500" />
								: <IconDownload size={14} stroke={1.8} />}
							{isDownloaded ? "Downloaded" : "Download"}
						</button>

						<div className="my-1 border-t border-[#2b2b36]" />

						{/* Go to Album (virtual album ids are supported) */}
						<button
							type="button"
							onMouseEnter={() => setOpenSubmenu(null)}
							onClick={() => {
								if (!albumLink) return;
								closeMenu();
								navigate(`/albums/${albumLink.id}`, { state: { title: track.album || albumLink.title } });
							}}
							title={albumLink ? "View album" : "No album information"}
							className={albumLink ? itemClass : disabledItemClass}
							disabled={!albumLink}
						>
							<IconDisc size={14} stroke={1.8} />
							Go to Album
						</button>

						{/* Go to Artist (only when a real artist entity exists) */}
						<button
							type="button"
							onMouseEnter={() => setOpenSubmenu(null)}
							onClick={() => {
								if (!canOpenArtist) return;
								closeMenu();
								navigate(`/artists/${artistLink.id}`, { state: { title: artistLink.name } });
							}}
							title={canOpenArtist ? "View artist" : "No artist page for this track"}
							className={canOpenArtist ? itemClass : disabledItemClass}
							disabled={!canOpenArtist}
						>
							<IconMusic size={14} stroke={1.8} />
							Go to Artist
						</button>

						{/* File Info (fetched fresh from Jellyfin on demand) */}
						<button
							type="button"
							onMouseEnter={() => setOpenSubmenu(null)}
							onClick={() => {
								closeMenu();
								setFileInfoOpen(true);
							}}
							className={itemClass}
						>
							<IconInfoCircle size={14} stroke={1.8} />
							File Info
						</button>
					</div>
				</>,
				document.body,
			)}
		</>
	);
}
