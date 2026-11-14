import { fetchMusicLibraries, getRandomGenreColor } from "./jellyfin";
import { getStoredLibraryThumbnails, saveStoredLibraryThumbnail } from "./jellyfinCache";

const THUMBNAIL_SIZE = 400;

// Each library gets its own wave background: the color is derived deterministically from the library name (same palette as the genre cards), and the wave phase from the library id, so every library looks distinct while staying stable across sessions.
function hashString(value) {
	let hash = 0;
	const key = String(value || "");
	for (let index = 0; index < key.length; index += 1) {
		hash = key.charCodeAt(index) + ((hash << 5) - hash);
	}
	return Math.abs(hash);
}

// Three layered sine waves rise from the bottom of the square over the dark tile backdrop. Layer amplitudes/baselines are fixed; the phase varies per library so the shapes differ from one another.
function buildWaveSvg(color, phase) {
	const width = THUMBNAIL_SIZE;
	const height = THUMBNAIL_SIZE;
	const layers = [
		{ amplitude: 26, baseline: height * 0.62, opacity: 0.2, frequency: 1.5, phase: phase },
		{ amplitude: 20, baseline: height * 0.7, opacity: 0.4, frequency: 1.15, phase: 1.3 + phase },
		{ amplitude: 15, baseline: height * 0.79, opacity: 0.75, frequency: 1.8, phase: 2.7 + phase },
	];

	const paths = layers.map((layer) => {
		const steps = 48;
		const points = [];
		for (let step = 0; step <= steps; step += 1) {
			const x = (step / steps) * width;
			const y = layer.baseline
				+ Math.sin((step / steps) * Math.PI * 2 * layer.frequency + layer.phase) * layer.amplitude;
			points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
		}
		const d = `M0,${height} L${points.join(" L")} L${width},${height} Z`;
		return `<path d="${d}" fill="${color}" fill-opacity="${layer.opacity}"/>`;
	}).join("");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`
		+ ` viewBox="0 0 ${width} ${height}">`
		+ `<rect width="${width}" height="${height}" fill="#141419"/>`
		+ paths
		+ "</svg>";
}

// Generates and stores a square wave background for a library. Purely local and deterministic (no server requests): stored in the app database only, Jellyfin is never updated.
export async function generateLibraryThumbnail(library) {
	const color = getRandomGenreColor(library.title || library.name);
	const phase = (hashString(library.id) % 628) / 100;
	const svg = buildWaveSvg(color, phase);
	const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

	// The kind tag lets ensureLibraryThumbnails replace thumbnails made by older implementations (e.g. the former album-art collages).
	await saveStoredLibraryThumbnail(library.id, dataUrl, new Date().toISOString(), "wave");
	return dataUrl;
}

// Makes sure every music library has a wave background. Wave images are deterministic (color from the name, shape from the id), so they only need to be generated once per library. Returns true when the stored set changed, so callers can refresh the library list.
export async function ensureLibraryThumbnails(serverUrl, userId, token) {
	const [libraries, stored] = await Promise.all([
		fetchMusicLibraries(serverUrl, userId, token),
		getStoredLibraryThumbnails(),
	]);

	const missing = libraries.filter((library) => {
		const storedThumbnail = stored.get(library.id);
		// Thumbnails from older implementations (no "wave" kind) are regenerated with the current style.
		return !storedThumbnail || storedThumbnail.kind !== "wave";
	});
	if (missing.length === 0) return false;

	for (const library of missing) {
		try {
			await generateLibraryThumbnail(library);
		} catch (error) {
			console.error(`Failed to generate thumbnail for library "${library.title || library.name}":`, error);
		}
	}
	return true;
}
