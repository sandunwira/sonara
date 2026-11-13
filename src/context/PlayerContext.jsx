import { createContext, useContext, useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useJellyfin } from "./JellyfinContext";
import { getAudioStreamUrl, getImageUrl } from "../services/jellyfin";
import { getStoredPlayerQueue, saveStoredPlayerQueue, recordAppLog } from "../services/jellyfinCache";

const PlayerContext = createContext();

function restoreSavedQueue(saved, session) {
	if (!saved || !Array.isArray(saved.queue)) {
		return { queue: [], queueIndex: -1, currentTrack: null, playbackSource: null };
	}

	const queue = saved.queue
		.filter((track) => track?.id)
		.map((track) => ({
			...track,
			cover: session?.serverUrl && session?.accessToken
				? getImageUrl(session.serverUrl, track.id, session.accessToken)
				: track.cover,
			streamUrl: session?.serverUrl && session?.accessToken
				? getAudioStreamUrl(session.serverUrl, track.id, session.accessToken, session.userId)
				: "",
		}));
	const queueIndex = Number.isInteger(saved.queueIndex)
		? Math.min(Math.max(saved.queueIndex, -1), queue.length - 1)
		: -1;
	const currentTrack = saved.currentTrackId && queue[queueIndex]?.id === saved.currentTrackId
		? queue[queueIndex]
		: null;

	return { queue, queueIndex, currentTrack, playbackSource: saved.playbackSource || null };
}

