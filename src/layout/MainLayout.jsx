import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import BottomPlayerBar from "./BottomPlayerBar";

export default function MainLayout() {
	return (
		<div className="flex h-full w-full flex-col bg-[#0c0c0e] text-zinc-100">
			{/* Main Layout Area */}
			<div className="flex flex-1 overflow-hidden">
				{/* Persistent Sidebar */}
				<Sidebar />

				{/* Scrollable Page Content */}
				<main className="flex-1 overflow-y-auto bg-[#0a0a0d] p-7 pt-0">
					<Outlet />
				</main>
			</div>

			{/* Persistent Bottom Player Bar */}
			<BottomPlayerBar
				onTrackOptions={() => console.log("Track options clicked")}
			/>
		</div>
	);
}

