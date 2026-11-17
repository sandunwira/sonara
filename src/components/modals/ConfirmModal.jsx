import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";

// Small destructive-action confirmation modal (e.g. deleting a playlist).
// Styling follows PlaylistNameModal; the caller provides the async
// `onConfirm` — thrown errors are shown inline, success closes the modal
// (the caller toasts).
export default function ConfirmModal({
	title,
	message,
	confirmLabel = "Delete",
	onConfirm,
	onClose,
}) {
	const [error, setError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event) => {
			if (event.key === "Escape" && !isSubmitting) onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isSubmitting, onClose]);

	const handleConfirm = async () => {
		setError("");
		setIsSubmitting(true);
		try {
			await onConfirm();
			onClose();
		} catch (confirmError) {
			setError(confirmError?.message || "Something went wrong");
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
			<div
				onClick={(event) => event.stopPropagation()}
				className="relative w-full max-w-sm overflow-hidden rounded-xs border border-[#272733] bg-[#121217] p-6 text-zinc-100 shadow-2xl"
			>
				<h2 className="text-base font-semibold text-white">{title}</h2>
				<p className="mt-2 text-xs text-zinc-400">{message}</p>

				{error && (
					<div className="mt-3 rounded-xs border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
						{error}
					</div>
				)}

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
						type="button"
						onClick={handleConfirm}
						disabled={isSubmitting}
						className="flex items-center justify-center gap-2 rounded-xs bg-red-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
					>
						{isSubmitting && <IconLoader2 size={14} className="animate-spin" />}
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
