import { createContext, useContext, useState, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import toast from "react-hot-toast";
import { useJellyfin } from "./JellyfinContext";
import { isTauri, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { update as updateThumbarButton } from "tauri-plugin-thumbar";
import { getAudioStreamUrl, getImageUrl } from "../services/jellyfin";
import {
	getStoredPlayerQueue,
	saveStoredPlayerQueueTracks,
	saveStoredPlayerQueueState,
	getStoredCrossfadeDuration,
	saveStoredCrossfadeDuration,
	getStoredPlayerVolume,
	saveStoredPlayerVolume,
	recordAppLog,
} from "../services/jellyfinCache";
import { ensureDownloadedTracksLoaded, peekDownloadedTrack } from "../services/offlineDownloads";

const PlayerContext = createContext();

// Crossfades are deliberately ramps on the elements' own `volume` rather than
// Web Audio gain nodes: Jellyfin streams are cross-origin, and a
// MediaElementAudioSourceNode would output silence unless the server sent
// matching CORS headers.
const MAX_CROSSFADE_SECONDS = 12;

// Playback position lives outside React state on purpose: the audio element's
// "timeupdate" event fires ~4x/second, and keeping it in the provider made
// every usePlayer() consumer — including 3,000-row track tables — re-render
// continuously while music played. Components that actually display progress
// (player bar, queue panel lyrics) subscribe through usePlayerProgress();
// everything else only re-renders on real playback events.
const progressListeners = new Set();
let progressSnapshot = { currentTime: 0, duration: 0 };

function setProgress(patch) {
	const nextTime = patch.currentTime ?? progressSnapshot.currentTime;
	const nextDuration = patch.duration ?? progressSnapshot.duration;
	if (nextTime === progressSnapshot.currentTime && nextDuration === progressSnapshot.duration) {
		return;
	}
	progressSnapshot = { currentTime: nextTime, duration: nextDuration };
	progressListeners.forEach((listener) => listener());
}

function subscribeToProgress(listener) {
	progressListeners.add(listener);
	return () => progressListeners.delete(listener);
}

function getProgressSnapshot() {
	return progressSnapshot;
}

export function usePlayerProgress() {
	return useSyncExternalStore(subscribeToProgress, getProgressSnapshot, getProgressSnapshot);
}

// Imperative progress access for things that can update themselves without a
// React render (the player bar's slider). Subscribing here and writing the DOM
// directly keeps the ~4x/second "timeupdate" ticks out of React entirely; use
// usePlayerProgress only where a render is actually required.
export function subscribePlayerProgress(listener) {
	return subscribeToProgress(listener);
}

export function getPlayerProgress() {
	return progressSnapshot;
}

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
	const [volume, setVolumeState] = useState(85);
	const [isMuted, setIsMuted] = useState(false);
	const [isShuffle, setIsShuffle] = useState(false);
	// Repeat playback: "off" (no repeat), "all" (loop the queue), or "one"
	// (loop the current track).
	const [repeatMode, setRepeatMode] = useState("off");
	const [queue, setQueue] = useState([]);
	const [queueIndex, setQueueIndex] = useState(-1);
	// Seconds of overlap between the end of one track and the start of the
	// next; 0 disables crossfading (tracks then switch only when one ends).
	const [crossfadeDuration, setCrossfadeDurationState] = useState(0);
	// Where the current playback originated (e.g. a genre card). Genre cards
	// keep their play/pause button visible only while this points at them.
	const [playbackSource, setPlaybackSource] = useState(null);

	const currentTrackRef = useRef(currentTrack);
	const queueRestoredRef = useRef(false);
	const queueRef = useRef(queue);
	const queueIndexRef = useRef(queueIndex);
	const isRepeatRef = useRef(repeatMode);
	// Mirrors isShuffle for callbacks that must not wait for a re-render
	// (e.g. track-end advancing), and remembers the queue order from before
	// shuffle was enabled so it can be restored when shuffle is turned off.
	const isShuffleRef = useRef(isShuffle);
	const originalQueueOrderRef = useRef(null);
	// `audioRef` is always the element currently being heard; `spareAudioRef`
	// is the other one (the outgoing element while a crossfade is running).
	const audioRef = useRef(null);
	const spareAudioRef = useRef(null);
	// The in-flight crossfade (volume ramp) or null. Kept outside React state
	// because it is animation-frame driven.
	const fadeRef = useRef(null);
	// Set once per track when its end has already started the next track, so
	// the ~4x/second timeupdate cannot advance the queue twice.
	const crossfadeTriggeredRef = useRef(false);
	const crossfadeDurationRef = useRef(0);
	const crossfadeSaveTimerRef = useRef(null);
	// Volume/mute are restored once, then written back (debounced) so the
	// player comes back at the same level after a restart.
	const volumeRestoredRef = useRef(false);
	const volumeSaveTimerRef = useRef(null);
	// Incremented on every track start so late play() callbacks from a track
	// that was already skipped over cannot report or ramp the wrong one.
	const playRequestRef = useRef(0);
	const reportedTrackIdRef = useRef(null);
	const activePlaybackTrackRef = useRef(null);
	const progressIntervalRef = useRef(null);
	const playbackReporterRef = useRef(null);
	const nextTrackRef = useRef(null);
	const lastAudibleVolumeRef = useRef(85);
	const mediaPositionRef = useRef(-1);
	// Mirrors of the volume state for the crossfade ramp and audio callbacks,
	// which must read the latest value without being re-created per render.
	const volumeRef = useRef(volume);
	const isMutedRef = useRef(isMuted);
	// True while the audio element plays a locally downloaded file instead of
	// the Jellyfin stream (used to skip offline playback reporting).
	const localPlaybackRef = useRef(false);
	const sessionRef = useRef(session);

	currentTrackRef.current = currentTrack;
	queueRef.current = queue;
	queueIndexRef.current = queueIndex;
	isRepeatRef.current = repeatMode;
	isShuffleRef.current = isShuffle;
	sessionRef.current = session;
	volumeRef.current = volume;
	isMutedRef.current = isMuted;
	crossfadeDurationRef.current = crossfadeDuration;

	// Downloaded-track records are loaded once per server so startTrack can
	// resolve a local file synchronously (no SQLite round-trip per track).
	useEffect(() => {
		if (session?.serverUrl) {
			ensureDownloadedTracksLoaded(session.serverUrl).catch(() => {});
		}
	}, [session?.serverUrl]);

	// Restore the saved crossfade length once, then persist slider changes
	// (debounced so a drag does not write to the database on every pixel).
	useEffect(() => {
		let cancelled = false;
		getStoredCrossfadeDuration()
			.then((seconds) => {
				if (cancelled || typeof seconds !== "number" || !Number.isFinite(seconds)) return;
				const clamped = Math.max(0, Math.min(MAX_CROSSFADE_SECONDS, Math.round(seconds)));
				crossfadeDurationRef.current = clamped;
				setCrossfadeDurationState(clamped);
			})
			.catch(() => {
				// A missing/unreadable setting simply keeps crossfade disabled.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const setCrossfadeDuration = (value) => {
		const numeric = Number(value);
		// The slider moves in whole seconds; keep values on that grid.
		const clamped = Number.isFinite(numeric)
			? Math.max(0, Math.min(MAX_CROSSFADE_SECONDS, Math.round(numeric)))
			: 0;
		crossfadeDurationRef.current = clamped;
		setCrossfadeDurationState(clamped);

		if (crossfadeSaveTimerRef.current) {
			clearTimeout(crossfadeSaveTimerRef.current);
		}
		crossfadeSaveTimerRef.current = setTimeout(() => {
			crossfadeSaveTimerRef.current = null;
			saveStoredCrossfadeDuration(clamped).catch((error) => {
				console.error("Could not save the crossfade setting:", error);
			});
		}, 400);
	};

	// The player's volume level and mute state survive restarts. The restore
	// runs once (before the persisting effect is allowed to write, so the
	// default 85% can never overwrite a saved value on startup).
	useEffect(() => {
		let cancelled = false;
		getStoredPlayerVolume()
			.then((saved) => {
				if (cancelled) return;
				volumeRestoredRef.current = true;
				if (!saved) return;
				volumeRef.current = saved.volume;
				isMutedRef.current = saved.isMuted;
				setVolumeState(saved.volume);
				setIsMuted(saved.isMuted);
				if (saved.volume > 0) {
					lastAudibleVolumeRef.current = saved.volume;
				}
			})
			.catch(() => {
				volumeRestoredRef.current = true;
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!volumeRestoredRef.current) return undefined;
		if (volumeSaveTimerRef.current) {
			clearTimeout(volumeSaveTimerRef.current);
		}
		volumeSaveTimerRef.current = setTimeout(() => {
			volumeSaveTimerRef.current = null;
			saveStoredPlayerVolume(volume, isMuted).catch((error) => {
				console.error("Could not save the player volume:", error);
			});
		}, 400);
		return undefined;
	}, [volume, isMuted]);

	// Picks where a track plays from: the downloaded local file when one is
	// recorded for this server, otherwise the Jellyfin stream.
	const resolvePlaybackSource = (track) => {
		const serverUrl = sessionRef.current?.serverUrl;
		const downloaded = serverUrl ? peekDownloadedTrack(serverUrl, track?.id) : null;
		if (downloaded?.filePath) {
			return { src: convertFileSrc(downloaded.filePath), isLocal: true };
		}
		return { src: track?.streamUrl || "", isLocal: false };
	};

	// Fisher–Yates shuffle returning a new array.
	const shuffleArray = (array) => {
		const result = [...array];
		for (let index = result.length - 1; index > 0; index -= 1) {
			const swapIndex = Math.floor(Math.random() * (index + 1));
			[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
		}
		return result;
	};

	// Shuffles everything after the given position (the un-played part of the
	// queue), keeping the played history and the current track in place.
	const shuffleQueueAfter = (list, index) => {
		if (index < 0 || index >= list.length - 1) return list;
		return [...list.slice(0, index + 1), ...shuffleArray(list.slice(index + 1))];
	};
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

	// Only the fields needed to rebuild stream urls and match genre cards are
	// persisted. Recomputing this memo (and the DB write below) is tied to
	// queue identity, not to queueIndex/current track changes.
	const savedQueueTracks = useMemo(() => queue.map((track) => {
		const { id, title, artist, artistId, album, albumId, duration, isJellyfin, genreNames, raw } = track;
		return {
			id, title, artist, artistId, album, albumId, duration, isJellyfin,
			// Kept so a restored queue can still be matched to genre cards.
			genreNames: genreNames || raw?.Genres || [],
		};
	}), [queue]);

	useEffect(() => {
		if (!queueRestoredRef.current) return;

		saveStoredPlayerQueueTracks(savedQueueTracks).catch((error) => {
			console.error("Could not save playback queue to the database:", error);
			toast.error("Could not save playback queue");
		});
	}, [savedQueueTracks]);

	useEffect(() => {
		if (!queueRestoredRef.current) return;

		saveStoredPlayerQueueState({
			queueIndex,
			currentTrackId: currentTrack?.id || null,
			playbackSource,
		}).catch((error) => {
			console.error("Could not save playback queue state to the database:", error);
			toast.error("Could not save playback queue");
		});
	}, [queueIndex, currentTrack, playbackSource]);

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
		pauseAllAudio();
		activePlaybackTrackRef.current = null;
		reportedTrackIdRef.current = null;
		setIsPlaying(false);
		setProgress({ currentTime: 0, duration: 0 });
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
		// Playing a locally downloaded file while offline has no server
		// session to report to; skip instead of failing with a toast.
		if (localPlaybackRef.current && !navigator.onLine) return Promise.resolve(false);
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

	// Keeps the OS media overlay's scrubber roughly in sync without making the
	// provider re-render; called from the audio element's progress events.
	const syncMediaSessionPosition = (position, total) => {
		if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
		if (!total || !isFinite(total) || total <= 0) return;
		if (!isFinite(position) || position < 0) return;
		const rounded = Math.min(Math.floor(position), total);
		if (rounded === mediaPositionRef.current) return;
		mediaPositionRef.current = rounded;
		try {
			navigator.mediaSession.setPositionState({
				duration: total,
				playbackRate: 1,
				position: rounded,
			});
		} catch {
			// Invalid position state on this platform - ignore.
		}
	};

	// ---- Crossfade helpers ----
	const baseVolume = () => volumeRef.current / 100;
	const isAudioMuted = () => isMutedRef.current || volumeRef.current === 0;

	const releaseAudioElement = (audio) => {
		if (!audio) return;
		try {
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
		} catch {
			// The element is being torn down; nothing useful to do on failure.
		}
	};

	// Equal-power ramps keep the perceived loudness steady while two
	// (uncorrelated) tracks overlap.
	const applyCrossfadeLevels = (fade, progress) => {
		const base = baseVolume();
		const muted = isAudioMuted();
		const clamped = Math.max(0, Math.min(1, progress));
		fade.outgoing.volume = base * Math.cos((clamped * Math.PI) / 2);
		fade.incoming.volume = base * Math.sin((clamped * Math.PI) / 2);
		fade.outgoing.muted = muted;
		fade.incoming.muted = muted;
		fade.progress = clamped;
	};

	const stopFadeTimer = (fade) => {
		if (fade?.timer) {
			clearInterval(fade.timer);
			fade.timer = null;
		}
	};

	const finishCrossfade = (fade) => {
		if (fadeRef.current !== fade) return;
		fadeRef.current = null;
		stopFadeTimer(fade);
		// The incoming element is now the current track; make sure it sits at
		// the user's chosen level and release the outgoing stream.
		fade.incoming.volume = baseVolume();
		fade.incoming.muted = isAudioMuted();
		releaseAudioElement(fade.outgoing);
	};

	// Abandons a running fade (pause, seek-driven track change, error, ...).
	// The incoming element stays the current track; the outgoing is stopped.
	const cancelCrossfade = () => {
		const fade = fadeRef.current;
		if (!fade) return;
		fadeRef.current = null;
		stopFadeTimer(fade);
		fade.incoming.volume = baseVolume();
		fade.incoming.muted = isAudioMuted();
		releaseAudioElement(fade.outgoing);
	};

	// Stops both elements: the active one is paused (its source is kept so the
	// track can resume) while the outgoing one is fully released.
	const pauseAllAudio = () => {
		cancelCrossfade();
		audioRef.current?.pause();
		releaseAudioElement(spareAudioRef.current);
	};

	const beginCrossfade = (incoming, outgoing, seconds) => {
		if (!seconds || seconds <= 0) return;
		if (fadeRef.current) cancelCrossfade();
		const fade = {
			incoming,
			outgoing,
			startedAt: performance.now(),
			duration: seconds,
			progress: 0,
			timer: null,
		};
		fadeRef.current = fade;
		applyCrossfadeLevels(fade, 0);

		// A timer rather than requestAnimationFrame: rAF is suspended while
		// the window is hidden/minimized, which would freeze the fade (and
		// leave both tracks at partial volume). Background timer throttling is
		// fine — the 40ms cadence only gets coarser.
		const step = () => {
			if (fadeRef.current !== fade) return;
			const progress = Math.min(1, (performance.now() - fade.startedAt) / (seconds * 1000));
			applyCrossfadeLevels(fade, progress);
			if (progress >= 1) finishCrossfade(fade);
		};
		fade.timer = setInterval(step, 40);
	};

	// A fade may never be longer than half the track it belongs to: very short
	// interludes would otherwise begin fading out the moment they start.
	const effectiveCrossfadeSeconds = (duration) => {
		const configured = crossfadeDurationRef.current;
		if (!configured || configured <= 0) return 0;
		if (!duration || !Number.isFinite(duration) || duration <= 0) return configured;
		return Math.min(configured, duration / 2);
	};

	// Called from the active element's timeupdate. Starts the next track before
	// the current one ends so their volumes can overlap.
	const maybeCrossfadeNext = (audio) => {
		if (audio !== audioRef.current) return;
		if (fadeRef.current || crossfadeTriggeredRef.current) return;
		// Repeat-one restarts on "ended" instead (two copies of one track
		// would just overlap awkwardly).
		if (isRepeatRef.current === "one") return;
		if (!audio.duration || !Number.isFinite(audio.duration) || audio.duration <= 0) return;

		const fadeSeconds = effectiveCrossfadeSeconds(audio.duration);
		if (fadeSeconds <= 0) return;
		const remaining = audio.duration - audio.currentTime;
		if (remaining > fadeSeconds || remaining <= 0) return;

		const currentQueue = queueRef.current;
		const index = queueIndexRef.current;
		const canWrap = isRepeatRef.current === "all";
		const hasNext = index >= 0
			&& (index < currentQueue.length - 1 || (canWrap && currentQueue.length > 0));
		if (!hasNext) return;

		// A single-track repeat queue would "fade into itself", which can only
		// cut the tail off; let that one loop on "ended" as before.
		const nextTrack = index < currentQueue.length - 1
			? currentQueue[index + 1]
			: currentQueue[0];
		if (!nextTrack || nextTrack.id === currentTrackRef.current?.id) return;

		crossfadeTriggeredRef.current = true;
		nextTrackRef.current?.({ wrap: canWrap });
	};

	// Initialize the pair of Audio elements. Only one is audible at a time;
	// they swap roles on crossfades, so every listener is attached to both and
	// ignores events coming from the element that is not currently playing.
	useEffect(() => {
		const createAudioElement = () => {
			const audio = new Audio();
			audio.preload = "auto";
			const isActive = () => audio === audioRef.current;

			const onTimeUpdate = () => {
				if (!isActive()) return;
				setProgress({ currentTime: audio.currentTime });
				syncMediaSessionPosition(audio.currentTime, audio.duration);
				maybeCrossfadeNext(audio);
			};

			const onLoadedMetadata = () => {
				if (!isActive()) return;
				if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
					setProgress({ duration: audio.duration });
					syncMediaSessionPosition(audio.currentTime, audio.duration);
				}
			};

			const onPlay = () => {
				if (!isActive()) return;
				setIsPlaying(true);
			};
			const onPause = () => {
				if (!isActive()) return;
				setIsPlaying(false);
				if (activePlaybackTrackRef.current) {
					reportPlayback("progress", activePlaybackTrackRef.current, true);
				}
			};
			const onVolumeChange = () => {
				// During a fade the volumes are animation-driven; syncing them
				// back into state would make the volume slider jump around.
				if (!isActive() || fadeRef.current) return;
				const currentVolume = Math.round(audio.volume * 100);
				setVolumeState(currentVolume);
				setIsMuted(audio.muted);
				if (!audio.muted && currentVolume > 0) {
					lastAudibleVolumeRef.current = currentVolume;
				}
			};

			const onEnded = () => {
				// The outgoing element ending mid-crossfade is expected; the
				// incoming one already became the active element.
				if (!isActive()) return;
				const endedTrack = activePlaybackTrackRef.current;
				stopPlaybackReporting();
				if (isRepeatRef.current === "one") {
					audio.currentTime = 0;
					audio.play().then(() => startPlaybackReporting(endedTrack)).catch(() => { });
				} else {
					// "all" wraps back to the queue's first track; "off" stops at the end.
					nextTrackRef.current?.({ wrap: isRepeatRef.current === "all" });
				}
			};

			const onError = () => {
				if (!isActive()) return;
				cancelCrossfade();
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

			return {
				audio,
				teardown: () => {
					audio.removeEventListener("timeupdate", onTimeUpdate);
					audio.removeEventListener("loadedmetadata", onLoadedMetadata);
					audio.removeEventListener("play", onPlay);
					audio.removeEventListener("pause", onPause);
					audio.removeEventListener("volumechange", onVolumeChange);
					audio.removeEventListener("ended", onEnded);
					audio.removeEventListener("error", onError);
				},
			};
		};

		const primary = createAudioElement();
		const secondary = createAudioElement();
		audioRef.current = primary.audio;
		spareAudioRef.current = secondary.audio;

		return () => {
			if (progressIntervalRef.current) {
				clearInterval(progressIntervalRef.current);
				progressIntervalRef.current = null;
			}
			if (crossfadeSaveTimerRef.current) {
				clearTimeout(crossfadeSaveTimerRef.current);
				crossfadeSaveTimerRef.current = null;
			}
			if (volumeSaveTimerRef.current) {
				clearTimeout(volumeSaveTimerRef.current);
				volumeSaveTimerRef.current = null;
			}
			cancelCrossfade();
			if (activePlaybackTrackRef.current) {
				reportPlayback("stop", activePlaybackTrackRef.current);
				activePlaybackTrackRef.current = null;
			}
			primary.teardown();
			secondary.teardown();
			releaseAudioElement(primary.audio);
			releaseAudioElement(secondary.audio);
		};
	}, []);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		const fade = fadeRef.current;
		if (fade) {
			applyCrossfadeLevels(fade, fade.progress);
			return;
		}
		audio.volume = volume / 100;
		audio.muted = isMuted || volume === 0;
	}, [volume, isMuted]);

	// Turning crossfade off while a fade is running should cut over to the new
	// track immediately instead of letting the old ramp finish.
	useEffect(() => {
		if (crossfadeDuration === 0) cancelCrossfade();
	}, [crossfadeDuration]);

	const handlePlayFailure = (track, err) => {
		// Pausing/resuming during the brief buffer window aborts play(); that
		// is not an error worth reporting to the listener.
		if (err?.name === "AbortError") return;
		console.error("Audio play error:", err);
		recordAppLog("error", "audio", `Could not play "${track.title}"`, {
			trackId: track.id,
			message: err?.message || String(err),
		});
		toast.error(`Could not play "${track.title}"`);
		setIsPlaying(false);
	};

	const startTrack = (track) => {
		if (!track) return;

		const requestId = ++playRequestRef.current;
		const previousAudio = audioRef.current;
		const source = resolvePlaybackSource(track);
		// Restarting the same track (playNow on the current row) or resuming
		// from a pause is hard-switched: crossfading a song into itself would
		// overlap two different positions. The first play has nothing to fade.
		const fadeSeconds = source.src
			&& previousAudio?.src
			&& !previousAudio.paused
			&& currentTrackRef.current?.id !== track.id
			? effectiveCrossfadeSeconds(previousAudio.duration)
			: 0;
		const canCrossfade = fadeSeconds > 0 && Boolean(spareAudioRef.current);

		setCurrentTrack(track);
		currentTrackRef.current = track;
		setProgress({ currentTime: 0, duration: track.duration || 0 });
		mediaPositionRef.current = -1;
		crossfadeTriggeredRef.current = false;

		if (!source.src) {
			cancelCrossfade();
			releaseAudioElement(spareAudioRef.current);
			toast.error(`No stream URL found for "${track.title}"`);
			setIsPlaying(false);
			return;
		}

		stopPlaybackReporting();

		if (!canCrossfade) {
			cancelCrossfade();
			// An outgoing element can still be sounding while a crossfade was
			// buffering; a hard switch must leave exactly one element playing.
			releaseAudioElement(spareAudioRef.current);
			const audio = audioRef.current;
			if (!audio) return;
			audio.volume = baseVolume();
			audio.muted = isAudioMuted();
			audio.src = source.src;
			localPlaybackRef.current = source.isLocal;
			audio
				.play()
				.then(() => {
					if (playRequestRef.current !== requestId) return;
					setIsPlaying(true);
					startPlaybackReporting(track);
				})
				.catch((err) => {
					if (playRequestRef.current !== requestId) return;
					handlePlayFailure(track, err);
				});
			return;
		}

		// Crossfade: the next track starts on the idle element while the
		// current one ramps down underneath it. The incoming element becomes
		// the active one immediately so progress, seek and media metadata all
		// follow the new track.
		cancelCrossfade();
		const outgoing = previousAudio;
		const incoming = spareAudioRef.current;
		incoming.pause();
		incoming.volume = 0;
		incoming.muted = isAudioMuted();
		incoming.src = source.src;
		localPlaybackRef.current = source.isLocal;
		audioRef.current = incoming;
		spareAudioRef.current = outgoing;

		incoming
			.play()
			.then(() => {
				// A rapid second skip (or a pause during buffering) may have
				// superseded this attempt.
				if (playRequestRef.current !== requestId || audioRef.current !== incoming) return;
				if (incoming.paused) return;
				setIsPlaying(true);
				startPlaybackReporting(track);

				// Buffering may have used up part (or all) of the outgoing
				// track: never ramp longer than what actually remains.
				const outgoingRemaining = outgoing.duration - outgoing.currentTime;
				const actualFade = outgoing.paused || outgoing.ended
					? 0
					: Number.isFinite(outgoingRemaining) && outgoingRemaining > 0
						? Math.min(fadeSeconds, outgoingRemaining)
						: fadeSeconds;
				if (actualFade <= 0) {
					incoming.volume = baseVolume();
					incoming.muted = isAudioMuted();
					releaseAudioElement(outgoing);
				} else {
					beginCrossfade(incoming, outgoing, actualFade);
				}
			})
			.catch((err) => {
				if (playRequestRef.current !== requestId) return;
				handlePlayFailure(track, err);
				// The outgoing element is still holding the old track; stop it
				// rather than leaving untracked audio playing.
				releaseAudioElement(outgoing);
			});
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
		// While shuffle is on, a newly loaded queue is shuffled from the
		// starting track onward so the upcoming tracks play in random order.
		const finalQueue = isShuffleRef.current ? shuffleQueueAfter(nextQueue, nextIndex) : nextQueue;
		// A brand-new queue invalidates any previous shuffle snapshot.
		originalQueueOrderRef.current = null;
		updateQueue(finalQueue, nextIndex);
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

	// Appends a track to the very end of the queue without interrupting
	// playback. If an unplayed copy already sits ahead of the current
	// position, nothing is added (it would just be a duplicate the listener
	// still gets to) and an informational toast says so instead.
	const addToQueue = (track) => {
		if (!track) return;
		if (!currentTrackRef.current) {
			updateQueue([track], -1);
			toast.success(`Added "${track.title}" to the queue`);
			return;
		}
		const activeIndex = queueIndexRef.current;
		const duplicateAhead = queueRef.current
			.slice(activeIndex + 1)
			.some((queuedTrack) => queuedTrack.id === track.id);
		if (duplicateAhead) {
			toast(`"${track.title}" is already queued up`);
			return;
		}
		updateQueue([...queueRef.current, track], activeIndex);
		toast.success(`Added "${track.title}" to the queue`);
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
				// Drops the outgoing half of a running fade (or one still
				// buffering) too, otherwise it would keep sounding after the
				// visible pause.
				pauseAllAudio();
				setIsPlaying(false);
			} else {
				if (!audioRef.current.src && currentTrack) {
					const source = resolvePlaybackSource(currentTrack);
					if (source.src) {
						audioRef.current.src = source.src;
						localPlaybackRef.current = source.isLocal;
					}
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
		setProgress({ currentTime: seconds });
		mediaPositionRef.current = -1;
		if (audioRef.current && audioRef.current.src) {
			try {
				audioRef.current.currentTime = seconds;
				syncMediaSessionPosition(seconds, audioRef.current.duration);
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

	const nextTrack = ({ wrap = false } = {}) => {
		const currentQueue = queueRef.current;
		if (currentQueue.length === 0) return;
		if (queueIndexRef.current >= currentQueue.length - 1) {
			// End of the queue: stop unless repeating the whole queue.
			if (!wrap) return;
			if (isShuffleRef.current && currentQueue.length > 1) {
				// Loop with a fresh shuffle each pass: keep the first track
				// (the next one up) in place and reshuffle the rest.
				const reshuffled = [currentQueue[0], ...shuffleArray(currentQueue.slice(1))];
				updateQueue(reshuffled, 0);
				startTrack(reshuffled[0]);
				return;
			}
			updateQueue(currentQueue, 0);
			startTrack(currentQueue[0]);
			return;
		}
		// The queue tail is already shuffled while shuffle is on, so the next
		// track is simply the one after the current position.
		const nextIdx = queueIndexRef.current + 1;
		updateQueue(currentQueue, nextIdx);
		startTrack(currentQueue[nextIdx]);
	};
	nextTrackRef.current = nextTrack;

	const prevTrack = () => {
		if ((audioRef.current?.currentTime ?? 0) > 3) {
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

	useEffect(() => {
		if (!("mediaSession" in navigator)) return undefined;
		const { mediaSession } = navigator;
		const audio = audioRef.current;

		const resumePlayback = () => {
			if (!audio) return;
			if (!audio.src && currentTrackRef.current) {
				const source = resolvePlaybackSource(currentTrackRef.current);
				if (source.src) {
					audio.src = source.src;
					localPlaybackRef.current = source.isLocal;
				}
			}
			if (audio.src) audio.play().catch(() => { });
		};
		const pausePlayback = () => pauseAllAudio();
		const stopPlayback = () => {
			if (!audio) return;
			pauseAllAudio();
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

	// ---- Windows taskbar thumbnail toolbar (previous / play-pause / next) ----
	// The native buttons are registered in src-tauri (lib.rs) and emit "thumbar:*" app events on click; they are handled here through the same action refs the OS media keys use.
	useEffect(() => {
		if (!isTauri()) return undefined;
		let disposed = false;
		const unlisteners = [];
		const handle = (action) => () => mediaActionsRef.current[action]?.();

		listen("thumbar:toggle", handle("togglePlay"))
			.then((unlisten) => {
				if (disposed) unlisten();
				else unlisteners.push(unlisten);
			})
			.catch(() => { });
		listen("thumbar:next", handle("nextTrack"))
			.then((unlisten) => {
				if (disposed) unlisten();
				else unlisteners.push(unlisten);
			})
			.catch(() => { });
		listen("thumbar:previous", handle("prevTrack"))
			.then((unlisten) => {
				if (disposed) unlisten();
				else unlisteners.push(unlisten);
			})
			.catch(() => { });

		return () => {
			disposed = true;
			unlisteners.forEach((unlisten) => unlisten());
		};
	}, []);

	// Keeps the toolbar's play/pause button icon (and the enabled state of all three buttons) in sync with playback. No-ops on non-Windows platforms.
	useEffect(() => {
		if (!isTauri()) return;
		const hasTrack = Boolean(currentTrack);
		Promise.all([
			updateThumbarButton({ id: 1, enabled: hasTrack }),
			updateThumbarButton({
				id: 2,
				enabled: hasTrack,
				icon: isPlaying ? "icons/thumbar/pause.ico" : "icons/thumbar/play.ico",
				tooltip: isPlaying ? "Pause" : "Play",
			}),
			updateThumbarButton({ id: 3, enabled: hasTrack }),
		]).catch(() => {
			// Thumbar not initialized (e.g. non-Windows platform); ignore.
		});
	}, [currentTrack, isPlaying]);

	// Toggling shuffle reorders the queue itself instead of letting track-end
	// randomly pick the next track. The whole queue is shuffled — already
	// played tracks included — with the current track kept playing and placed
	// first, so every track comes up again in random order. Turning shuffle
	// off restores the order the queue had when shuffle was enabled.
	const toggleShuffle = () => {
		const enabling = !isShuffle;
		setIsShuffle(enabling);
		isShuffleRef.current = enabling;

		const currentQueue = queueRef.current;
		const index = queueIndexRef.current;
		if (currentQueue.length < 2) return;

		if (enabling) {
			originalQueueOrderRef.current = currentQueue;
			if (index >= 0) {
				// Something is playing: keep the current track in place and
				// shuffle the entire rest of the queue after it.
				updateQueue(
					[currentQueue[index], ...shuffleArray(currentQueue.filter((_, i) => i !== index))],
					0,
				);
			} else {
				// Nothing is playing yet: shuffle the whole queue.
				updateQueue(shuffleArray(currentQueue), -1);
			}
		} else if (originalQueueOrderRef.current) {
			const restored = [...originalQueueOrderRef.current];
			const currentId = currentTrackRef.current?.id;
			originalQueueOrderRef.current = null;
			updateQueue(restored, currentId
				? restored.findIndex((track) => track.id === currentId)
				: queueIndexRef.current);
		}
	};
	// Cycles repeat: off → all (loop queue) → one (loop track) → off.
	const toggleRepeat = () => setRepeatMode((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));

	// Format: [<playing or paused>] Track Title — Artist — Sonara
	const title = currentTrack?.title
		? `[${isPlaying ? "PLAYING" : "PAUSED"}] ${currentTrack.title} — ${currentTrack.artist} — Sonara`
		: "Sonara";

	return (
		<PlayerContext.Provider
			value={{
				currentTrack,
				isPlaying,
				volume,
				isMuted,
				isShuffle,
				repeatMode,
				crossfadeDuration,
				setCrossfadeDuration,
				queue,
				queueIndex,
				playbackSource,
				setPlaybackSource,
				playTrack,
				playNow,
				playNext,
				playLast,
				addToQueue,
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
			volume: 85,
			isMuted: false,
			isShuffle: false,
			repeatMode: "off",
			crossfadeDuration: 0,
			setCrossfadeDuration: () => { },
			queue: [],
			queueIndex: -1,
			playbackSource: null,
			setPlaybackSource: () => { },
			togglePlay: () => { },
			playTrack: () => { },
			playNow: () => { },
			playNext: () => { },
			playLast: () => { },
			addToQueue: () => { },
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
