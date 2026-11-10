import { useNavigate } from "react-router-dom";
import { IconMusic, IconRefresh } from "@tabler/icons-react";
import GenresGrid from "../components/home/GenresGrid";
import AlbumCarousel from "../components/home/AlbumCarousel";
import { usePlayer } from "../context/PlayerContext";
import { useJellyfin } from "../context/JellyfinContext";
import useGenrePlayback from "../hooks/useGenrePlayback";

function HomePage() {
	const navigate = useNavigate();
	const { currentTrack, playTrack, playNext, playLast } = usePlayer();
	const {
		isAuthenticated,
		tracks,
		recentlyPlayed,
		genres,
		isLoading,
		refreshLibrary,
		refreshMostPlayed,
		refreshRecentlyPlayed,
		isRefreshingMostPlayed,
		isRefreshingRecentlyPlayed,
	} = useJellyfin();
	const {
		playGenre,
		pendingGenreIds,
		currentGenreNames,
		queueGenreNames,
		isPlaying,
		togglePlay,
	} = useGenrePlayback();

	// Limit to strictly 12 genres on the Home page
	const homeGenres = genres.slice(0, 12);
	const playFromSection = (item, items) => {
		const selectedIndex = items.findIndex((track) => track.id === item.id);
		playTrack(item, selectedIndex >= 0 ? items.slice(selectedIndex) : [item]);
	};

	return (
		<div className="flex flex-col space-y-7 pt-7">
			{isAuthenticated && tracks.length === 0 && !isLoading ? (
				<div className="mb-6 flex flex-col items-center justify-center rounded-xs border border-[#22222a] bg-[#121217] p-8 text-center">
					<div className="flex h-12 w-12 items-center justify-center rounded-xs bg-zinc-800 text-zinc-400 mb-3">
						<IconMusic size={24} />
					</div>
					<h3 className="text-sm font-semibold text-zinc-100">
						No music found on server
					</h3>
					<p className="text-xs text-zinc-400 max-w-sm mt-1 mb-4">
						Your connected Jellyfin server has no audio tracks, or the music library is still syncing.
					</p>
					<button
						type="button"
						onClick={refreshLibrary}
						className="flex items-center gap-1.5 rounded-xs border border-[#2b2b35] bg-[#181820] px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#20202a] hover:text-white"
					>
						<IconRefresh size={14} />
						Sync Library
					</button>
				</div>
			) : null}

			{/* Genres Section (Limited to 12) */}
			{homeGenres.length > 0 && (
				<GenresGrid
					genres={homeGenres}
					onViewMore={() => navigate("/genres")}
					onSelectGenre={(genre) => navigate(`/genres/${genre.id}`, { state: { title: genre.name } })}
					onPlayGenre={playGenre}
					onTogglePlay={togglePlay}
					isPlaying={isPlaying}
					pendingGenreIds={pendingGenreIds}
					currentGenreNames={currentGenreNames}
					queueGenreNames={queueGenreNames}
				/>
			)}

			{/* Most Played Carousel */}
			{tracks.length > 0 && (
				<AlbumCarousel
					title="Most Played"
					items={tracks}
					onRefresh={refreshMostPlayed}
					isRefreshing={isRefreshingMostPlayed}
					currentPlayingId={currentTrack?.id}
					isPlaying={isPlaying}
					onPlayItem={(item) => playFromSection(item, tracks)}
					onPlayNow={(item) => playFromSection(item, tracks)}
					onTogglePlay={togglePlay}
					onPlayNext={playNext}
					onPlayLast={playLast}
				/>
			)}

			{/* Recently Played Carousel */}
			{recentlyPlayed.length > 0 && (
				<AlbumCarousel
					title="Recently Played"
					items={recentlyPlayed}
					onRefresh={refreshRecentlyPlayed}
					isRefreshing={isRefreshingRecentlyPlayed}
					currentPlayingId={currentTrack?.id}
					isPlaying={isPlaying}
					onPlayItem={(item) => playFromSection(item, recentlyPlayed)}
					onPlayNow={(item) => playFromSection(item, recentlyPlayed)}
					onTogglePlay={togglePlay}
					onPlayNext={playNext}
					onPlayLast={playLast}
				/>
			)}
		</div>
	);
}

export default HomePage;
