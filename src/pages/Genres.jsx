import { useParams } from "react-router-dom";
import { IconTag } from "@tabler/icons-react";
import { fetchMusicGenres } from "../services/jellyfin";
import LibraryCollectionPage from "./LibraryCollectionPage";

const loadGenres = (session) => fetchMusicGenres(session.serverUrl, session.userId, session.accessToken);

export default function GenresPage() {
	const { genreId } = useParams();
	return (
		<LibraryCollectionPage
			title="Genres"
			icon={IconTag}
			loadItems={loadGenres}
			detailId={genreId}
			detailFilter="genreId"
			detailPath="/genres"
			entityList
			genreCards
		/>
	);
}
