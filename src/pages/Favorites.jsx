import { IconHeart } from "@tabler/icons-react";
import { fetchMusicCollection } from "../services/jellyfin";
import LibraryCollectionPage from "./LibraryCollectionPage";

const loadFavorites = (session) => fetchMusicCollection(
	session.serverUrl,
	session.userId,
	session.accessToken,
	{ isFavorite: true },
);

export default function FavoritesPage() {
	return (
		<LibraryCollectionPage
			title="Favourites"
			icon={IconHeart}
			loadItems={loadFavorites}
		/>
	);
}
