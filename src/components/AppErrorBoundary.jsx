import { Component } from "react";
import { Window } from "@tauri-apps/api/window";
import { IconMinus, IconSquare, IconX } from "@tabler/icons-react";
import { recordAppLog } from "../services/jellyfinCache";

const appWindow = Window.getCurrent();

// Dedicated error title bar, independent from the app's contexts/providers - a crash may originate there, so this must not depend on usePlayer/useJellyfin. It keeps the window movable and closable while the error screen is shown.
class ErrorTitleBar extends Component {
	handleMinimize = () => appWindow.minimize();
	handleMaximize = () => appWindow.toggleMaximize();
	handleClose = () => appWindow.close();

	render() {
		return (
			<div className="relative h-7 shrink-0 select-none bg-zinc-950 border-b border-white/10 z-10000">
				{/* Drag region: full title bar except the control buttons */}
				<div
					className="absolute top-0 left-0 h-7 w-[calc(100%-120px)]"
					data-tauri-drag-region
				/>
				<div className="flex h-full w-full items-center justify-between">
					<div className="flex items-center gap-1.5 pl-2 pointer-events-none">
						<img
							src="/logos/logo-filled.png"
							className="h-3.5 w-3.5 object-center object-contain"
							alt="Sonara logo"
						/>
						<span className="text-xs font-semibold text-zinc-400">
							Sonara
						</span>
					</div>
					<div className="flex h-full text-white">
						<button
							type="button"
							onClick={this.handleMinimize}
							aria-label="Minimize"
							title="Minimize"
							className="h-full w-10 flex items-center justify-center bg-transparent hover:bg-white/10 focus:outline-none no-drag"
						>
							<IconMinus size={13} stroke={2} />
						</button>
						<button
							type="button"
							onClick={this.handleMaximize}
							aria-label="Toggle Maximize"
							title="Toggle Maximize"
							className="h-full w-10 flex items-center justify-center bg-transparent hover:bg-white/10 focus:outline-none no-drag"
						>
							<IconSquare size={10} stroke={2} />
						</button>
						<button
							type="button"
							onClick={this.handleClose}
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
}

export default class AppErrorBoundary extends Component {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error, errorInfo) {
		recordAppLog("critical", "react", error.message, {
			stack: error.stack,
			componentStack: errorInfo.componentStack,
		});
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-screen flex-col bg-[#0a0a0d] text-zinc-200">
					<ErrorTitleBar />
					<div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
						<h1 className="text-lg font-semibold">Sonara encountered an error</h1>
						<p className="mt-2 text-sm text-zinc-400">
							The error was saved for troubleshooting. Restart the app to continue.
						</p>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
