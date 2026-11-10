import { useEffect, useState } from 'react';
import { Window } from '@tauri-apps/api/window';
import {
	IconMinus,
	IconSquare,
	IconX,
	IconAntennaBars5,
} from "@tabler/icons-react";
import { usePlayer } from '../context/PlayerContext';
import { useJellyfin } from '../context/JellyfinContext';

const appWindow = Window.getCurrent();

const CONNECTION_STATUS_META = {
	ok: { label: "Connected to Jellyfin", text: "Connected", className: "text-emerald-500" },
	weak: { label: "Weak connection to Jellyfin", text: "Weak", className: "text-amber-500" },
	offline: { label: "Offline - Jellyfin server unreachable", text: "Offline", className: "text-zinc-600" },
	checking: { label: "Checking connection", text: "Connecting", className: "text-zinc-500" },
};

// Small wifi indicator to the left of the window action buttons. Green is
// shown for 5 seconds after the connection becomes healthy and then fades
// out; weak/offline states stay visible until the connection is fixed.
function ConnectionIndicator() {
	const { connectionStatus } = useJellyfin();
	const [isGreenVisible, setIsGreenVisible] = useState(true);

	useEffect(() => {
		if (connectionStatus !== "ok") {
			setIsGreenVisible(true);
			return undefined;
		}
		setIsGreenVisible(true);
		const timer = setTimeout(() => setIsGreenVisible(false), 5000);
		return () => clearTimeout(timer);
	}, [connectionStatus]);

	const meta = CONNECTION_STATUS_META[connectionStatus] || CONNECTION_STATUS_META.offline;
	// The element stays mounted so state changes fade smoothly instead of
	// popping (a healthy connection fades out and collapses after 5 seconds).
	const isHidden = connectionStatus === "ok" && !isGreenVisible;

	return (
		<span
			title={meta.label}
			aria-label={meta.label}
			aria-hidden={isHidden}
			className={`h-full flex items-center justify-center gap-1 no-drag transition-all duration-300 ease-out ${meta.className} ${
				isHidden
					? "opacity-0 px-0 max-w-0 overflow-hidden pointer-events-none"
					: "opacity-100 px-1.5 max-w-40"
			}`}
		>
			<IconAntennaBars5 size={13} stroke={1.8} />
			<span className="text-[10px] font-medium whitespace-nowrap overflow-hidden">{meta.text}</span>
		</span>
	);
}

function TitleBar({ title }) {
	const { title: playerTitle } = usePlayer();
	const displayTitle = title || playerTitle || 'Sonara';

	useEffect(() => {
		if (displayTitle) {
			document.title = displayTitle;
			try {
				appWindow.setTitle(displayTitle);
			} catch (e) {
				// Safely ignore if not supported in dev/browser
			}
		}
	}, [displayTitle]);

	const handleMinimize = () => {
		appWindow.minimize();
	};

	const handleMaximize = () => {
		appWindow.toggleMaximize();
	};

	const handleClose = () => {
		appWindow.close();
	};

	return (
		<div className="flex h-7 bg-zinc-950 select-none drag-region z-10000 border-b border-white/10">
			<div className="block h-7 w-[calc(100%-160px)] fixed top-0 left-0" data-tauri-drag-region></div>
			<div className="flex items-center justify-between h-full w-full">
				{/* App Title */}
				<div className="flex flex-row items-center gap-1.5 pl-2 overflow-hidden">
					<img
						src="/logos/logo-filled.png"
						className="h-3.5 w-3.5 object-center object-contain"
						alt="Sonara logo"
					/>
					<span className="text-xs font-semibold text-zinc-300 truncate max-w-[calc(100vw-200px)]">
						{displayTitle}
					</span>
				</div>

				{/* Window Controls */}
				<div className="flex h-full text-white">
					<ConnectionIndicator />
					<button
						type="button"
						onClick={handleMinimize}
						aria-label="Minimize"
						title="Minimize"
						className="h-full w-10 flex items-center justify-center bg-transparent hover:bg-white/10 focus:outline-none no-drag"
					>
						<IconMinus size={13} stroke={2} />
					</button>

					<button
						type="button"
						onClick={handleMaximize}
						aria-label="Toggle Maximize"
						title="Toggle Maximize"
						className="h-full w-10 flex items-center justify-center bg-transparent hover:bg-white/10 focus:outline-none no-drag"
					>
						<IconSquare size={10} stroke={2} />
					</button>

					<button
						type="button"
						onClick={handleClose}
						aria-label="Close"
						title="Close"
						className="h-full w-10 flex items-center justify-center bg-transparent hover:bg-red-600/50 focus:outline-none no-drag"
					>
						<IconX size={13} stroke={2} />
					</button>
				</div>
			</div>
		</div>
	);
}

export default TitleBar;