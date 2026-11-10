import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import BottomPlayerBar from "./BottomPlayerBar";
import QueuePanel from "./QueuePanel";

export default function MainLayout() {
	const [isQueuePanelOpen, setIsQueuePanelOpen] = useState(false);

	return (
		<div className="flex h-full w-full flex-col bg-[#0c0c0e] text-zinc-100">
			{/* Main Layout Area */}
			<div className="flex flex-1 overflow-hidden">
				{/* Persistent Sidebar */}
				<Sidebar />

				{/* Scrollable Page Content */}
				<main className="flex-1 overflow-y-auto bg-[#0a0a0d] p-7 pt-0">
					<Outlet context={{ isQueuePanelOpen }} />
				</main>

				{/* Collapsible right panel: now playing preview + queue */}
				<QueuePanel
					isOpen={isQueuePanelOpen}
					onClose={() => setIsQueuePanelOpen(false)}
				/>
			</div>

			{/* Persistent Bottom Player Bar */}
			<BottomPlayerBar
				onTrackOptions={() => console.log("Track options clicked")}
				isQueuePanelOpen={isQueuePanelOpen}
				toggleQueuePanel={() => setIsQueuePanelOpen((open) => !open)}
			/>
		</div>
	);
}
