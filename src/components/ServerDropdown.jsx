import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	IconAntennaBars5,
	IconChevronDown,
	IconDotsVertical,
	IconEdit,
	IconPlus,
	IconRefresh,
	IconServer,
	IconTrash,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { normalizeServerUrl } from "../services/jellyfinCache";

const CONNECTION_STATUS_META = {
	ok: { label: "Connected to Jellyfin", className: "text-emerald-500" },
	weak: { label: "Weak connection to Jellyfin", className: "text-amber-500" },
	offline: { label: "Offline - Jellyfin server unreachable", className: "text-zinc-600" },
	checking: { label: "Checking connection", className: "text-zinc-500" },
};

// Menu styling mirrors PlaylistOptionsMenu so both sidebar sections look and behave identically (fixed placement next to the trigger, portal, and close on Escape / scroll / resize / click-away).
const MENU_WIDTH = "w-44";
const MENU_ESTIMATED_HEIGHT = 128;

const itemClass = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-zinc-200 transition hover:bg-white/5 hover:text-white cursor-pointer";

// Small signal indicator, shown on the active server row. Colors track the connection state: green healthy, amber weak, gray offline.
function ConnectionStatusIcon() {
	const { connectionStatus } = useJellyfin();

	const meta = CONNECTION_STATUS_META[connectionStatus] || CONNECTION_STATUS_META.offline;

	return (
		<IconAntennaBars5
			size={14}
			stroke={1.8}
			aria-label={meta.label}
			title={meta.label}
			className={`shrink-0 transition-opacity duration-300 ease-out ${meta.className} opacity-100`}
		/>
	);
}

