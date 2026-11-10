import { useEffect, useRef, useState } from "react";
import {
	IconAntennaBars5,
	IconCheck,
	IconChevronDown,
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

// Small signal indicator left of the selected server name, always visible.
// Colors track the connection state: green healthy, amber weak, gray offline.
function ConnectionStatusIcon() {
	const { connectionStatus } = useJellyfin();

	const meta = CONNECTION_STATUS_META[connectionStatus] || CONNECTION_STATUS_META.offline;

	return (
		<IconAntennaBars5
			size={15}
			stroke={1.8}
			aria-label={meta.label}
			title={meta.label}
			className={`shrink-0 transition-opacity duration-300 ease-out ${meta.className} opacity-100`}
		/>
	);
}

function ServerDropdown() {
	const { isAuthenticated, session, servers, switchServer, removeServer, openServerModal } = useJellyfin();
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
	const currentServerName = activeServer?.serverName || session?.serverName || "Jellyfin";

	const handleSelect = (server) => {
		setIsOpen(false);
		if (normalizeServerUrl(server.serverUrl) === activeServerUrl) return;
		switchServer(server.serverUrl);
	};

	const handleRemove = (server) => {
		removeServer(server.serverUrl);
	};

	return (
		<div ref={containerRef} className="relative">
			{/* Collapsed: the currently selected server */}
			<button
				type="button"
				onClick={() => setIsOpen((open) => !open)}
				aria-label="Switch Jellyfin server"
				title="Switch Jellyfin server"
				className="flex w-full items-center gap-2 rounded-xs text-left"
			>
				<span className="flex min-w-0 flex-1 items-center gap-1.5">
					<ConnectionStatusIcon />
					<span className="truncate text-xs font-medium text-zinc-100">
						{isAuthenticated ? currentServerName : "No Server"}
					</span>
				</span>
				<IconChevronDown
					size={13}
					stroke={2}
					className={`shrink-0 text-zinc-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{/* Expanded: all saved servers */}
			{isOpen && (
				<div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xs border border-[#2b2b35] bg-[#141419] p-1 shadow-xl shadow-black/60">
					<span className="block px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
						Saved Servers
					</span>

					{servers.length === 0 && (
						<p className="px-2 py-1.5 text-[10px] leading-4 text-zinc-500">
							No servers saved yet. Connect one to add it here.
						</p>
					)}

					<div className="max-h-56 overflow-y-auto">
						{servers.map((server) => {
							const isActive = normalizeServerUrl(server.serverUrl) === activeServerUrl;
							return (
								<div
									key={server.serverUrl}
									className={`group flex items-center rounded-xs ${isActive ? "bg-blue-500/10" : ""}`}
								>
									<button
										type="button"
										onClick={() => handleSelect(server)}
										disabled={isActive}
										className="flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-1.5 text-left transition hover:bg-[#1a1a22] disabled:cursor-default disabled:hover:bg-transparent"
									>
										<span className="truncate text-xs font-medium text-zinc-200">
											{server.serverName || server.serverUrl}
										</span>
										{isActive && <IconCheck size={13} stroke={2.5} className="ml-auto shrink-0 text-blue-500" />}
									</button>
									<button
										type="button"
										aria-label={`Remove ${server.serverName || server.serverUrl}`}
										title="Remove server from Sonara"
										onClick={() => handleRemove(server)}
										className="mr-1 shrink-0 rounded-xs p-1 text-zinc-500 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
									>
										<IconTrash size={12} />
									</button>
								</div>
							);
						})}
					</div>

					<div className="mt-1 border-t border-[#22222b] pt-1">
						<button
							type="button"
							onClick={() => {
								setIsOpen(false);
								openServerModal();
							}}
							className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-zinc-300 transition hover:bg-[#1a1a22] hover:text-white"
						>
							<IconPlus size={14} className="shrink-0" />
							<span className="text-xs font-medium">Add Server</span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

export default ServerDropdown;
