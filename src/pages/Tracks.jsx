import { IconMusic } from "@tabler/icons-react";
import { fetchMusicCollection } from "../services/jellyfin";
import LibraryCollectionPage from "./LibraryCollectionPage";

const loadTracks = (session) => fetchMusicCollection(session.serverUrl, session.userId, session.accessToken);

export default function TracksPage() {
	return (
		<LibraryCollectionPage
			title="Tracks"
			icon={IconMusic}
			loadItems={loadTracks}
		/>
	);
}