// Collapsible header row and nav-style entries styled like the sidebar's Playlists section: same hover colors, same plus-in-header shortcut and the same per-row ⋮ options menu (portal + placement + scroll-close).
function ServerDropdown() {
	const { isAuthenticated, session, servers, switchServer, removeServer, openServerModal, openEditServerModal, syncLibrary, isSyncingLibrary } = useJellyfin();
	const [isOpen, setIsOpen] = useState(false);
	// Which server's action menu is open + its fixed placement, captured once at open time from the trigger's rect.
	const [rowMenu, setRowMenu] = useState({ serverUrl: null, style: null });
	const containerRef = useRef(null);

	const closeRowMenu = useCallback(() => setRowMenu({ serverUrl: null, style: null }), []);

	useEffect(() => {
		if (!isOpen) return undefined;
		const handlePointerDown = (event) => {
			if (containerRef.current && !containerRef.current.contains(event.target)) {
				setIsOpen(false);
				closeRowMenu();
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [isOpen, closeRowMenu]);

	// The portal-rendered row menu floats free of the sidebar: close on any scroll or resize so it never detaches from its trigger.
	useEffect(() => {
		if (!rowMenu.serverUrl) return undefined;
		const handleScroll = (event) => {
			closeRowMenu();
		};
		document.addEventListener("scroll", handleScroll, true);
		window.addEventListener("resize", closeRowMenu);
		return () => {
			document.removeEventListener("scroll", handleScroll, true);
			document.removeEventListener("resize", closeRowMenu);
		};
	}, [rowMenu.serverUrl, closeRowMenu]);

	const activeServerUrl = isAuthenticated ? normalizeServerUrl(session?.serverUrl) : null;

	const handleSelect = (server) => {
		// Clicking the already-active server is a no-op (the row is never disabled so the ⋮ trigger inside it stays clickable).
		if (normalizeServerUrl(server.serverUrl) === activeServerUrl) return;
		setIsOpen(false);
		closeRowMenu();
		switchServer(server.serverUrl);
	};

	const handleRemove = (server) => {
		closeRowMenu();
		removeServer(server.serverUrl);
	};

	const handleEdit = (server) => {
		closeRowMenu();
		openEditServerModal(server);
	};

	// The action always targets the connected server (the library cache and
	// session belong to it), so it is only offered on the active server row.
	const handleSyncLibrary = () => {
		closeRowMenu();
		syncLibrary();
	};

	const handleAddServer = () => {
		setIsOpen(false);
		closeRowMenu();
		openServerModal();
	};

	const openRowMenu = (server) => {
		const rect = document
			.querySelector(`[data-server-menu-trigger="${server.serverUrl}"]`)
			?.getBoundingClientRect();
		if (!rect) {
			setRowMenu({ serverUrl: server.serverUrl, style: { top: 8, right: 8 } });
			return;
		}
		const flipUp = Boolean(
			rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight
			&& rect.top > MENU_ESTIMATED_HEIGHT,
		);
		setRowMenu({
			serverUrl: server.serverUrl,
			style: {
				...(flipUp
					? { bottom: window.innerHeight - rect.top + 4 }
					: { top: rect.bottom + 4 }),
				right: window.innerWidth - rect.right,
			},
		});
	};

	return (
		<div ref={containerRef}>
			{/* Group header */}
			<button
				type="button"
				onClick={() => {
					setIsOpen(!isOpen);
					closeRowMenu();
				}}
				aria-label="Toggle saved servers"
				className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-normal font-display tracking-tight text-zinc-300 hover:text-zinc-50 cursor-pointer"
			>
				<span>Servers</span>
				<IconChevronDown
					size={13}
					className={`transition-transform duration-200 ${isOpen ? "-rotate-180" : "rotate-0"
						}`}
				/>
			</button>

			{/* The list is always rendered: collapsed it shows just the selected server; expanded it shows every saved server. */}
			<nav className="mt-1 flex flex-col space-y-0.5">
				{(() => {
					const visibleServers = isOpen
						? servers
						: servers.filter(
							(server) => normalizeServerUrl(server.serverUrl) === activeServerUrl,
						);

					if (visibleServers.length === 0) {
						return isOpen ? (
							<p className="px-2 py-1.5 text-xs text-zinc-500">
								No servers saved yet
							</p>
						) : (
							<p className="px-2 py-1.5 text-xs text-zinc-600">
								No server
							</p>
						);
					}

					return visibleServers.map((server) => {
						const isActive = normalizeServerUrl(server.serverUrl) === activeServerUrl;
						const menuOpen = rowMenu.serverUrl === server.serverUrl;
						return (
							<button
								key={server.serverUrl}
								type="button"
								onClick={() => handleSelect(server)}
								className={`group flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-xs font-medium transition cursor-pointer ${isActive
									? "text-blue-500 font-semibold hover:bg-[#1a1a22]"
									: "text-zinc-300 hover:bg-[#1a1a22] hover:text-white"
									}`}
							>
								<span className="flex-1 flex flex-row items-center gap-2.5">
									{isActive ? (
										<ConnectionStatusIcon />
									) : (
										<IconServer
											size={14}
											stroke={1.8}
											className={
												isActive
													? "text-blue-500"
													: "text-zinc-400 group-hover:text-zinc-200"
											}
										/>
									)}
									<span className="block truncate">{server.serverName || server.serverUrl}</span>
								</span>
								{/* Clickable span whose click stops propagation so the actions menu opens without selecting the server. */}
								<span
									role="button"
									tabIndex={0}
									data-server-menu-trigger={server.serverUrl}
									aria-label={`Actions for ${server.serverName || server.serverUrl}`}
									aria-expanded={menuOpen}
									title="Server actions"
									onClick={(event) => {
										event.stopPropagation();
										if (menuOpen) closeRowMenu();
										else openRowMenu(server);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											// Keep the row's own keyboard activation from firing.
											event.preventDefault();
											event.stopPropagation();
											if (menuOpen) closeRowMenu();
											else openRowMenu(server);
										}
									}}
									className="shrink-0 cursor-pointer rounded-xs p-0.5 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:text-white focus:opacity-100 focus:outline-none focus-visible:text-white"
								>
									<IconDotsVertical size={12} stroke={1.8} />
								</span>
							</button>
						);
					});
				})()}

				{/* Add Server entry (only while expanded) */}
				{isOpen && (
					<button
						type="button"
						onClick={handleAddServer}
						className="group flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-xs font-medium text-zinc-600 transition cursor-pointer hover:text-zinc-500"
					>
						<IconPlus
							size={14}
							stroke={1.8}
						/>
						<span>Add Server</span>
					</button>
				)}
			</nav>

			{/* Per-server actions menu - portal, styled like the playlist options menu. Trigger lookup relies on the row keeping its data attribute while the menu is open. */}
			{rowMenu.serverUrl && createPortal(
				<>
					{/* Click-away layer sits above the page but below the menu */}
					<div className="fixed inset-0 z-40" onClick={closeRowMenu} />
					<div
						style={rowMenu.style}
						className={`fixed z-50 ${MENU_WIDTH} rounded-xs border border-[#2b2b36] bg-[#18181f] py-1 shadow-xl`}
					>
						{/* Library sync applies to the connected server's cached
							metadata, so it only appears on the active row. */}
						{normalizeServerUrl(rowMenu.serverUrl) === activeServerUrl && (
							<button
								type="button"
								onClick={handleSyncLibrary}
								disabled={isSyncingLibrary}
								className={`${itemClass} disabled:cursor-not-allowed disabled:opacity-50`}
							>
								<IconRefresh
									size={14}
									stroke={1.8}
									className={isSyncingLibrary ? "animate-spin" : ""}
								/>
								{isSyncingLibrary ? "Syncing…" : "Sync Library"}
							</button>
						)}
						<button
							type="button"
							onClick={() => handleEdit(
								servers.find((server) => server.serverUrl === rowMenu.serverUrl),
							)}
							className={itemClass}
						>
							<IconEdit size={14} stroke={1.8} />
							Edit
						</button>
						<button
							type="button"
							onClick={() => handleRemove(
								servers.find((server) => server.serverUrl === rowMenu.serverUrl),
							)}
							className={`${itemClass} hover:text-red-400`}
						>
							<IconTrash size={14} stroke={1.8} />
							Remove
						</button>
					</div>
				</>,
				document.body,
			)}
		</div>
	);
}

export default ServerDropdown;
