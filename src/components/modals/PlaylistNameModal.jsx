import { useEffect, useState } from "react";
import { IconLoader2, IconX } from "@tabler/icons-react";

// Small name-prompt modal used when creating a Jellyfin playlist from the
// track options menu. Styling follows ServerModal; the caller provides the
// async `onSubmit(name)` — thrown errors are shown inline, success closes
// the modal (the caller toasts).
export default function PlaylistNameModal({
	title = "New Playlist",
	submitLabel = "Create",
	initialName = "",
	onSubmit,
	onClose,
}) {
	const [name, setName] = useState(initialName);
	const [error, setError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event) => {
			if (event.key === "Escape" && !isSubmitting) onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isSubmitting, onClose]);

	const handleSubmit = async (event) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			setError("Playlist name is required");
			return;
		}
		setError("");
		setIsSubmitting(true);
		try {
			await onSubmit(trimmed);
			onClose();
		} catch (submitError) {
			setError(submitError?.message || "Something went wrong");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none animate-in fade-in duration-200"
			onClick={() => {
				if (!isSubmitting) onClose();
			}}
		>
			<form
				onSubmit={handleSubmit}
				onClick={(event) => event.stopPropagation()}
				className="relative w-full max-w-sm overflow-hidden rounded-xs border border-[#272733] bg-[#121217] p-6 text-zinc-100 shadow-2xl"
			>
				<button
					type="button"
					onClick={onClose}
					disabled={isSubmitting}
					aria-label="Close"
					className="absolute right-4 top-4 rounded-xs p-1.5 text-zinc-400 transition hover:bg-[#20202b] hover:text-white disabled:opacity-40"
				>
					<IconX size={16} stroke={2} />
				</button>

				<h2 className="text-base font-semibold text-white">{title}</h2>
				<p className="mt-0.5 text-xs text-zinc-400">
					Playlists are stored on your Jellyfin server, so they appear on every device.
				</p>

				{error && (
					<div className="mt-3 rounded-xs border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
						{error}
					</div>
				)}

				<div className="mt-4">
					<input
						type="text"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Playlist name"
						maxLength={120}
						autoFocus
						className="w-full rounded-xs border border-[#2b2b36] bg-[#181820] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
					/>
				</div>

				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={isSubmitting}
						className="rounded-xs border border-[#2b2b36] bg-[#1a1a23] px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#252533] hover:text-white disabled:opacity-40"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSubmitting}
						className="flex items-center justify-center gap-2 rounded-xs bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
					>
						{isSubmitting && <IconLoader2 size={14} className="animate-spin" />}
						{submitLabel}
					</button>
				</div>
			</form>
		</div>
	);
}
