import { useParams } from "react-router-dom";
import { IconPlaylist } from "@tabler/icons-react";
import LibraryCollectionPage from "./LibraryCollectionPage";

// A playlist is a plain Jellyfin collection whose children are its tracks;
// the generic Items query with a ParentId filter returns them (sorted by
// name, like every other collection view).
export default function PlaylistDetailPage() {
	const { playlistId } = useParams();
	return (
		<LibraryCollectionPage
			title="Playlists"
			icon={IconPlaylist}
			loadItems={() => Promise.resolve([])}
			detailId={playlistId}
			detailFilter="parentId"
			detailEmptyTitle="This playlist is empty"
			detailEmptySubtitle="Add tracks from any track's more options menu."
		/>
	);
}
