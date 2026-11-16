import { useEffect, useState } from "react";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useJellyfin } from "../../context/JellyfinContext";
import { fetchJellyfinFileInfo } from "../../services/jellyfin";

function formatBytes(bytes) {
	if (!bytes || !Number.isFinite(bytes)) return "";
	if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}

function formatSampleRate(hertz) {
	if (!hertz || !Number.isFinite(hertz)) return "";
	return hertz >= 1000 ? `${(hertz / 1000).toFixed(1)} kHz` : `${hertz} Hz`;
}

function formatChannels(count) {
	if (!count || !Number.isFinite(count)) return "";
	if (count === 1) return "Mono";
	if (count === 2) return "Stereo";
	return `${count} channels`;
}

// File basename across both slash styles, since Jellyfin Path values keep
// the server OS separators.
function fileBaseName(path) {
	if (!path) return "";
	const parts = String(path).split(/[\\/]/);
	return parts[parts.length - 1] || "";
}

// Shows on-demand media details for one track (path, container, size,
// codec, stream properties). Fetched fresh from Jellyfin every time the
// modal opens — the response cache strips `MediaSources`, so it could never
// answer this request.
export default function TrackFileInfoModal({ track, onClose }) {
	const { session } = useJellyfin();
	const [item, setItem] = useState(null);
	const [error, setError] = useState("");
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		if (!track || !session) return undefined;
		let cancelled = false;
		setIsLoading(true);
		setError("");
		(async () => {
			try {
				const data = await fetchJellyfinFileInfo(
					session.serverUrl,
					track.id,
					session.userId,
					session.accessToken,
				);
				if (!cancelled) setItem(data);
			} catch (fetchError) {
				if (!cancelled) setError(fetchError?.message || "Could not load file info");
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [track?.id, session]);

	useEffect(() => {
		const handleKeyDown = (event) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	const source = item?.MediaSources?.[0] || {};
	const audioStream = (source.MediaStreams || []).find((stream) => stream.Type === "Audio") || {};
	const durationSeconds = item?.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : null;

	const rows = [
		["Item ID", item?.Id || track?.id || ""],
		["Title", item?.Name || track?.title || ""],
		["Artist", item?.AlbumArtist || track?.artist || ""],
		["Album", item?.Album || track?.album || ""],
		["File", source.Path],
		["Size", formatBytes(source.Size)],
		["Bitrate", source.Bitrate ? `${Math.round(source.Bitrate / 1000)} kbps` : ""],
		["Codec", audioStream.Codec ? String(audioStream.Codec).toUpperCase() : ""],
		["Sample rate", formatSampleRate(audioStream.SampleRate)],
		["Channels", formatChannels(audioStream.Channels)],
		["Duration", durationSeconds
			? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")}`
			: ""],
	].filter(([, value]) => value !== null && value !== undefined && value !== "");

	return (
		<div
			className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none animate-in fade-in duration-200"
			onClick={onClose}
		>
			<div
				onClick={(event) => event.stopPropagation()}
				className="relative w-full max-w-md overflow-hidden rounded-xs border border-[#272733] bg-[#121217] p-6 text-zinc-100 shadow-2xl"
			>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					className="absolute right-4 top-4 rounded-xs p-1.5 text-zinc-400 transition hover:bg-[#20202b] hover:text-white"
				>
					<IconX size={16} stroke={2} />
				</button>

				<h2 className="text-base font-semibold text-white">File Info</h2>
				<p className="mt-0.5 truncate text-xs text-zinc-400">
					{track?.title || "Track"} — {track?.artist || ""}
				</p>

				{isLoading ? (
					<div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-400">
						<IconLoader2 size={16} className="animate-spin" />
						Loading file details…
					</div>
				) : error ? (
					<div className="mt-4 rounded-xs border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
						{error}
					</div>
				) : (
					<div className="mt-4 max-h-80 overflow-y-auto rounded-xs border border-[#22222a] bg-[#101014]">
						{rows.map(([label, value], index) => (
							<div
								key={label}
								className={`grid grid-cols-[6rem_minmax(0,1fr)] gap-3 px-3 py-2 ${index > 0 ? "border-t border-[#1b1b22]" : ""}`}
							>
								<span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
									{label}
								</span>
								<span className="wrap-break-word text-xs text-zinc-200">{value}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
