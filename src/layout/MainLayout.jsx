import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import BottomPlayerBar from "./BottomPlayerBar";
import NowPlayingPanel from "./NowPlayingPanel";
import QueueManagementPanel from "./QueueManagementPanel";

export default function MainLayout() {
	const [activePanel, setActivePanel] = useState(null);
	const isQueuePanelOpen = activePanel === "queue";
	const isNowPlayingPanelOpen = activePanel === "nowPlaying";
	const isSidePanelOpen = activePanel !== null;

	return (
		<div className="flex h-full w-full flex-col bg-[#0c0c0e] text-zinc-100">
			{/* Main Layout Area */}
			<div className="flex flex-1 overflow-hidden">
				{/* Persistent Sidebar */}
				<Sidebar />

				{/* Scrollable Page Content */}
				<main className="flex-1 overflow-y-auto overscroll-none bg-[#0a0a0d] p-7 pt-0">
					<Outlet context={{ isSidePanelOpen }} />
				</main>

				<NowPlayingPanel
					isOpen={isNowPlayingPanelOpen}
					onClose={() => setActivePanel(null)}
				/>
				<QueueManagementPanel
					isOpen={isQueuePanelOpen}
					onClose={() => setActivePanel(null)}
				/>
			</div>

			{/* Persistent Bottom Player Bar */}
			<BottomPlayerBar
				onTrackOptions={() => console.log("Track options clicked")}
				isQueuePanelOpen={isQueuePanelOpen}
				toggleQueuePanel={() => setActivePanel((active) => active === "queue" ? null : "queue")}
				isNowPlayingPanelOpen={isNowPlayingPanelOpen}
				toggleNowPlayingPanel={() => setActivePanel((active) => active === "nowPlaying" ? null : "nowPlaying")}
			/>
		</div>
	);
}