export function PlayerProvider({ children }) {
	const { session, isSessionLoaded, reportTrackPlayed, reportPlaybackEvent } = useJellyfin();
	const [currentTrack, setCurrentTrack] = useState(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [volume, setVolumeState] = useState(85);
	const [isMuted, setIsMuted] = useState(false);
	const [isShuffle, setIsShuffle] = useState(false);
	const [isRepeat, setIsRepeat] = useState(false);
	const [queue, setQueue] = useState([]);
	const [queueIndex, setQueueIndex] = useState(-1);
	// Where the current playback originated (e.g. a genre card). Genre cards
	// keep their play/pause button visible only while this points at them.
	const [playbackSource, setPlaybackSource] = useState(null);

	const currentTrackRef = useRef(currentTrack);
	const queueRestoredRef = useRef(false);
	const queueRef = useRef(queue);
	const queueIndexRef = useRef(queueIndex);
	const isRepeatRef = useRef(isRepeat);
	const audioRef = useRef(null);
	const reportedTrackIdRef = useRef(null);
	const activePlaybackTrackRef = useRef(null);
	const progressIntervalRef = useRef(null);
	const playbackReporterRef = useRef(null);
	const nextTrackRef = useRef(null);
	const lastAudibleVolumeRef = useRef(85);

	currentTrackRef.current = currentTrack;
	queueRef.current = queue;
	queueIndexRef.current = queueIndex;
	isRepeatRef.current = isRepeat;
	playbackReporterRef.current = { reportTrackPlayed, reportPlaybackEvent };

	const updateQueue = (nextQueue, nextIndex) => {
		queueRef.current = nextQueue;
		queueIndexRef.current = nextIndex;
		setQueue(nextQueue);
		setQueueIndex(nextIndex);
	};

	useEffect(() => {
		if (!isSessionLoaded || !session || queueRestoredRef.current) return undefined;

		let cancelled = false;
		getStoredPlayerQueue()
			.then((saved) => {
				if (cancelled) return;
				const restored = restoreSavedQueue(saved, session);
				queueRestoredRef.current = true;
				queueRef.current = restored.queue;
				queueIndexRef.current = restored.queueIndex;
				currentTrackRef.current = restored.currentTrack;
				setQueue(restored.queue);
				setQueueIndex(restored.queueIndex);
				setCurrentTrack(restored.currentTrack);
				setPlaybackSource(restored.playbackSource);
			})
			.catch((error) => {
				console.error("Could not restore saved playback queue from the database:", error);
				queueRestoredRef.current = true;
				toast.error("Could not restore saved playback queue");
			});

		return () => {
			cancelled = true;
		};
	}, [isSessionLoaded, session]);

	useEffect(() => {
		if (!queueRestoredRef.current) return;

		saveStoredPlayerQueue({
			queue: queue.map((track) => {
				const { id, title, artist, album, albumId, duration, isJellyfin, genreNames, raw } = track;
				return {
					id, title, artist, album, albumId, duration, isJellyfin,
					// Kept so a restored queue can still be matched to genre cards.
					genreNames: genreNames || raw?.Genres || [],
				};
			}),
			queueIndex,
			currentTrackId: currentTrack?.id || null,
			playbackSource,
		}).catch((error) => {
			console.error("Could not save playback queue to the database:", error);
			toast.error("Could not save playback queue");
		});
	}, [queue, queueIndex, currentTrack]);

	// When the active Jellyfin server changes, the saved queue no longer makes
	// sense (its track ids/stream urls belong to the previous server), so stop
	// playback and start the new server with an empty queue.
	const activeServerUrlRef = useRef(undefined);
	useEffect(() => {
		if (!isSessionLoaded || !queueRestoredRef.current) return undefined;
		const serverUrl = session?.serverUrl || null;
		if (activeServerUrlRef.current === undefined) {
			activeServerUrlRef.current = serverUrl;
			return undefined;
		}
		if (activeServerUrlRef.current === serverUrl) return undefined;
		activeServerUrlRef.current = serverUrl;

		if (progressIntervalRef.current) {
			clearInterval(progressIntervalRef.current);
			progressIntervalRef.current = null;
		}
		audioRef.current?.pause();
		activePlaybackTrackRef.current = null;
		reportedTrackIdRef.current = null;
		setIsPlaying(false);
		setCurrentTime(0);
		setDuration(0);
		setCurrentTrack(null);
		currentTrackRef.current = null;
		setPlaybackSource(null);
		updateQueue([], -1);
		return undefined;
	}, [isSessionLoaded, session]);

	const getPlaybackState = (isPaused) => {
		const audio = audioRef.current;
		return {
			CanSeek: true,
			IsPaused: isPaused,
			IsMuted: audio?.muted ?? false,
			PositionTicks: Math.floor((audio?.currentTime ?? 0) * 10_000_000),
			VolumeLevel: Math.round((audio?.volume ?? 0) * 100),
			PlayMethod: "DirectStream",
		};
	};

	const reportPlayback = (event, track, isPaused = false) => {
		if (!track?.isJellyfin) return Promise.resolve(false);
		const reporter = playbackReporterRef.current?.reportPlaybackEvent;
		if (!reporter) return Promise.resolve(false);
		return reporter(event, track.id, getPlaybackState(isPaused)).then((reported) => {
			if (!reported && event === "start") {
				toast.error("Jellyfin could not register this playback session");
			}
		});
	};

	const stopPlaybackReporting = () => {
		const track = activePlaybackTrackRef.current;
		if (!track) return;

		if (progressIntervalRef.current) {
			clearInterval(progressIntervalRef.current);
			progressIntervalRef.current = null;
		}
		const stopRequest = reportPlayback("stop", track);
		activePlaybackTrackRef.current = null;
		const reporter = playbackReporterRef.current?.reportTrackPlayed;
		if (reportedTrackIdRef.current !== track.id) {
			reportedTrackIdRef.current = track.id;
			stopRequest.then(() => reporter?.(track.id)).then((reported) => {
				if (reported === false && reportedTrackIdRef.current === track.id) {
					reportedTrackIdRef.current = null;
				}
			});
		}
	};

	const startPlaybackReporting = (track) => {
		if (!track?.isJellyfin) return;
		if (activePlaybackTrackRef.current?.id !== track.id) {
			stopPlaybackReporting();
			activePlaybackTrackRef.current = track;
			reportPlayback("start", track);
		} else {
			reportPlayback("progress", track);
		}

		if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
		progressIntervalRef.current = setInterval(() => {
			reportPlayback("progress", track);
		}, 10_000);
	};

	// Initialize Audio element
	useEffect(() => {
		const audio = new Audio();
		audioRef.current = audio;
		audio.preload = "auto";

		const onTimeUpdate = () => {
			setCurrentTime(audio.currentTime);
		};

		const onLoadedMetadata = () => {
			if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
				setDuration(audio.duration);
			}
		};

		const onPlay = () => setIsPlaying(true);
		const onPause = () => {
			setIsPlaying(false);
			if (activePlaybackTrackRef.current) {
				reportPlayback("progress", activePlaybackTrackRef.current, true);
			}
		};
		const onVolumeChange = () => {
			const currentVolume = Math.round(audio.volume * 100);
			setVolumeState(currentVolume);
			setIsMuted(audio.muted);
			if (!audio.muted && currentVolume > 0) {
				lastAudibleVolumeRef.current = currentVolume;
			}
		};

		const onEnded = () => {
			const endedTrack = activePlaybackTrackRef.current;
			stopPlaybackReporting();
			if (isRepeatRef.current) {
				audio.currentTime = 0;
				audio.play().then(() => startPlaybackReporting(endedTrack)).catch(() => { });
			} else {
				nextTrackRef.current?.();
			}
		};

		const onError = (e) => {
			console.error("Audio playback error:", audio.error);
			let errorMessage = "Could not stream audio track";
			if (audio.error) {
				switch (audio.error.code) {
					case 1:
						errorMessage = "Audio playback aborted";
						break;
					case 2:
						errorMessage = "Network error loading audio";
						break;
					case 3:
						errorMessage = "Audio decoding error";
						break;
					case 4:
						errorMessage = "Audio format not supported by server/player";
						break;
					default:
						errorMessage = audio.error.message || errorMessage;
				}
			}
			recordAppLog("error", "audio", "Audio playback failed", {
				trackTitle: currentTrackRef.current?.title || null,
				trackId: currentTrackRef.current?.id || null,
				errorCode: audio.error?.code ?? null,
				message: errorMessage,
				src: audio.src,
			});
			toast.error(errorMessage);
			setIsPlaying(false);
			stopPlaybackReporting();
		};

		audio.addEventListener("timeupdate", onTimeUpdate);
		audio.addEventListener("loadedmetadata", onLoadedMetadata);
		audio.addEventListener("play", onPlay);
		audio.addEventListener("pause", onPause);
		audio.addEventListener("volumechange", onVolumeChange);
		audio.addEventListener("ended", onEnded);
		audio.addEventListener("error", onError);

		return () => {
			if (progressIntervalRef.current) {
				clearInterval(progressIntervalRef.current);
				progressIntervalRef.current = null;
			}
			if (activePlaybackTrackRef.current) {
				reportPlayback("stop", activePlaybackTrackRef.current);
				activePlaybackTrackRef.current = null;
			}
			audio.pause();
			audio.removeEventListener("timeupdate", onTimeUpdate);
			audio.removeEventListener("loadedmetadata", onLoadedMetadata);
			audio.removeEventListener("play", onPlay);
			audio.removeEventListener("pause", onPause);
			audio.removeEventListener("volumechange", onVolumeChange);
			audio.removeEventListener("ended", onEnded);
			audio.removeEventListener("error", onError);
		};
	}, []);

	useEffect(() => {
		if (!audioRef.current) return;
		audioRef.current.volume = volume / 100;
		audioRef.current.muted = isMuted || volume === 0;
	}, [volume, isMuted]);

	const startTrack = (track) => {
		if (!track) return;

		setCurrentTrack(track);
		currentTrackRef.current = track;
		setCurrentTime(0);
		setDuration(track.duration || 0);

		if (audioRef.current) {
			if (track.streamUrl) {
				stopPlaybackReporting();
				audioRef.current.volume = volume / 100;
				audioRef.current.muted = isMuted || volume === 0;
				audioRef.current.src = track.streamUrl;
				audioRef.current
					.play()
					.then(() => {
						setIsPlaying(true);
						startPlaybackReporting(track);
					})
					.catch((err) => {
						console.error("Audio play error:", err);
						recordAppLog("error", "audio", `Could not play "${track.title}"`, {
							trackId: track.id,
							message: err?.message || String(err),
						});
						toast.error(`Could not play "${track.title}"`);
						setIsPlaying(false);
					});
			} else {
				toast.error(`No stream URL found for "${track.title}"`);
				setIsPlaying(false);
			}
		}
	};

	const playTrack = (track, newQueue = null) => {
		if (!track) return;
		// Starting playback from an arbitrary list invalidates any previous
		// "played from genre card" origin. Genre playback re-sets it right
		// after via setPlaybackSource.
		setPlaybackSource(null);
		const nextQueue = Array.isArray(newQueue) && newQueue.length > 0
			? [...newQueue]
			: [track];
		let nextIndex = nextQueue.findIndex((queuedTrack) => queuedTrack.id === track.id);
		if (nextIndex === -1) {
			nextQueue.unshift(track);
			nextIndex = 0;
		}
		updateQueue(nextQueue, nextIndex);
		startTrack(track);
	};

	const playNow = (track) => {
		if (!track) return;
		setPlaybackSource(null);
		const nextQueue = [...queueRef.current];
		let activeIndex = currentTrackRef.current ? queueIndexRef.current : -1;

		if (currentTrackRef.current?.id === track.id && activeIndex >= 0) {
			startTrack(track);
			return;
		}

		const existingIndex = nextQueue.findIndex((queuedTrack) => queuedTrack.id === track.id);
		if (existingIndex !== -1) {
			nextQueue.splice(existingIndex, 1);
			if (existingIndex <= activeIndex) activeIndex -= 1;
		}

		const nextIndex = activeIndex + 1;
		nextQueue.splice(nextIndex, 0, track);
		updateQueue(nextQueue, nextIndex);
		startTrack(track);
	};

	const playNext = (track) => {
		if (!track) return;
		if (!currentTrackRef.current) {
			playNow(track);
			return;
		}
		if (currentTrackRef.current.id === track.id) return;

		const nextQueue = [...queueRef.current];
		let activeIndex = queueIndexRef.current;
		const existingIndex = nextQueue.findIndex((queuedTrack) => queuedTrack.id === track.id);
		if (existingIndex !== -1) {
			nextQueue.splice(existingIndex, 1);
			if (existingIndex <= activeIndex) activeIndex -= 1;
		}
		nextQueue.splice(activeIndex + 1, 0, track);
		updateQueue(nextQueue, activeIndex);
	};

	const playLast = (track) => {
		if (!track) return;
		if (!currentTrackRef.current) {
			playNow(track);
			return;
		}
		if (currentTrackRef.current.id === track.id) return;
		const nextQueue = [...queueRef.current];
		let activeIndex = queueIndexRef.current;
		const existingIndex = nextQueue.findIndex((queuedTrack) => queuedTrack.id === track.id);
		if (existingIndex !== -1) {
			nextQueue.splice(existingIndex, 1);
			if (existingIndex < activeIndex) activeIndex -= 1;
		}
		nextQueue.push(track);
		updateQueue(nextQueue, activeIndex);
	};

	const removeQueuedTrack = (index) => {
		if (index <= queueIndexRef.current || index >= queueRef.current.length) return;
		const nextQueue = [...queueRef.current];
		nextQueue.splice(index, 1);
		updateQueue(nextQueue, queueIndexRef.current);
	};

	const moveQueuedTrack = (fromIndex, toIndex) => {
		const currentIndex = queueIndexRef.current;
		const nextQueue = [...queueRef.current];
		if (
			fromIndex <= currentIndex
			|| toIndex <= currentIndex
			|| fromIndex >= nextQueue.length
			|| toIndex >= nextQueue.length
		) return;
		const [track] = nextQueue.splice(fromIndex, 1);
		nextQueue.splice(toIndex, 0, track);
		updateQueue(nextQueue, currentIndex);
	};

	const clearQueue = () => {
		const track = currentTrackRef.current;
		setPlaybackSource(null);
		updateQueue(track ? [track] : [], track ? 0 : -1);
	};

	const playQueueItem = (index) => {
		const track = queueRef.current[index];
		if (!track) return;
		updateQueue(queueRef.current, index);
		startTrack(track);
	};

	const togglePlay = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause();
				setIsPlaying(false);
			} else {
				if (!audioRef.current.src && currentTrack?.streamUrl) {
					audioRef.current.src = currentTrack.streamUrl;
				}
				if (audioRef.current.src) {
					audioRef.current.volume = volume / 100;
					audioRef.current.muted = isMuted || volume === 0;
					audioRef.current
						.play()
						.then(() => {
							setIsPlaying(true);
							startPlaybackReporting(currentTrack);
						})
						.catch((err) => {
							console.error("Audio play error:", err);
							recordAppLog("error", "audio", "Unable to resume audio playback", {
								trackId: currentTrack?.id || null,
								message: err?.message || String(err),
							});
							toast.error("Unable to play audio");
							setIsPlaying(false);
						});
				} else {
					toast.error("No track selected");
				}
			}
		}
	};

	const seek = (seconds) => {
		setCurrentTime(seconds);
		if (audioRef.current && audioRef.current.src) {
			try {
				audioRef.current.currentTime = seconds;
			} catch (err) {
				console.warn("Seek error:", err);
			}
		}
	};

	const setVolume = (val) => {
		const clamped = Math.max(0, Math.min(100, val));
		setVolumeState(clamped);
		setIsMuted(clamped === 0);
		if (audioRef.current) {
			audioRef.current.volume = clamped / 100;
			audioRef.current.muted = clamped === 0;
		}
		if (clamped > 0) lastAudibleVolumeRef.current = clamped;
	};

	const toggleMute = () => {
		if (isMuted || volume === 0) {
			const restoredVolume = volume > 0 ? volume : lastAudibleVolumeRef.current;
			setVolumeState(restoredVolume);
			setIsMuted(false);
			if (audioRef.current) {
				audioRef.current.volume = restoredVolume / 100;
				audioRef.current.muted = false;
			}
		} else {
			setIsMuted(true);
			if (audioRef.current) audioRef.current.muted = true;
		}
	};

	const nextTrack = () => {
		const currentQueue = queueRef.current;
		if (currentQueue.length === 0 || queueIndexRef.current >= currentQueue.length - 1) return;
		let nextIdx;
		if (isShuffle) {
			nextIdx = Math.floor(Math.random() * (currentQueue.length - queueIndexRef.current - 1))
				+ queueIndexRef.current + 1;
		} else {
			nextIdx = queueIndexRef.current + 1;
		}
		updateQueue(currentQueue, nextIdx);
		startTrack(currentQueue[nextIdx]);
	};
	nextTrackRef.current = nextTrack;

	const prevTrack = () => {
		if (currentTime > 3) {
			seek(0);
			return;
		}
		const currentQueue = queueRef.current;
		if (currentQueue.length === 0 || queueIndexRef.current <= 0) return;
		const prevIdx = queueIndexRef.current - 1;
		updateQueue(currentQueue, prevIdx);
		startTrack(currentQueue[prevIdx]);
	};

	// ---- OS media controls (MediaSession API) ----
	const mediaActionsRef = useRef({ togglePlay, nextTrack, prevTrack, seek });
	mediaActionsRef.current = { togglePlay, nextTrack, prevTrack, seek };
	const mediaPositionRef = useRef(-1);

	useEffect(() => {
		if (!("mediaSession" in navigator)) return undefined;
		const { mediaSession } = navigator;
		const audio = audioRef.current;

		const resumePlayback = () => {
			if (!audio) return;
			if (!audio.src && currentTrackRef.current?.streamUrl) {
				audio.src = currentTrackRef.current.streamUrl;
			}
			if (audio.src) audio.play().catch(() => { });
		};
		const pausePlayback = () => audio?.pause();
		const stopPlayback = () => {
			if (!audio) return;
			audio.pause();
			if (audio.src) audio.currentTime = 0;
		};

		const actionHandlers = {
			play: resumePlayback,
			pause: pausePlayback,
			stop: stopPlayback,
			previoustrack: () => mediaActionsRef.current.prevTrack?.(),
			nexttrack: () => mediaActionsRef.current.nextTrack?.(),
			seekbackward: (details) => {
				if (!audio?.src) return;
				mediaActionsRef.current.seek?.(Math.max(0, audio.currentTime - (details.seekOffset || 10)));
			},
			seekforward: (details) => {
				if (!audio?.src) return;
				mediaActionsRef.current.seek?.(audio.currentTime + (details.seekOffset || 10));
			},
			seekto: (details) => {
				if (details.seekTime == null || !audio?.src) return;
				mediaActionsRef.current.seek?.(details.seekTime);
			},
		};

		for (const [action, handler] of Object.entries(actionHandlers)) {
			try {
				mediaSession.setActionHandler(action, handler);
			} catch {
				// Action unsupported on this platform - skip it.
			}
		}

		return () => {
			for (const action of Object.keys(actionHandlers)) {
				try {
					mediaSession.setActionHandler(action, null);
				} catch {
					// Ignore cleanup failures.
				}
			}
		};
	}, []);

	// Show the current track in the system media overlay (title, artist, album, artwork).
	useEffect(() => {
		if (!("mediaSession" in navigator)) return;
		if (!currentTrack) {
			navigator.mediaSession.metadata = null;
			return;
		}
		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: currentTrack.title || "Unknown track",
				artist: currentTrack.artist || "",
				album: currentTrack.album || "",
				artwork: currentTrack.cover
					? [{ src: currentTrack.cover, sizes: "256x256 512x512", type: "image/jpeg" }]
					: [],
			});
		} catch {
			// MediaMetadata unavailable in this webview.
		}
	}, [currentTrack]);

	// Keep the overlay's play/pause glyph in sync with actual playback.
	useEffect(() => {
		if (!("mediaSession" in navigator)) return;
		navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
	}, [isPlaying]);

	// Keep the overlay's scrubber roughly in sync (once per second).
	useEffect(() => {
		if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
		if (!duration || !isFinite(duration) || duration <= 0) return;
		if (!isFinite(currentTime) || currentTime < 0) return;
		const position = Math.min(Math.floor(currentTime), duration);
		if (position === mediaPositionRef.current) return;
		mediaPositionRef.current = position;
		try {
			navigator.mediaSession.setPositionState({
				duration,
				playbackRate: 1,
				position,
			});
		} catch {
			// Invalid position state on this platform - ignore.
		}
	}, [currentTime, duration]);

	const toggleShuffle = () => setIsShuffle((prev) => !prev);
	const toggleRepeat = () => setIsRepeat((prev) => !prev);

	// Format: [<playing or paused>] Track Title — Artist — Sonara
	const title = currentTrack?.title
		? `[${isPlaying ? "PLAYING" : "PAUSED"}] ${currentTrack.title} — ${currentTrack.artist} — Sonara`
		: "Sonara";

	return (
		<PlayerContext.Provider
			value={{
				currentTrack,
				isPlaying,
				currentTime,
				duration,
				volume,
				isMuted,
				isShuffle,
				isRepeat,
				queue,
				queueIndex,
				playbackSource,
				setPlaybackSource,
				playTrack,
				playNow,
				playNext,
				playLast,
				removeQueuedTrack,
				moveQueuedTrack,
				clearQueue,
				playQueueItem,
				togglePlay,
				seek,
				setVolume,
				toggleMute,
				nextTrack,
				prevTrack,
				toggleShuffle,
				toggleRepeat,
				title,
			}}
		>
			{children}
		</PlayerContext.Provider>
	);
}

export function usePlayer() {
	const context = useContext(PlayerContext);
	if (!context) {
		return {
			currentTrack: null,
			isPlaying: false,
			currentTime: 0,
			duration: 0,
			volume: 85,
			isMuted: false,
			isShuffle: false,
			isRepeat: false,
			queue: [],
			queueIndex: -1,
			playbackSource: null,
			setPlaybackSource: () => { },
			togglePlay: () => { },
			playTrack: () => { },
			playNow: () => { },
			playNext: () => { },
			playLast: () => { },
			removeQueuedTrack: () => { },
			moveQueuedTrack: () => { },
			clearQueue: () => { },
			playQueueItem: () => { },
			seek: () => { },
			setVolume: () => { },
			toggleMute: () => { },
			nextTrack: () => { },
			prevTrack: () => { },
			toggleShuffle: () => { },
			toggleRepeat: () => { },
			title: "Sonara",
		};
	}
	return context;
}
