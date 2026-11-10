import { createContext, useContext, useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useJellyfin } from "./JellyfinContext";
import { getAudioStreamUrl, getImageUrl } from "../services/jellyfin";
import { getStoredPlayerQueue, saveStoredPlayerQueue, recordAppLog } from "../services/jellyfinCache";

const PlayerContext = createContext();

function restoreSavedQueue(saved, session) {
	if (!saved || !Array.isArray(saved.queue)) {
		return { queue: [], queueIndex: -1, currentTrack: null };
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

	return { queue, queueIndex, currentTrack };
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
			queue: queue.map(({ id, title, artist, album, albumId, duration, isJellyfin }) => ({
				id, title, artist, album, albumId, duration, isJellyfin,
			})),
			queueIndex,
			currentTrackId: currentTrack?.id || null,
		}).catch((error) => {
			console.error("Could not save playback queue to the database:", error);
			toast.error("Could not save playback queue");
		});
	}, [queue, queueIndex, currentTrack]);

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

	const toggleShuffle = () => setIsShuffle((prev) => !prev);
	const toggleRepeat = () => setIsRepeat((prev) => !prev);

	// Format: [<playing or paused>] Track Title — Artist — Sonara
	const title = currentTrack?.title
		? `[${isPlaying ? "Playing" : "Paused"}] ${currentTrack.title} — ${currentTrack.artist} — Sonara`
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
