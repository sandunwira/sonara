import { createContext, useContext, useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
	authenticateByName,
	testServer,
	fetchUserMusic,
	fetchRecentlyPlayed,
	fetchMusicGenres,
	markItemPlayed,
	reportPlaybackEvent as sendPlaybackEvent,
} from "../services/jellyfin";
import { clearJellyfinCache } from "../services/jellyfinCache";

const STORAGE_KEY = "sonara_jellyfin_session";
const JellyfinContext = createContext();

function readSavedSession() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		return saved ? JSON.parse(saved) : null;
	} catch {
		return null;
	}
}

function isConfiguredSession(savedSession) {
	return Boolean(savedSession?.accessToken && savedSession?.serverUrl && savedSession?.userId);
}

export function JellyfinProvider({ children }) {
	const [session, setSession] = useState(readSavedSession);

	const [isServerModalOpen, setIsServerModalOpen] = useState(
		() => !isConfiguredSession(readSavedSession()),
	);
	const [isLoading, setIsLoading] = useState(false);
	const [isSyncingLibrary, setIsSyncingLibrary] = useState(false);
	const [libraryVersion, setLibraryVersion] = useState(0);
	const [isRefreshingMostPlayed, setIsRefreshingMostPlayed] = useState(false);
	const [isRefreshingRecentlyPlayed, setIsRefreshingRecentlyPlayed] = useState(false);
	const [tracks, setTracks] = useState([]);
	const [recentlyPlayed, setRecentlyPlayed] = useState([]);
	const [genres, setGenres] = useState([]);

	const isAuthenticated = Boolean(session?.accessToken && session?.serverUrl && session?.userId);

	// Load user music when authenticated
	const loadLibrary = useCallback(async (currentSession = session, { forceRefresh = false } = {}) => {
		if (!currentSession?.accessToken || !currentSession?.serverUrl || !currentSession?.userId) {
			setTracks([]);
			setRecentlyPlayed([]);
			setGenres([]);
			return;
		}

		setIsLoading(true);
		try {
			const results = await Promise.allSettled([
				fetchUserMusic(currentSession.serverUrl, currentSession.userId, currentSession.accessToken, 50, { forceRefresh }),
				fetchRecentlyPlayed(currentSession.serverUrl, currentSession.userId, currentSession.accessToken, 50, { forceRefresh }),
				fetchMusicGenres(currentSession.serverUrl, currentSession.userId, currentSession.accessToken, { forceRefresh }),
			]);

			const setters = [setTracks, setRecentlyPlayed, setGenres];
			const names = ["music library", "recently played", "music genres"];
			results.forEach((result, index) => {
				if (result.status === "fulfilled") {
					setters[index](result.value);
				} else {
					console.warn(`Could not fetch ${names[index]}:`, result.reason);
				}
			});
			return results.every((result) => result.status === "fulfilled");
		} catch (error) {
			console.error("Failed to load Jellyfin library:", error);
			return false;
		} finally {
			setIsLoading(false);
		}
	}, [session]);

	const refreshSection = useCallback(async (fetchItems, setItems, sectionName, setIsRefreshing) => {
		if (!session?.accessToken || !session?.serverUrl || !session?.userId) {
			toast.error("Connect to a Jellyfin server to refresh this section");
			return;
		}

		setIsRefreshing(true);
		try {
			const items = await fetchItems(session.serverUrl, session.userId, session.accessToken, 50, { forceRefresh: true });
			setItems(items);
		} catch (error) {
			console.error(`Failed to refresh ${sectionName}:`, error);
			toast.error(`Could not refresh ${sectionName}`);
		} finally {
			setIsRefreshing(false);
		}
	}, [session]);

	const refreshMostPlayed = useCallback(
		() => refreshSection(fetchUserMusic, setTracks, "most played", setIsRefreshingMostPlayed),
		[refreshSection],
	);
	const refreshRecentlyPlayed = useCallback(
		() => refreshSection(fetchRecentlyPlayed, setRecentlyPlayed, "recently played", setIsRefreshingRecentlyPlayed),
		[refreshSection],
	);
	const reportTrackPlayed = useCallback(async (itemId) => {
		if (!session?.accessToken || !session?.serverUrl || !session?.userId) return false;

		try {
			await markItemPlayed(session.serverUrl, session.userId, itemId, session.accessToken);
			const recentList = await fetchRecentlyPlayed(
				session.serverUrl,
				session.userId,
				session.accessToken,
				50,
				{ forceRefresh: true },
			);
			setRecentlyPlayed(recentList);
			return true;
		} catch (error) {
			console.error("Failed to update recently played history:", error);
			toast.error("Could not update recently played history");
			return false;
		}
	}, [session]);

	const syncLibrary = useCallback(async () => {
		if (!session?.accessToken || !session?.serverUrl || !session?.userId) {
			toast.error("Connect to a Jellyfin server to sync your library");
			return;
		}

		setIsSyncingLibrary(true);
		try {
			await clearJellyfinCache();
			setLibraryVersion((version) => version + 1);
			const synced = await loadLibrary(session, { forceRefresh: true });
			if (synced) {
				toast.success("Library synced");
			} else {
				toast.error("Some library data could not be synced");
			}
		} catch (error) {
			console.error("Failed to sync Jellyfin library:", error);
			toast.error("Could not sync library");
		} finally {
			setIsSyncingLibrary(false);
		}
	}, [loadLibrary, session]);
	const reportPlaybackEvent = useCallback(async (event, itemId, state) => {
		if (!session?.accessToken || !session?.serverUrl || !session?.userId) return false;

		try {
			await sendPlaybackEvent(session.serverUrl, event, { ItemId: itemId, ...state }, session.accessToken);
			return true;
		} catch (error) {
			console.error(`Failed to report Jellyfin playback ${event}:`, error);
			return false;
		}
	}, [session]);

	useEffect(() => {
		if (isAuthenticated) {
			loadLibrary();
		}
	}, [isAuthenticated, loadLibrary]);

	const connectServer = async (serverUrl, username, password) => {
		setIsLoading(true);
		try {
			// Step 1: Verify server connectivity
			const serverInfo = await testServer(serverUrl);

			// Step 2: Authenticate user
			const authData = await authenticateByName(serverUrl, username, password);

			const newSession = {
				...authData,
				serverName: serverInfo.ServerName || "Jellyfin Server",
				serverVersion: serverInfo.Version,
			};

			localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
			setSession(newSession);

			toast.success(`Connected to ${newSession.serverName}!`);
			setIsServerModalOpen(false);

			// Immediately load user library
			await loadLibrary(newSession);
			return { success: true };
		} catch (error) {
			console.error("Jellyfin connection error:", error);
			const message = error.message || "Failed to connect to Jellyfin server";
			toast.error(message);
			return { success: false, error: message };
		} finally {
			setIsLoading(false);
		}
	};

	const disconnectServer = () => {
		localStorage.removeItem(STORAGE_KEY);
		setSession(null);
		setTracks([]);
		setRecentlyPlayed([]);
		setGenres([]);
		toast.success("Disconnected from Jellyfin server");
	};

	return (
		<JellyfinContext.Provider
			value={{
				session,
				isAuthenticated,
				isLoading,
				isServerModalOpen,
				openServerModal: () => setIsServerModalOpen(true),
				closeServerModal: () => {
					if (isAuthenticated) setIsServerModalOpen(false);
				},
				connectServer,
				disconnectServer,
				refreshLibrary: syncLibrary,
				syncLibrary,
				isSyncingLibrary,
				libraryVersion,
				refreshMostPlayed,
				refreshRecentlyPlayed,
				reportTrackPlayed,
				reportPlaybackEvent,
				isRefreshingMostPlayed,
				isRefreshingRecentlyPlayed,
				tracks,
				recentlyPlayed,
				genres,
			}}
		>
			{children}
		</JellyfinContext.Provider>
	);
}

export function useJellyfin() {
	const context = useContext(JellyfinContext);
	if (!context) {
		throw new Error("useJellyfin must be used within a JellyfinProvider");
	}
	return context;
}
