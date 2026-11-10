import { createContext, useContext, useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
	authenticateByName,
	testServer,
	fetchUserMusic,
	fetchRecentlyPlayed,
	fetchMusicGenres,
	markItemPlayed,
	syncJellyfinLibrary,
	reportPlaybackEvent as sendPlaybackEvent,
} from "../services/jellyfin";
import {
	getStoredJellyfinSession,
	removeStoredJellyfinSession,
	recordAppLog,
	saveStoredJellyfinSession,
} from "../services/jellyfinCache";

const JellyfinContext = createContext();

function isConfiguredSession(savedSession) {
	return Boolean(savedSession?.accessToken && savedSession?.serverUrl && savedSession?.userId);
}

export function JellyfinProvider({ children }) {
	const [session, setSession] = useState(null);
	const [isSessionLoaded, setIsSessionLoaded] = useState(false);
	const [isServerModalOpen, setIsServerModalOpen] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isSyncingLibrary, setIsSyncingLibrary] = useState(false);
	const [libraryVersion, setLibraryVersion] = useState(0);
	const [isRefreshingMostPlayed, setIsRefreshingMostPlayed] = useState(false);
	const [isRefreshingRecentlyPlayed, setIsRefreshingRecentlyPlayed] = useState(false);
	const [tracks, setTracks] = useState([]);
	const [recentlyPlayed, setRecentlyPlayed] = useState([]);
	const [genres, setGenres] = useState([]);
	const [isOffline, setIsOffline] = useState(false);

	const isAuthenticated = Boolean(session?.accessToken && session?.serverUrl && session?.userId);

	useEffect(() => {
		recordAppLog("info", "application", "Sonara started");
		const handleError = (event) => {
			recordAppLog("error", "renderer", event.message || "Uncaught application error", {
				filename: event.filename,
				line: event.lineno,
				column: event.colno,
				stack: event.error?.stack,
			});
		};
		const handleRejection = (event) => {
			const reason = event.reason;
			recordAppLog("error", "renderer", "Unhandled promise rejection", {
				reason: reason?.message || String(reason),
				stack: reason?.stack,
			});
		};
		window.addEventListener("error", handleError);
		window.addEventListener("unhandledrejection", handleRejection);

		// Track connectivity so the UI can fall back to the cached library
		// and every transition is recorded in the application logs.
		setIsOffline(!navigator.onLine);
		const handleOffline = () => {
			setIsOffline(true);
			recordAppLog("warning", "network", "Network went offline; showing cached library data");
			toast("You are offline - showing last synced", { icon: "📡" });
		};
		const handleOnline = () => {
			setIsOffline(false);
			recordAppLog("info", "network", "Network connection restored");
			toast.success("Back online");
		};
		window.addEventListener("offline", handleOffline);
		window.addEventListener("online", handleOnline);

		let cancelled = false;
		getStoredJellyfinSession()
			.then((savedSession) => {
				if (cancelled) return;
				if (isConfiguredSession(savedSession)) {
					setSession(savedSession);
				} else {
					setIsServerModalOpen(true);
				}
			})
			.catch((error) => {
				console.error("Could not load the saved Jellyfin session from the database:", error);
				if (!cancelled) setIsServerModalOpen(true);
			})
			.finally(() => {
				if (!cancelled) setIsSessionLoaded(true);
			});

		return () => {
			cancelled = true;
			window.removeEventListener("error", handleError);
			window.removeEventListener("unhandledrejection", handleRejection);
			window.removeEventListener("offline", handleOffline);
			window.removeEventListener("online", handleOnline);
		};
	}, []);

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
			recordAppLog("error", "jellyfin-playback", "Could not update recently played history", {
				message: error.message,
				itemId,
			});
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
			const purgeSummary = await syncJellyfinLibrary(session.serverUrl, session.userId, session.accessToken);
			setLibraryVersion((version) => version + 1);
			await loadLibrary(session);
			await recordAppLog("info", "library-sync", "Jellyfin library sync completed", {
				serverUrl: session.serverUrl,
				userId: session.userId,
				removedStaleCacheEntries: purgeSummary?.removedStaleEntries ?? 0,
			});
			toast.success("Library synced");
		} catch (error) {
			console.error("Failed to sync Jellyfin library:", error);
			await recordAppLog("error", "library-sync", "Jellyfin library sync failed", {
				message: error.message,
			});
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
			recordAppLog("error", "jellyfin-playback", `Could not report playback ${event}`, {
				message: error.message,
				itemId,
			});
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

			await saveStoredJellyfinSession(newSession);
			await recordAppLog("info", "jellyfin", "Connected to Jellyfin server", {
				serverUrl: newSession.serverUrl,
				userId: newSession.userId,
			});
			setSession(newSession);

			toast.success(`Connected to ${newSession.serverName}!`);
			setIsServerModalOpen(false);

			// Immediately load user library
			await loadLibrary(newSession);
			return { success: true };
		} catch (error) {
			console.error("Jellyfin connection error:", error);
			await recordAppLog("error", "jellyfin", "Jellyfin connection failed", {
				message: error.message,
			});
			const message = error.message || "Failed to connect to Jellyfin server";
			toast.error(message);
			return { success: false, error: message };
		} finally {
			setIsLoading(false);
		}
	};

	const disconnectServer = async () => {
		try {
			await removeStoredJellyfinSession();
		} catch (error) {
			console.error("Could not remove the saved Jellyfin session:", error);
			toast.error("Could not disconnect from Jellyfin");
			return;
		}
		setSession(null);
		setIsServerModalOpen(true);
		setTracks([]);
		setRecentlyPlayed([]);
		setGenres([]);
		toast.success("Disconnected from Jellyfin server");
	};

	return (
		<JellyfinContext.Provider
			value={{
				session,
				isSessionLoaded,
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
				isOffline,
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
