import { useEffect, useRef, useState } from "react";
import {
	IconAntennaBars5,
	IconChevronDown,
	IconPencil,
	IconPlus,
	IconServer,
	IconTrash,
} from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { normalizeServerUrl } from "../services/jellyfinCache";

const CONNECTION_STATUS_META = {
	ok: { label: "Connected to Jellyfin", className: "text-emerald-500" },
	weak: { label: "Weak connection to Jellyfin", className: "text-amber-500" },
	offline: { label: "Offline — Jellyfin server unreachable", className: "text-zinc-600" },
	checking: { label: "Checking connection", className: "text-zinc-500" },
};

// Small signal indicator, shown on the active server row. Colors track the
// connection state: green healthy, amber weak, gray offline.
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

// A collapsible header row and nav-style entries (active = blue/semibold,
// hover = #1a1a22). The active server row shows the connection status icon.
function ServerDropdown() {
	const { isAuthenticated, session, servers, switchServer, removeServer, openServerModal, openEditServerModal } = useJellyfin();
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef(null);

	useEffect(() => {
		if (!isOpen) return undefined;
		const handlePointerDown = (event) => {
			if (containerRef.current && !containerRef.current.contains(event.target)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [isOpen]);

	const activeServerUrl = isAuthenticated ? normalizeServerUrl(session?.serverUrl) : null;
	const activeServer = servers.find(
		(server) => normalizeServerUrl(server.serverUrl) === activeServerUrl,
	);

	const handleSelect = (server) => {
		setIsOpen(false);
		if (normalizeServerUrl(server.serverUrl) === activeServerUrl) return;
		switchServer(server.serverUrl);
	};

	const handleRemove = (server, event) => {
		event.stopPropagation();
		removeServer(server.serverUrl);
	};

	const handleAddServer = () => {
		setIsOpen(false);
		openServerModal();
	};

	return (
		<div ref={containerRef}>
			{/* Group header */}
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				aria-label="Toggle saved servers"
				className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold tracking-tight text-zinc-400 hover:text-zinc-200 cursor-pointer"
			>
				<span>Servers</span>
				<IconChevronDown
					size={13}
					className={`shrink-0 transition-transform duration-200 ${isOpen ? "-rotate-180" : "rotate-0"
						}`}
				/>
			</button>

			{/* The list is always rendered: collapsed it shows just the selected
			    server; expanded it shows every saved server. */}
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
						return (
							<div key={server.serverUrl} className="group relative flex w-full items-center">
								<button
									type="button"
									onClick={() => handleSelect(server)}
									disabled={isActive}
									className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xs px-2 py-1.5 text-xs font-medium transition cursor-pointer ${isActive
											? "text-blue-500 font-semibold hover:bg-[#1a1a22]"
											: "text-zinc-300 hover:bg-[#1a1a22] hover:text-white"
										}`}
								>
									{isActive ? (
										<ConnectionStatusIcon />
									) : (
										<IconServer
											size={14}
											stroke={1.8}
											className="shrink-0 text-zinc-400 group-hover:text-zinc-200"
										/>
									)}
									<span className="truncate">{server.serverName || server.serverUrl}</span>
								</button>
								<button
									type="button"
									aria-label={`Edit ${server.serverName || server.serverUrl}`}
									title="Edit server name and address"
									onClick={(event) => {
										event.stopPropagation();
										openEditServerModal(server);
									}}
									className="absolute right-7 rounded-xs p-1 text-zinc-500 opacity-0 transition hover:bg-white/5 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
								>
									<IconPencil size={12} />
								</button>
								<button
									type="button"
									aria-label={`Remove ${server.serverName || server.serverUrl}`}
									title="Remove server from Sonara"
									onClick={(event) => handleRemove(server, event)}
									className="absolute right-1 rounded-xs p-1 text-zinc-500 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
								>
									<IconTrash size={12} />
								</button>
							</div>
						);
					});
				})()}

				{/* Add Server entry (only while expanded) */}
				{isOpen && (
					<button
						type="button"
						onClick={handleAddServer}
						className="group flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-xs font-medium text-zinc-300 transition cursor-pointer hover:bg-[#1a1a22] hover:text-white"
					>
						<IconPlus
							size={14}
							stroke={1.8}
							className="shrink-0 text-zinc-400 group-hover:text-zinc-200"
						/>
						<span>Add Server</span>
					</button>
				)}
			</nav>
		</div>
	);
}

export default ServerDropdown;
