import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import HomePage from "./pages/Home";

function AppRoutes() {
	return (
		<Router>
			<Routes>
				<Route path="/" element={<HomePage />} />
				<Route path="*" element={<Navigate to="/" />} />
			</Routes>
		</Router>
	);
}

function App() {
	return (
		<AppRoutes />
	);
}

export default App;
