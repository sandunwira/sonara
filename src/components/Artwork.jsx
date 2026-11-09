import { useState } from "react";
import { IconMusic } from "@tabler/icons-react";

export default function Artwork({
	src,
	alt = "",
	className,
	loading = "lazy",
}) {
	const [failedSrc, setFailedSrc] = useState(null);

	if (!src || failedSrc === src) {
		return (
			<div
				className={`flex items-center justify-center bg-[#18181f] ${className || ""}`}
				role={alt ? "img" : undefined}
				aria-label={alt || undefined}
				aria-hidden={alt ? undefined : true}
			>
				<IconMusic className="h-1/2 w-1/2 text-zinc-500" stroke={1.5} />
			</div>
		);
	}

	return (
		<img
			src={src}
			alt={alt}
			loading={loading}
			decoding="async"
			onError={() => setFailedSrc(src)}
			className={className}
		/>
	);
}
