import { useParams } from "react-router-dom";
import { IconUser } from "@tabler/icons-react";
import { fetchMusicArtists } from "../services/jellyfin";
import LibraryCollectionPage from "./LibraryCollectionPage";

const loadArtists = (session) => fetchMusicArtists(session.serverUrl, session.userId, session.accessToken);

export default function ArtistsPage() {
	const { artistId } = useParams();
	return (
		<LibraryCollectionPage
			title="Artists"
			icon={IconUser}
			loadItems={loadArtists}
			detailId={artistId}
			detailFilter="artistId"
			detailPath="/artists"
			entityList
		/>
	);
}
