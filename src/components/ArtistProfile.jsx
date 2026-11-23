import { useEffect, useState } from "react";
import { IconBrandYoutubeFilled, IconChevronDown } from "@tabler/icons-react";
import { toast } from "react-hot-toast";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useJellyfin } from "../context/JellyfinContext";
import {
	fetchArtistProfile,
	getCachedArtistProfile,
	splitArtistNames,
} from "../services/ytmusic";
import { saveArtistProfileImageIfMissing } from "../services/jellyfin";

function uniqueArtistProfiles(entries) {
	const seen = new Set();
	return entries.filter(({ name, profile }) => {
		const channel = String(profile.channelId || profile.profileUrl || "").trim().toLowerCase();
		const artistName = String(profile.name || name || "")
			.trim()
			.toLowerCase()
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "");
		const key = channel ? `channel:${channel}` : `name:${artistName}`;
		if ((!artistName && !channel) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// Compact YouTube Music profile for the artist of the current track: photo,
// name and description. Only rendered once a profile is available (or while
// it is being looked up); a missing/offline lookup hides the section entirely
// so the queue stays clean.
export default function ArtistProfile({ artist, artistItems }) {
	const credit = String(artist || "").trim();
	const artistNames = splitArtistNames(credit);
	const { session } = useJellyfin();
	const [isOpen, setIsOpen] = useState(true);
	const [state, setState] = useState(() => ({
		credit,
		status: artistNames.length ? "loading" : "idle",
		profiles: uniqueArtistProfiles(artistNames
			.map((name) => ({ name, profile: getCachedArtistProfile(name) }))
			.filter(({ profile }) => profile)),
	}));

	useEffect(() => {
		const names = splitArtistNames(credit);
		if (names.length === 0) {
			setState({ credit, status: "idle", profiles: [] });
			return undefined;
		}

		const cachedProfiles = uniqueArtistProfiles(names
			.map((name) => ({ name, profile: getCachedArtistProfile(name) }))
			.filter(({ profile }) => profile));
		const allCached = names.every((name) => getCachedArtistProfile(name) !== undefined);
		if (allCached) {
			setState({
				credit,
				status: cachedProfiles.length ? "ready" : "empty",
				profiles: cachedProfiles,
			});
			return undefined;
		}

		let cancelled = false;
		setState({ credit, status: "loading", profiles: cachedProfiles });
		Promise.all(names.map((name) => fetchArtistProfile(name))).then((results) => {
			if (cancelled) return;
			const profiles = uniqueArtistProfiles(results
				.map((profile, index) => ({ name: names[index], profile }))
				.filter(({ profile }) => profile));
			setState({ credit, status: profiles.length ? "ready" : "empty", profiles });
		});
		return () => {
			cancelled = true;
		};
	}, [credit]);

	// Never show a profile belonging to the previous artist while the next
	// lookup is in flight.
	const isCurrent = state.credit === credit;
	const status = isCurrent ? state.status : "loading";
	const profiles = isCurrent ? state.profiles : [];

	useEffect(() => {
		if (status !== "ready" || !session?.accessToken) return;

		for (const { name, profile } of profiles) {
			if (!profile.thumbnail) continue;
			const jellyfinArtist = artistItems?.find((item) => (
				String(item?.Name || "").trim().toLowerCase() === name.toLowerCase()
			));

			saveArtistProfileImageIfMissing(session, jellyfinArtist?.Id, name, profile.thumbnail)
				.catch((error) => {
					console.warn(`Could not update the Jellyfin artist image for ${name}:`, error);
				});
		}
	}, [artistItems, profiles, session, status]);

	if (!credit || status === "empty" || status === "idle") return null;

	if (status === "loading" && profiles.length === 0) return null;

	return (
		<div>
			<div className="mt-1 space-y-2">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setIsOpen(!isOpen)}
						aria-expanded={isOpen}
						className="flex min-w-0 flex-1 items-center justify-between py-1.5 cursor-pointer"
					>
						<span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
							About {profiles.length > 1 ? "the Artists" : "the Artist"}
						</span>
						<IconChevronDown
							size={13}
							className={`transition-transform duration-200 ${isOpen ? "-rotate-180" : "rotate-0"}`}
						/>
					</button>
					<a href="https://music.youtube.com" target="_blank" rel="noopener noreferrer" className="brightness-100 transition hover:brightness-150">
						<img src="/ytmusic.svg" alt="YouTube Music" className="h-3 w-auto" />
					</a>
				</div>

				{isOpen && profiles.map(({ name, profile }) => (
					<div
						key={profile.channelId || name}
						className="rounded-xs bg-[#101014]/40 border border-zinc-800"
					>
						{profile.thumbnail && (
							<div
								className="w-full h-16 bg-cover bg-center rounded-t-xs"
								style={{ backgroundImage: `linear-gradient(to bottom, rgba(16, 16, 20, 0.2), rgba(16, 16, 20, 0.2)), url(${profile.thumbnail})` }}
							>
							</div>
						)}
						<div className="w-full p-3">
							<div className="w-full flex items-center gap-2.5">
								<p className="min-w-0 truncate text-xs font-bold text-white">
									{profile.name || name}
								</p>
								{profile.profileUrl && (
									<a
										href={profile.profileUrl}
										onClick={(event) => {
											event.preventDefault();
											openUrl(profile.profileUrl).catch((error) => {
												console.error("Could not open YouTube Music artist profile:", error);
												toast.error("Could not open artist profile");
											});
										}}
										title={`Open ${profile.name || name} on YouTube Music`}
										aria-label={`Open ${profile.name || name} on YouTube Music`}
										className="shrink-0 text-zinc-300 transition hover:text-white"
									>
										{/* <IconExternalLink size={14} /> */}
										<IconBrandYoutubeFilled size={14} />
									</a>
								)}
							</div>

							{profile.description && (
								<div className="mt-2">
									<p className="text-[10px] leading-relaxed text-zinc-300 line-clamp-2">
										{profile.description}
									</p>
								</div>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
