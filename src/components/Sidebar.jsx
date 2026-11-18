import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
	IconChevronDown,
	IconHome,
	IconHeart,
	IconDisc,
	IconMusic,
	IconUser,
	IconTag,
	IconFolder,
	IconPlus,
	IconPlaylist,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { createJellyfinPlaylist, fetchJellyfinPlaylists } from "../services/jellyfin";
import PlaylistNameModal from "./modals/PlaylistNameModal";
import PlaylistOptionsMenu from "./PlaylistOptionsMenu";
import ServerDropdown from "./ServerDropdown";

function Sidebar() {
	const location = useLocation();
	const navigate = useNavigate();
	const [libraryOpen, setLibraryOpen] = useState(true);
	const [playlistsOpen, setPlaylistsOpen] = useState(true);
	const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
	// Real playlists come from Jellyfin (created/stored server-side). The
	// list refetches on connect, after a manual library sync (libraryVersion
	// bump) and right after a playlist is created below.
	const [playlists, setPlaylists] = useState([]);
	const { isAuthenticated, session, openServerModal, syncLibrary, isSyncingLibrary, isOffline, bumpLibraryVersion } = useJellyfin();

	useEffect(() => {
		if (!isAuthenticated || !session) {
			setPlaylists([]);
			return undefined;
		}
		let cancelled = false;
		fetchJellyfinPlaylists(session.serverUrl, session.userId, session.accessToken)
			.then((data) => {
				if (!cancelled) setPlaylists(data);
			})
			.catch(() => {
				// A failed sidebar refresh just keeps the current list; the
				// toast/inline errors live on the pages that need them.
				if (!cancelled) setPlaylists([]);
			});
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated, session, bumpLibraryVersion]);

	const navItems = [
		{ id: "home", label: "Home", icon: IconHome, path: "/" },
		{ id: "favorites", label: "Favourites", icon: IconHeart, path: "/favorites" },
		{ id: "albums", label: "Albums", icon: IconDisc, path: "/albums" },
		{ id: "tracks", label: "Tracks", icon: IconMusic, path: "/tracks" },
		{ id: "artists", label: "Artists", icon: IconUser, path: "/artists" },
		{ id: "genres", label: "Genres", icon: IconTag, path: "/genres" },
		{ id: "folders", label: "Folders", icon: IconFolder, path: "/folders" },
	];

	const handleNavClick = (path) => {
		if (path) {
			navigate(path);
		}
	};

	return (
		<aside className="flex h-full w-55 shrink-0 flex-col justify-between border-r border-[#1b1b22] bg-[#0d0d10] text-zinc-300">
			{/* Top nav scrollable section */}
			<div className="flex flex-1 flex-col overflow-y-auto overscroll-none px-2 py-1.5 space-y-3">
				{/* Active Jellyfin server switcher */}
				<ServerDropdown />

				{/* My Library group */}
				<div>
					<button
						type="button"
						onClick={() => setLibraryOpen(!libraryOpen)}
						className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-normal font-display tracking-tight text-zinc-300 hover:text-zinc-50 cursor-pointer"
					>
						<span>My Library</span>
						<IconChevronDown
							size={13}
							className={`transition-transform duration-200 ${libraryOpen ? "-rotate-180" : "rotate-0"
								}`}
						/>
					</button>

					{libraryOpen && (
						<nav className="mt-1 flex flex-col space-y-0.5">
							{navItems.map((item) => {
								const Icon = item.icon;
								const isActive =
									location.pathname === item.path ||
									location.pathname.startsWith(`${item.path}/`) ||
									(item.path === "/" && location.pathname === "");
								return (
									<button
										key={item.id}
										type="button"
										onClick={() => handleNavClick(item.path)}
										className={`group flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-xs font-medium transition cursor-pointer ${isActive
											? "text-blue-500 font-semibold hover:bg-[#1a1a22]"
											: "text-zinc-300 hover:bg-[#1a1a22] hover:text-zinc-50"
											}`}
									>
										<Icon
											size={14}
											stroke={1.8}
											className={
												isActive
													? "text-blue-500"
													: "text-zinc-300 group-hover:text-zinc-50"
											}
										/>
										<span>{item.label}</span>
									</button>
								);
							})}
						</nav>
					)}
				</div>

				{/* Playlists group */}
				<div>
					<button
						type="button"
						onClick={() => setPlaylistsOpen(!playlistsOpen)}
						className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-normal font-display tracking-tight text-zinc-300 hover:text-zinc-50 cursor-pointer"
					>
						<span>Playlists</span>
						<div className="flex items-center gap-2">
							{/* Clickable span (not a nested button) that stops
								propagation so the create-playlist modal opens
								without toggling the collapsible. */}
							<span
								role="button"
								tabIndex={0}
								aria-label="Create playlist"
								onClick={(event) => {
									event.stopPropagation();
									if (!session) {
										toast.error("Connect to a server first");
										return;
									}
									setIsCreatePlaylistOpen(true);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										event.stopPropagation();
										if (session) setIsCreatePlaylistOpen(true);
									}
								}}
								className="cursor-pointer rounded-xs text-zinc-300 hover:text-zinc-50 focus:outline-none focus-visible:text-zinc-50"
							>
								<IconPlus size={13} />
							</span>
							<IconChevronDown
								size={13}
								className={`transition-transform duration-200 ${playlistsOpen ? "-rotate-180" : "rotate-0"
									}`}
							/>
						</div>
					</button>

					{playlistsOpen && (
						<nav className="mt-1 flex flex-col space-y-0.5">
							{playlists.map((playlist) => {
								const path = `/playlists/${playlist.id}`;
								const isActive =
									location.pathname === path ||
									location.pathname.startsWith(`${path}/`);
								return (
									<button
										key={playlist.id}
										type="button"
										onClick={() => handleNavClick(path)}
										className={`group flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-xs font-medium transition cursor-pointer ${isActive
											? "text-blue-500 font-semibold hover:bg-[#1a1a22]"
											: "text-zinc-300 hover:bg-[#1a1a22] hover:text-white"
											}`}
									>
										<div className="flex flex-row items-center flex-1 gap-2.5">
											<IconPlaylist
												size={14}
												stroke={1.8}
												className={
													isActive
														? "text-blue-500"
														: "text-zinc-400 group-hover:text-zinc-200"
												}
											/>
											<span className="block truncate">{playlist.name}</span>
										</div>
										<PlaylistOptionsMenu playlist={playlist} />
									</button>
								);
							})}
						</nav>
					)}
				</div>
			</div>

			{/* Create-playlist modal (opened from the Playlists header plus
				icon); stored server-side like every other Jellyfin playlist. */}
			{isCreatePlaylistOpen && (
				<PlaylistNameModal
					title="New Playlist"
					submitLabel="Create"
					onClose={() => setIsCreatePlaylistOpen(false)}
					onSubmit={async (name) => {
						await createJellyfinPlaylist(
							session.serverUrl,
							session.userId,
							session.accessToken,
							name,
						);
						// The playlist fetch effect listens for libraryVersion,
						// so bumping it refetches the sidebar list immediately.
						bumpLibraryVersion();
						toast.success(`Playlist "${name}" created`);
					}}
				/>
			)}
		</aside>
	);
}

export default Sidebar;