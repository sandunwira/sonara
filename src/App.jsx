import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import TitleBar from './layout/TitleBar';
import MainLayout from './layout/MainLayout';
import ContextMenu from './utils/ContextMenu';
import WindowFunctionalities from './utils/WindowFunctionalities';
import { PlayerProvider } from './context/PlayerContext';
import { JellyfinProvider } from './context/JellyfinContext';
import ServerModal from './components/modals/ServerModal';

import HomePage from "./pages/Home";
import FavoritesPage from "./pages/Favorites";
import AlbumsPage from "./pages/Albums";
import TracksPage from "./pages/Tracks";
import ArtistsPage from "./pages/Artists";
import GenresPage from "./pages/Genres";
import FoldersPage from "./pages/Folders";

function AppRoutes() {
	return (
		<JellyfinProvider>
			<PlayerProvider>
				<WindowFunctionalities />
				<ServerModal />

				<div className="h-screen flex flex-col bg-zinc-950 text-white/85 select-none">
					<Router>
						<TitleBar />
						<div className="flex-1 overflow-hidden">
							<ContextMenu />
							<Routes>
								<Route element={<MainLayout />}>
									<Route path="/" element={<HomePage />} />
									<Route path="/favorites" element={<FavoritesPage />} />
									<Route path="/albums" element={<AlbumsPage />} />
									<Route path="/albums/:albumId" element={<AlbumsPage />} />
									<Route path="/tracks" element={<TracksPage />} />
									<Route path="/artists" element={<ArtistsPage />} />
									<Route path="/artists/:artistId" element={<ArtistsPage />} />
									<Route path="/genres" element={<GenresPage />} />
									<Route path="/genres/:genreId" element={<GenresPage />} />
									<Route path="/folders" element={<FoldersPage />} />
									<Route path="/folders/:libraryId" element={<FoldersPage />} />
									<Route path="*" element={<Navigate to="/" replace />} />
								</Route>
							</Routes>
						</div>
					</Router>
				</div>
			</PlayerProvider>
		</JellyfinProvider>
	);
}

function App() {
	return (
		<>
			<div className="fixed top-0 left-0 w-screen h-screen">
				<AppRoutes />
			</div>

			<Toaster
				containerClassName="mb-24"
				position="bottom-center"
				toastOptions={{
					duration: 5000,
					style: {
						background: '#18181B', // zinc-800
						color: '#F4F4F5',      // zinc-100
						border: '1px solid #3F3F46', // zinc-700
						borderRadius: '0rem', // no border radius
						padding: '0.5rem 1rem',
						fontSize: '0.875rem', // text-sm
						userSelect: 'none',
					},
					success: {
						iconTheme: {
							primary: '#10B981', // emerald-500
							secondary: '#F4F4F5',
						},
					},
					error: {
						iconTheme: {
							primary: '#eF4444', // red-500
							secondary: '#F4F4F5',
						},
					},
					loading: {
						iconTheme: {
							primary: 'transparent',
							secondary: '#3B82F6', // blue-500
						},
					},
				}}
			/>
		</>
	);
}

export default App;
