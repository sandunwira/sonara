import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { IconDotsVertical, IconEdit, IconTrash } from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { deleteJellyfinItem, renameJellyfinItem } from "../services/jellyfin";
import { invalidateJellyfinPlaylistEntries } from "../services/jellyfinCache";
import PlaylistNameModal from "./modals/PlaylistNameModal";
import ConfirmModal from "./modals/ConfirmModal";

const MENU_WIDTH = "w-44";
// Roughly the tallest the menu gets (2 items); used for the flip-up check.
const MENU_ESTIMATED_HEIGHT = 90;

const itemClass =
	"flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white cursor-pointer";

// Per-playlist options dropdown rendered alongside the sidebar's playlist
// rows: Rename and Delete (with a confirmation modal). Follows the
// TrackOptionsMenu portal pattern — fixed viewport coordinates computed at
// open time, closes on Escape / scroll / resize / click-away. The sidebar
// renders this as a SIBLING of the row's navigation button, so clicks inside
// the portaled menu (including the click-away layer and modals) cannot bubble
// through the React tree into that button and activate the playlist. The
// trigger is a clickable span with explicit keyboard handling rather than a
// second button next to the navigation one.
export default function PlaylistOptionsMenu({ playlist }) {
	const { session, bumpLibraryVersion } = useJellyfin();
	const navigate = useNavigate();
	const location = useLocation();

	const triggerRef = useRef(null);
	const menuRef = useRef(null);
	const [isOpen, setIsOpen] = useState(false);
	const [placement, setPlacement] = useState(null);
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	const closeMenu = useCallback(() => setIsOpen(false), []);

	const openMenu = () => {
		if (!session || !playlist?.id) return;
		const rect = triggerRef.current?.getBoundingClientRect();
		const flipUp = Boolean(rect
			&& rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight
			&& rect.top > MENU_ESTIMATED_HEIGHT);
		setPlacement(rect
			? {
				style: {
					...(flipUp
						? { bottom: window.innerHeight - rect.top + 4 }
						: { top: rect.bottom + 4 }),
					right: window.innerWidth - rect.right,
				},
			}
			: { style: { top: 8, right: 8 } });
		setIsOpen(true);
	};

	// Escape closes the menu without navigating or toggling anything.
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

	// The portal-rendered menu floats free of the sidebar: close on any
	// scroll or resize so it never detaches from its trigger.
	useEffect(() => {
		if (!isOpen) return undefined;
		const handleScroll = (event) => {
			if (menuRef.current?.contains(event.target instanceof Node ? event.target : null)) return;
			closeMenu();
		};
		document.addEventListener("scroll", handleScroll, true);
		window.addEventListener("resize", closeMenu);
		return () => {
			document.removeEventListener("scroll", handleScroll, true);
			window.removeEventListener("resize", closeMenu);
		};
	}, [isOpen, closeMenu]);

	// Mutations change server state the response cache cannot know about:
	// drop the playlist's cached items/detail, then let open pages (sidebar
	// list, playlist detail) refetch fresh data.
	const invalidateAndBump = async () => {
		await invalidateJellyfinPlaylistEntries(playlist.id);
		bumpLibraryVersion();
	};

	const handleRename = async (name) => {
		await renameJellyfinItem(
			session.serverUrl,
			session.userId,
			playlist.id,
			session.accessToken,
			name,
		);
		await invalidateAndBump();
		toast.success(`Renamed to "${name}"`);
	};

	const handleDelete = async () => {
		await deleteJellyfinItem(session.serverUrl, playlist.id, session.accessToken);
		await invalidateAndBump();
		toast.success(`Deleted "${playlist.name}"`);
		// If the deleted playlist's page is open, don't leave the user on a
		// dead route; otherwise stay wherever they are.
		if (location.pathname.startsWith(`/playlists/${playlist.id}`)) {
			navigate("/", { replace: true });
		}
	};

	const trigger = (
		<span
			ref={triggerRef}
			role="button"
			tabIndex={0}
			aria-label="Playlist options"
			aria-expanded={isOpen}
			title="Playlist options"
			onClick={(event) => {
				event.stopPropagation();
				if (isOpen) closeMenu();
				else openMenu();
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					// Keep the row's own keyboard activation from firing.
					event.preventDefault();
					event.stopPropagation();
					if (isOpen) closeMenu();
					else openMenu();
				}
			}}
			className="shrink-0 cursor-pointer rounded-xs p-0.5 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:text-white focus:opacity-100 focus:outline-none focus-visible:text-white"
		>
			<IconDotsVertical size={12} stroke={1.8} />
		</span>
	);

	// The dropdown only renders while open, but the modals must stay
	// mountable — menu actions close the menu first, the modal lives on.
	if (!isOpen) {
		return (
			<>
				{trigger}
				{renameOpen && createPortal(
					<PlaylistNameModal
						title="Rename Playlist"
						submitLabel="Rename"
						initialName={playlist.name}
						onSubmit={handleRename}
						onClose={() => setRenameOpen(false)}
					/>,
					document.body,
				)}
				{deleteOpen && createPortal(
					<ConfirmModal
						title="Delete Playlist"
						message={`Delete "${playlist.name}"? This removes the playlist from your Jellyfin server for every device. Your tracks are not deleted.`}
						confirmLabel="Delete"
						onConfirm={handleDelete}
						onClose={() => setDeleteOpen(false)}
					/>,
					document.body,
				)}
			</>
		);
	}

	return (
		<>
			{trigger}
			{createPortal(
				<>
					{/* Click-away layer sits above the page but below the menu */}
					<div className="fixed inset-0 z-40" onClick={closeMenu} />
					<div
						ref={menuRef}
						style={placement?.style}
						className={`fixed z-50 ${MENU_WIDTH} rounded-xs border border-[#2b2b36] bg-[#18181f] py-1 shadow-xl`}
					>
						<button
							type="button"
							onClick={() => {
								closeMenu();
								setRenameOpen(true);
							}}
							className={itemClass}
						>
							<IconEdit size={14} stroke={1.8} />
							Rename
						</button>
						<button
							type="button"
							onClick={() => {
								closeMenu();
								setDeleteOpen(true);
							}}
							className={`${itemClass} hover:text-red-400`}
						>
							<IconTrash size={14} stroke={1.8} />
							Delete
						</button>
					</div>
				</>,
				document.body,
			)}
		</>
	);
}
