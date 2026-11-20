import { useState } from "react";
import { IconMusic } from "@tabler/icons-react";

// Album art with a flash-free fallback. The music-note placeholder is always
// the base layer; the <img> sits on top at opacity 0 and only fades in after
// it has actually loaded. That prevents the browser's broken-image glyph
// from painting for a frame when an item has no artwork (Jellyfin image URLs
// are generated for every track, so a missing image 404s), and it also
// avoids a blank box while a real image is still decoding.
export default function Artwork({
	src,
	alt = "",
	className,
	loading = "lazy",
}) {
	const [failedSrc, setFailedSrc] = useState(null);
	const [loadedSrc, setLoadedSrc] = useState(null);

	const hasImage = Boolean(src) && failedSrc !== src;
	const isLoaded = hasImage && loadedSrc === src;

	return (
		<span
			role={!hasImage && alt ? "img" : undefined}
			aria-label={!hasImage && alt ? alt : undefined}
			aria-hidden={!hasImage && !alt ? true : undefined}
			className={`relative block overflow-hidden bg-[#18181f] ${className || ""}`}
		>
			<span className="pointer-events-none absolute inset-0 flex items-center justify-center">
				<IconMusic className="h-1/2 w-1/2 text-zinc-500" stroke={1.5} />
			</span>
			{hasImage && (
				<img
					src={src}
					alt={alt}
					loading={loading}
					decoding="async"
					onLoad={() => setLoadedSrc(src)}
					onError={() => setFailedSrc(src)}
					className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${isLoaded ? "opacity-100" : "opacity-0"
						}`}
				/>
			)}
		</span>
	);
}
