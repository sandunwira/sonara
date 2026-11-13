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
			<div className="flex flex-1 flex-col overflow-y-auto px-2 py-1.5 space-y-3">
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
		</aside>
	);
}

export default Sidebar;