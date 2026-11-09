import { useParams } from "react-router-dom";
import { IconFolder } from "@tabler/icons-react";
import { fetchMusicLibraries } from "../services/jellyfin";
import LibraryCollectionPage from "./LibraryCollectionPage";

const loadFolders = (session) => fetchMusicLibraries(session.serverUrl, session.userId, session.accessToken);

export default function FoldersPage() {
	const { libraryId } = useParams();
	return (
		<LibraryCollectionPage
			title="Folders"
			description="Browse your music libraries"
			icon={IconFolder}
			loadItems={loadFolders}
			detailId={libraryId}
			detailFilter="parentId"
			detailPath="/folders"
			entityList
			isFolderList
		/>
	);
}
