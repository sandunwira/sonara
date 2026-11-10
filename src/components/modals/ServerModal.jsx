import { useState, useEffect } from "react";
import {
	IconServer,
	IconX,
	IconEye,
	IconEyeOff,
	IconLoader2,
	IconCheck,
	IconUnlink,
	IconRefresh,
} from "@tabler/icons-react";
import { useJellyfin } from "../../context/JellyfinContext";

export default function ServerModal() {
	const {
		session,
		isAuthenticated,
		isLoading,
		isServerModalOpen,
		closeServerModal,
		connectServer,
		disconnectServer,
		refreshLibrary,
		isSyncingLibrary,
	} = useJellyfin();

	const [serverUrl, setServerUrl] = useState(session?.serverUrl || "");
	const [username, setUsername] = useState(session?.username || "");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [formError, setFormError] = useState("");

	useEffect(() => {
		if (session) {
			setServerUrl(session.serverUrl || "");
			setUsername(session.username || "");
		}
	}, [session]);

	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.key === "Escape" && isServerModalOpen) {
				closeServerModal();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isServerModalOpen, closeServerModal]);

	if (!isServerModalOpen) return null;

	const handleSubmit = async (e) => {
		e.preventDefault();
		setFormError("");

		if (!serverUrl.trim()) {
			setFormError("Server URL is required");
			return;
		}

		if (!username.trim()) {
			setFormError("Username is required");
			return;
		}

		const result = await connectServer(serverUrl.trim(), username.trim(), password);
		if (!result.success) {
			setFormError(result.error || "Connection failed");
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none animate-in fade-in duration-200">
			<div
				className="relative w-full max-w-md overflow-hidden rounded-xs border border-[#272733] bg-[#121217] p-6 text-zinc-100 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Close Button */}
				{isAuthenticated && (
					<button
						type="button"
						onClick={closeServerModal}
						aria-label="Close"
						className="absolute right-4 top-4 rounded-xs p-1.5 text-zinc-400 transition hover:bg-[#20202b] hover:text-white"
					>
						<IconX size={16} stroke={2} />
					</button>
				)}

				{/* Header */}
				<div className="flex items-center gap-3">
					<div className="flex h-11 w-11 items-center justify-center rounded-xs bg-blue-500/10 border border-blue-500/20 text-blue-400">
						<IconServer size={22} stroke={1.8} />
					</div>
					<div>
						<h2 className="text-base font-semibold text-white">
							Jellyfin Server
						</h2>
						<p className="text-xs text-zinc-400">
							Connect to stream your personal music library
						</p>
					</div>
				</div>

				{/* Content based on authentication status */}
				{isAuthenticated ? (
					<div className="mt-5 space-y-4">
						{/* Active Connection Info */}
						<div className="rounded-xs border border-emerald-500/20 bg-emerald-500/5 p-4">
							<div className="flex items-center gap-2">
								<span className="flex h-2.5 w-2.5 relative">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
									<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
								</span>
								<span className="text-xs font-semibold text-emerald-400">
									Connected
								</span>
							</div>

							<div className="mt-3 space-y-1.5 text-xs">
								<div className="flex justify-between">
									<span className="text-zinc-400">Server:</span>
									<span className="font-medium text-zinc-200">
										{session.serverName || "Jellyfin"}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-zinc-400">URL:</span>
									<span className="font-medium text-zinc-300 truncate max-w-55">
										{session.serverUrl}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-zinc-400">User:</span>
									<span className="font-medium text-zinc-200">
										{session.username}
									</span>
								</div>
								{session.serverVersion && (
									<div className="flex justify-between">
										<span className="text-zinc-400">Version:</span>
										<span className="font-medium text-zinc-300">
											{session.serverVersion}
										</span>
									</div>
								)}
							</div>
						</div>

						{/* Actions */}
						<div className="flex items-center gap-2 pt-2">
							<button
								type="button"
								onClick={() => refreshLibrary()}
								disabled={isLoading || isSyncingLibrary}
								className="flex flex-1 items-center justify-center gap-2 rounded-xs border border-[#2b2b36] bg-[#1a1a23] py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#252533] hover:text-white"
							>
								<IconRefresh size={14} className={isSyncingLibrary ? "animate-spin" : ""} />
								Sync Library
							</button>

							<button
								type="button"
								onClick={disconnectServer}
								className="flex items-center justify-center gap-1.5 rounded-xs border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
							>
								<IconUnlink size={14} />
								Disconnect
							</button>
						</div>
					</div>
				) : (
					/* Connection Form */
					<form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
						{formError && (
							<div className="rounded-xs border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
								{formError}
							</div>
						)}

						{/* Server URL */}
						<div>
							<label className="block text-xs font-medium text-zinc-300 mb-1">
								Server URL
							</label>
							<input
								type="text"
								value={serverUrl}
								onChange={(e) => setServerUrl(e.target.value)}
								placeholder="http://192.168.1.100:8096"
								className="w-full rounded-xs border border-[#2b2b36] bg-[#181820] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
								autoFocus
							/>
							<span className="mt-1 block text-[10px] text-zinc-500">
								Example: http://localhost:8096 or https://jellyfin.myhome.net
							</span>
						</div>

						{/* Username */}
						<div>
							<label className="block text-xs font-medium text-zinc-300 mb-1">
								Username
							</label>
							<input
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="Your Jellyfin username"
								className="w-full rounded-xs border border-[#2b2b36] bg-[#181820] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
							/>
						</div>

						{/* Password */}
						<div>
							<label className="block text-xs font-medium text-zinc-300 mb-1">
								Password
							</label>
							<div className="relative">
								<input
									type={showPassword ? "text" : "password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="••••••••"
									className="w-full rounded-xs border border-[#2b2b36] bg-[#181820] px-3 py-2 pr-9 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
								>
									{showPassword ? <IconEyeOff size={14} /> : <IconEye size={14} />}
								</button>
							</div>
						</div>

						{/* Submit button */}
						<div className="pt-2">
							<button
								type="submit"
								disabled={isLoading}
								className="flex w-full items-center justify-center gap-2 rounded-xs bg-blue-600 py-2.5 text-xs font-medium text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50"
							>
								{isLoading ? (
									<>
										<IconLoader2 size={14} className="animate-spin" />
										Connecting...
									</>
								) : (
									<>
										<IconCheck size={14} stroke={2.5} />
										Connect to Server
									</>
								)}
							</button>
						</div>
					</form>
				)}
			</div>
		</div>
	);
}
