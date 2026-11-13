import { useEffect, useState } from "react";
import {
	IconEye,
	IconEyeOff,
	IconLoader2,
	IconServer,
	IconX,
} from "@tabler/icons-react";
import { useJellyfin } from "../../context/JellyfinContext";

// Edit a saved server's display name and address. Saving is delegated to
// updateServer, which verifies the address and migrates or purges cached
// content as appropriate.
export default function EditServerModal() {
	const { editingServer, closeEditServerModal, updateServer } = useJellyfin();

	const [serverName, setServerName] = useState("");
	const [serverUrl, setServerUrl] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [formError, setFormError] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (editingServer) {
			setServerName(editingServer.serverName || "");
			setServerUrl(editingServer.serverUrl || "");
			setUsername(editingServer.username || "");
			setPassword("");
			setShowPassword(false);
			setFormError("");
			setIsSaving(false);
		}
	}, [editingServer]);

	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.key === "Escape" && editingServer) {
				closeEditServerModal();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [editingServer, closeEditServerModal]);

	if (!editingServer) return null;

	const handleSubmit = async (e) => {
		e.preventDefault();
		setFormError("");

		if (!serverUrl.trim()) {
			setFormError("Server address is required");
			return;
		}

		setIsSaving(true);
		const result = await updateServer(editingServer.serverUrl, {
			serverUrl: serverUrl.trim(),
			serverName: serverName.trim(),
			username: username.trim(),
			password,
		});
		setIsSaving(false);

		if (result.success) {
			closeEditServerModal();
		} else {
			setFormError(result.error || "Could not update the server");
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none animate-in fade-in duration-200"
			onClick={closeEditServerModal}
		>
			<div
				className="relative w-full max-w-md overflow-hidden rounded-xs border border-[#272733] bg-[#121217] p-6 text-zinc-100 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					onClick={closeEditServerModal}
					aria-label="Close"
					className="absolute right-4 top-4 rounded-xs p-1.5 text-zinc-400 transition hover:bg-[#20202b] hover:text-white"
				>
					<IconX size={16} stroke={2} />
				</button>

				<div className="flex items-center gap-3">
					<div className="flex h-11 w-11 items-center justify-center rounded-xs bg-blue-500/10 border border-blue-500/20 text-blue-400">
						<IconServer size={22} stroke={1.8} />
					</div>
					<div>
						<h2 className="text-base font-semibold text-white">
							Edit Server
						</h2>
						<p className="text-xs text-zinc-400">
							Rename this server or point it at a new address
						</p>
					</div>
				</div>

				<form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
					{formError && (
						<div className="rounded-xs border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
							{formError}
						</div>
					)}

					<div>
						<label className="block text-xs font-medium text-zinc-300 mb-1">
							Server Name
						</label>
						<input
							type="text"
							value={serverName}
							onChange={(e) => setServerName(e.target.value)}
							placeholder="Home Server"
							className="w-full rounded-xs border border-[#2b2b36] bg-[#181820] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
							autoFocus
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-zinc-300 mb-1">
							Server Address
						</label>
						<input
							type="text"
							value={serverUrl}
							onChange={(e) => setServerUrl(e.target.value)}
							placeholder="http://192.168.1.100:8096"
							className="w-full rounded-xs border border-[#2b2b36] bg-[#181820] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
						/>
						<span className="mt-1 block text-[10px] text-zinc-500">
							Changing the address keeps this server's cached library when it is
							the same Jellyfin server at a new location.
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
						<span className="mt-1 block text-[10px] text-zinc-500">
							Leave blank to keep the current sign-in. Changing the username or
							entering a password signs in again to refresh the account.
						</span>
					</div>

					<div className="flex items-center gap-2 pt-2">
						<button
							type="submit"
							disabled={isSaving}
							className="flex flex-1 items-center justify-center gap-2 rounded-xs bg-blue-600 py-2.5 text-xs font-medium text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50"
						>
							{isSaving ? (
								<>
									<IconLoader2 size={14} className="animate-spin" />
									Verifying...
								</>
							) : (
								<>
									Save Changes
								</>
							)}
						</button>
						<button
							type="button"
							onClick={closeEditServerModal}
							className="rounded-xs border border-[#2b2b36] bg-[#1a1a23] px-4 py-2.5 text-xs font-medium text-zinc-300 transition hover:bg-[#252533] hover:text-white"
						>
							Cancel
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
