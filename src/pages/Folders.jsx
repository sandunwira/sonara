import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { IconFolder } from "@tabler/icons-react";
import { useJellyfin } from "../context/JellyfinContext";
import { fetchMusicLibraries } from "../services/jellyfin";
import { ensureLibraryThumbnails } from "../services/libraryThumbnails";
import LibraryCollectionPage from "./LibraryCollectionPage";

const loadFolders = (session) => fetchMusicLibraries(session.serverUrl, session.userId, session.accessToken);

export default function FoldersPage() {
	const { libraryId } = useParams();
	const { session, isAuthenticated, libraryVersion } = useJellyfin();
	const [reloadKey, setReloadKey] = useState(0);

	// Wave backgrounds are generated locally in the background (stored in the app database only). When new ones become available, remount the list so the tiles pick them up; the refetch is served from cache.
	useEffect(() => {
		if (!isAuthenticated || !session) return undefined;
		let cancelled = false;
		ensureLibraryThumbnails(session.serverUrl, session.userId, session.accessToken)
			.then((changed) => {
				if (!cancelled && changed) setReloadKey((key) => key + 1);
			})
			.catch((error) => console.error("Failed to ensure library thumbnails:", error));
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated, session, libraryVersion]);

	return (
		<LibraryCollectionPage
			key={reloadKey}
			title="Folders"
			icon={IconFolder}
			loadItems={loadFolders}
			detailId={libraryId}
			detailFilter="parentId"
			detailPath="/folders"
			entityList
			isFolderList
			// Only a single library's track list can be played, not the
			// top-level library grid.
			playAll={Boolean(libraryId)}
		/>
	);
}
