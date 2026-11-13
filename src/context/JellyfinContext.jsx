import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
	authenticateByName,
	cleanUrl,
	getAuthHeaders,
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
	getStoredJellyfinServers,
	normalizeServerUrl,
	removeStoredJellyfinSession,
	removeStoredJellyfinServer,
	purgeJellyfinServerCache,
	updateStoredJellyfinServer,
	upsertStoredJellyfinServer,
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
	// Server currently being edited in the edit-server modal (null = closed).
	const [editingServer, setEditingServer] = useState(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSyncingLibrary, setIsSyncingLibrary] = useState(false);
	const [libraryVersion, setLibraryVersion] = useState(0);
	const [isRefreshingMostPlayed, setIsRefreshingMostPlayed] = useState(false);
	const [isRefreshingRecentlyPlayed, setIsRefreshingRecentlyPlayed] = useState(false);
	const [tracks, setTracks] = useState([]);
	const [recentlyPlayed, setRecentlyPlayed] = useState([]);
	const [genres, setGenres] = useState([]);
	const [isOffline, setIsOffline] = useState(false);
	const [servers, setServers] = useState([]);
	const [connectionStatus, setConnectionStatus] = useState("checking");

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
		const bootstrap = async () => {
			const savedServers = await getStoredJellyfinServers();
			const savedSession = await getStoredJellyfinSession();
			if (isConfiguredSession(savedSession)) {
				setSession(savedSession);
				// First launch after this feature: the previously connected
				// server becomes the first entry of the saved server list.
				if (!savedServers.some((server) => normalizeServerUrl(server.serverUrl) === normalizeServerUrl(savedSession.serverUrl))) {
					await upsertStoredJellyfinServer(savedSession);
					savedServers.push(savedSession);
				}
			} else {
				setIsServerModalOpen(true);
			}
			if (!cancelled) setServers(savedServers);
		};

		bootstrap()
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

	// Periodically probe the real server (bypassing the local cache) to keep
	// the title bar connection indicator accurate. Distinct from isOffline
	// (browser network state) — a reachable-but-slow or auth-broken server is
	// reported as "weak" here, an unreachable one as "offline".
	const connectionStatusRef = useRef("checking");
	useEffect(() => {
		if (!session?.serverUrl) {
			setConnectionStatus("offline");
			return undefined;
		}

		let cancelled = false;
		let intervalId = null;
		let timeoutId = null;
		const base = cleanUrl(session.serverUrl);

		const probe = async () => {
			if (!navigator.onLine) {
				setConnectionStatus("offline");
				return;
			}
			const startedAt = performance.now();
			const controller = new AbortController();
			timeoutId = setTimeout(() => controller.abort(), 4000);
			try {
				const response = await fetch(`${base}/System/Info/Public`, {
					headers: getAuthHeaders(),
					cache: "no-store",
					signal: controller.signal,
				});
				if (cancelled) return;
				const latency = performance.now() - startedAt;
				setConnectionStatus(
					response.ok && latency <= 1500 ? "ok" : "weak",
				);
			} catch {
				if (cancelled) return;
				setConnectionStatus("offline");
			} finally {
				clearTimeout(timeoutId);
			}
		};

		const onConnectivityChanged = () => probe();
		probe();
		intervalId = setInterval(probe, 15000);
		window.addEventListener("online", onConnectivityChanged);
		window.addEventListener("offline", onConnectivityChanged);

		return () => {
			cancelled = true;
			clearInterval(intervalId);
			clearTimeout(timeoutId);
			window.removeEventListener("online", onConnectivityChanged);
			window.removeEventListener("offline", onConnectivityChanged);
		};
	}, [session?.serverUrl]);

	// Record every connection status change in the application logs.
	useEffect(() => {
		if (connectionStatus === connectionStatusRef.current) return;
		connectionStatusRef.current = connectionStatus;
		const messages = {
			ok: "Jellyfin server connection is healthy",
			weak: "Weak connection to the Jellyfin server",
			offline: "Jellyfin server is unreachable",
			checking: "Checking Jellyfin server connection",
		};
		recordAppLog(
			connectionStatus === "ok" ? "info" : "warning",
			"network",
			messages[connectionStatus] || "Connection status changed",
		);
	}, [connectionStatus]);

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
	const switchServer = useCallback(async (serverUrl) => {
		if (!serverUrl) return;
		const target = (await getStoredJellyfinServers())
			.find((server) => normalizeServerUrl(server.serverUrl) === normalizeServerUrl(serverUrl));
		if (!target) {
			toast.error("That server is not saved in Sonara");
			return;
		}
		if (session && normalizeServerUrl(session.serverUrl) === normalizeServerUrl(target.serverUrl)) {
			toast.success(`${target.serverName || "That server"} is already the active server`);
			return;
		}

		setIsLoading(true);
		try {
			// Content on screen belongs to the previous server.
			setTracks([]);
			setRecentlyPlayed([]);
			setGenres([]);
			setLibraryVersion((version) => version + 1);
			// Keep the last activated server as the session restored on relaunch.
			await saveStoredJellyfinSession(target);
			setSession(target);
			await recordAppLog("info", "jellyfin", "Switched active Jellyfin server", {
				fromServerUrl: session?.serverUrl || null,
				toServerUrl: target.serverUrl,
			});
			toast.success(`Switched to ${target.serverName || target.serverUrl}`);
		} catch (error) {
			console.error("Could not switch Jellyfin server:", error);
			recordAppLog("error", "jellyfin", "Switching Jellyfin server failed", {
				message: error.message,
				serverUrl: target.serverUrl,
			});
			toast.error("Could not switch server");
		} finally {
			setIsLoading(false);
		}
	}, [session]);

	const removeServer = useCallback(async (serverUrl) => {
		if (!serverUrl) return;
		const isActive = Boolean(session && normalizeServerUrl(session.serverUrl) === normalizeServerUrl(serverUrl));
		try {
			await removeStoredJellyfinServer(serverUrl);
			if (isActive) await removeStoredJellyfinSession();
		} catch (error) {
			console.error("Could not remove the Jellyfin server:", error);
			toast.error("Could not remove server");
			return;
		}
		setServers((current) => current.filter(
			(server) => normalizeServerUrl(server.serverUrl) !== normalizeServerUrl(serverUrl),
		));
		if (isActive) {
			setSession(null);
			setTracks([]);
			setRecentlyPlayed([]);
			setGenres([]);
			setIsServerModalOpen(true);
		} else {
			toast.success("Server removed");
		}
	}, [session]);

	const openEditServerModal = (server) => setEditingServer(server || null);
	const closeEditServerModal = () => setEditingServer(null);

	const updateServer = useCallback(async (oldServerUrl, changes = {}) => {
		const record = servers.find(
			(server) => normalizeServerUrl(server.serverUrl) === normalizeServerUrl(oldServerUrl),
		);
		if (!record) {
			toast.error("That server is not saved in Sonara");
			return { success: false };
		}

		const nextServerUrl = cleanUrl(changes.serverUrl ?? record.serverUrl);
		const nextServerName = String(changes.serverName ?? record.serverName ?? "").trim();
		const nextUsername = String(changes.username ?? record.username ?? "").trim();
		const password = String(changes.password ?? "");

		if (!nextServerUrl) {
			toast.error("A server address is required");
			return { success: false, error: "A server address is required" };
		}

		const addressChanged = normalizeServerUrl(nextServerUrl) !== normalizeServerUrl(record.serverUrl);
		const isActive = Boolean(
			session && normalizeServerUrl(session.serverUrl) === normalizeServerUrl(record.serverUrl),
		);
		// Re-sign in when the account changes, or when a password is supplied
		// to refresh the token against this server.
		const credentialsChanged = Boolean(nextUsername)
			&& (nextUsername !== record.username || password !== "");

		// Before saving a moved address or a new sign-in, verify the server
		// actually answers and learn its identity.
		let serverInfo = null;
		if (addressChanged || credentialsChanged) {
			try {
				serverInfo = await testServer(nextServerUrl);
			} catch (error) {
				const message = `Could not reach a Jellyfin server at ${nextServerUrl}`;
				await recordAppLog("error", "jellyfin", "Edited server address is unreachable", {
					message: error.message,
					serverUrl: nextServerUrl,
				});
				toast.error(message);
				return { success: false, error: message };
			}
		}

		// Re-authenticate so the stored token and user match the account.
		let authData = null;
		if (credentialsChanged) {
			try {
				authData = await authenticateByName(nextServerUrl, nextUsername, password);
			} catch (error) {
				const message = error.message || "Could not sign in to the Jellyfin server";
				await recordAppLog("error", "jellyfin", "Edited server sign-in failed", {
					message,
					serverUrl: nextServerUrl,
				});
				toast.error(message);
				return { success: false, error: message };
			}
		}

		// The server Id ties content to a physical install: matching Ids mean
		// the same library, so the cache can safely move to the new address.
		const resolvedServerId = authData?.serverId || serverInfo?.Id;
		const isSameServer = Boolean(
			resolvedServerId && record.serverId && String(resolvedServerId) === String(record.serverId),
		);
		// A different account on the same install gets fresh content too
		// (play history, favourites), so its cache cannot be reused.
		const userIdChanged = Boolean(authData && record.userId && authData.userId !== record.userId);

		// Another saved server already occupies the new address.
		const duplicate = servers.find(
			(server) => server !== record
				&& normalizeServerUrl(server.serverUrl) === normalizeServerUrl(nextServerUrl),
		);

		const updated = {
			...(authData || record),
			serverUrl: nextServerUrl,
			serverName: nextServerName || serverInfo?.ServerName || record.serverName,
			serverVersion: serverInfo?.Version || record.serverVersion,
		};

		try {
			if (duplicate) {
				// The edited address is already saved: drop this row so the same
				// server is never stored twice, keeping the existing entry (and
				// all of its cached content) untouched.
				await removeStoredJellyfinServer(record.serverUrl);
				setServers((current) => current.filter(
					(server) => normalizeServerUrl(server.serverUrl) !== normalizeServerUrl(record.serverUrl),
				));
				if (isActive) {
					await saveStoredJellyfinSession(duplicate);
					setSession(duplicate);
				}
				await recordAppLog("info", "jellyfin", "Merged duplicate Jellyfin server entry", {
					removedServerUrl: record.serverUrl,
					keptServerUrl: duplicate.serverUrl,
				});
				toast.success(`Merged into ${duplicate.serverName || duplicate.serverUrl}`);
				return { success: true };
			}

			let cacheOutcome = { addressChanged, migratedCacheEntries: 0, removedCacheEntries: 0 };
			// Same install at a new address → carry the cache over. A different
			// install or a different account means the cached content cannot be
			// reused: purge it instead of migrating it under the new key.
			const canReuseCache = isSameServer && !userIdChanged;
			if (addressChanged && !canReuseCache) {
				cacheOutcome = await purgeJellyfinServerCache(record.serverUrl);
			} else if (!addressChanged && userIdChanged) {
				cacheOutcome = await purgeJellyfinServerCache(record.serverUrl);
			}
			await updateStoredJellyfinServer(record.serverUrl, updated);
			setServers((current) => current.map(
				(server) => (normalizeServerUrl(server.serverUrl) === normalizeServerUrl(record.serverUrl)
					? updated
					: server),
			));
			if (isActive) {
				await saveStoredJellyfinSession(updated);
				setSession(updated);
				if ((addressChanged && !isSameServer) || userIdChanged) {
					// What is on screen belongs to the previous server content.
					setTracks([]);
					setRecentlyPlayed([]);
					setGenres([]);
					setLibraryVersion((version) => version + 1);
					await loadLibrary(updated, { forceRefresh: true });
				}
			}
			await recordAppLog("info", "jellyfin", "Updated saved Jellyfin server", {
				fromServerUrl: record.serverUrl,
				toServerUrl: updated.serverUrl,
				addressChanged,
				credentialsChanged,
				userIdChanged,
				migratedCacheEntries: cacheOutcome.migratedCacheEntries ?? 0,
				removedCacheEntries: cacheOutcome.removedCacheEntries ?? 0,
			});
			toast.success(addressChanged
				? `Server updated to ${updated.serverUrl}`
				: "Server updated");
			return { success: true };
		} catch (error) {
			console.error("Could not update the Jellyfin server:", error);
			await recordAppLog("error", "jellyfin", "Updating Jellyfin server failed", {
				message: error.message,
				serverUrl: record.serverUrl,
			});
			toast.error("Could not update server");
			return { success: false, error: error.message };
		}
	}, [servers, session, loadLibrary]);

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
			await upsertStoredJellyfinServer(newSession);
			setServers((current) => [
				...current.filter((server) => normalizeServerUrl(server.serverUrl) !== normalizeServerUrl(newSession.serverUrl)),
				newSession,
			]);
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
			if (session?.serverUrl) {
				await removeStoredJellyfinServer(session.serverUrl);
				setServers((current) => current.filter(
					(server) => normalizeServerUrl(server.serverUrl) !== normalizeServerUrl(session.serverUrl),
				));
			}
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
				servers,
				switchServer,
				removeServer,
				editingServer,
				openEditServerModal,
				closeEditServerModal,
				updateServer,
				connectionStatus,
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
