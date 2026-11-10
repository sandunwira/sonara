import { useParams } from "react-router-dom";
import { IconDisc } from "@tabler/icons-react";
import { fetchMusicAlbums } from "../services/jellyfin";
import LibraryCollectionPage from "./LibraryCollectionPage";

const loadAlbums = (session) => fetchMusicAlbums(session.serverUrl, session.userId, session.accessToken);

export default function AlbumsPage() {
	const { albumId } = useParams();
	return (
		<LibraryCollectionPage
			title="Albums"
			icon={IconDisc}
			loadItems={loadAlbums}
			detailId={albumId}
			detailFilter="parentId"
			detailPath="/albums"
			entityList
		/>
	);
}
