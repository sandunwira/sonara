import { Component } from "react";
import { recordAppLog } from "../services/jellyfinCache";

export default class AppErrorBoundary extends Component {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error, errorInfo) {
		recordAppLog("critical", "react", error.message, {
			stack: error.stack,
			componentStack: errorInfo.componentStack,
		});
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-screen items-center justify-center bg-[#0a0a0d] p-8 text-center text-zinc-200">
					<div>
						<h1 className="text-lg font-semibold">Sonara encountered an error</h1>
						<p className="mt-2 text-sm text-zinc-400">The error was saved for troubleshooting. Restart the app to continue.</p>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
