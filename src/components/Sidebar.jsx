import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
	IconList,
	IconServer,
	IconRefresh,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import ServerDropdown from "./ServerDropdown";

function Sidebar() {
	const location = useLocation();
	const navigate = useNavigate();
	const [libraryOpen, setLibraryOpen] = useState(true);
	const { isAuthenticated, session, openServerModal, syncLibrary, isSyncingLibrary, isOffline } = useJellyfin();

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
			<div className="flex flex-1 flex-col overflow-y-auto p-3 space-y-3">
				{/* Active Jellyfin server switcher */}
				<ServerDropdown />

				{/* My Library group */}
				<div>
					<button
						type="button"
						onClick={() => setLibraryOpen(!libraryOpen)}
						className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold tracking-tight text-zinc-400 hover:text-zinc-200 cursor-pointer"
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
												: "text-zinc-300 hover:bg-[#1a1a22] hover:text-white"
											}`}
									>
										<Icon
											size={14}
											stroke={1.8}
											className={
												isActive
													? "text-blue-500"
													: "text-zinc-400 group-hover:text-zinc-200"
											}
										/>
										<span>{item.label}</span>
									</button>
								);
							})}
						</nav>
					)}
				</div>

				{/* Playlists Section */}
				<div>
					<div className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold tracking-tight text-zinc-400">
						<span>Playlists</span>
						<div className="flex items-center gap-1">
							<button
								type="button"
								aria-label="Add Playlist"
								className="rounded-xs p-0.5 text-zinc-400 hover:bg-[#1a1a22] hover:text-zinc-200"
							>
								<IconPlus size={13} stroke={2} />
							</button>
							<button
								type="button"
								aria-label="Playlist Options"
								className="rounded-xs p-0.5 text-zinc-400 hover:bg-[#1a1a22] hover:text-zinc-200"
							>
								<IconList size={13} stroke={2} />
							</button>
						</div>
					</div>
				</div>
			</div>

			{/* Bottom Jellyfin Server Connection Bar */}
			{/* <div className="border-t border-[#1b1b22] bg-[#0c0c0f] p-2.5">
				<div className={`flex w-full items-center gap-1 rounded-xs border p-1 transition ${isAuthenticated
						? "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-zinc-200"
						: "border-zinc-800 bg-[#141419] hover:bg-[#1c1c24] text-zinc-300"
						}`}
				>
					<button
						type="button"
						onClick={openServerModal}
						className="flex min-w-0 flex-1 items-center justify-between rounded-xs p-1.5 text-left"
					>
						<div className="flex min-w-0 items-center gap-2">
							<IconServer
								size={15}
								className={isAuthenticated ? "shrink-0 text-emerald-400" : "shrink-0 text-zinc-400"}
							/>
							<div className="flex min-w-0 flex-col">
								<span className="truncate text-xs font-medium">
									{isAuthenticated ? (session?.serverName || "Jellyfin") : "Connect Server"}
								</span>
								<span className="truncate text-[10px] text-zinc-500">
									{isAuthenticated ? (isOffline ? "Offline — cached data" : session?.username) : "Jellyfin audio"}
								</span>
							</div>
						</div>

						<span
							className={`ml-1.5 h-2 w-2 shrink-0 rounded-full ${isOffline
									? "bg-amber-500 shadow-sm shadow-amber-500/50"
									: isAuthenticated
										? "bg-emerald-500 shadow-sm shadow-emerald-500/50"
										: "bg-zinc-600"
								}`}
						/>
					</button>
					{isAuthenticated && (
						<button
							type="button"
							onClick={syncLibrary}
							disabled={isSyncingLibrary}
							title="Sync Library"
							aria-label="Sync Library"
							className="shrink-0 rounded-xs p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							<IconRefresh size={14} className={isSyncingLibrary ? "animate-spin" : ""} />
						</button>
					)}
				</div>
			</div> */}
		</aside>
	);
}

export default Sidebar;