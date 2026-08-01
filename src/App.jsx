import { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";

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
