import { useEffect } from 'react';
import { Window } from '@tauri-apps/api/window';
import {
	IconMinus,
	IconSquare,
	IconX,
} from "@tabler/icons-react";
import { usePlayer } from '../context/PlayerContext';

const appWindow = Window.getCurrent();

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
				<div className="flex flex-row items-center gap-2 pl-2 overflow-hidden">
					<img
						src="/tauri.svg"
						className="h-2.5 w-2.5 shrink-0"
						alt="Sonara logo"
					/>
					<span className="text-xs font-semibold text-zinc-300 truncate max-w-[calc(100vw-200px)]">
						{displayTitle}
					</span>
				</div>

				{/* Window Controls */}
				<div className="flex h-full text-white">
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