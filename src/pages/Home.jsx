import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function HomePage() {
	const [greetMsg, setGreetMsg] = useState("");
	const [name, setName] = useState("");

	async function greet() {
		setGreetMsg(await invoke("greet", { name }));
	}

	return (
		<div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100 antialiased">
			<div className="pointer-events-none absolute inset-0">
				<div className="absolute -top-32 left-1/2 h-96 w-xl -translate-x-1/2 rounded-full bg-zinc-100/4 blur-3xl" />
				<div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-size-[4rem_4rem]" />
			</div>

			<div className="relative mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-16">
				<h1 className="text-center text-6xl font-medium tracking-tight text-zinc-50 sm:text-7xl">
					Welcome to
					<span className="mt-2 block bg-linear-to-b from-zinc-50 to-zinc-500 bg-clip-text text-transparent">
						Tauri + React
					</span>
				</h1>

				<p className="mt-8 max-w-md text-center text-sm leading-relaxed text-zinc-400">
					A minimal desktop app powered by Tauri, built with React and styled
					with Tailwind CSS.
				</p>

				<div className="mt-12 flex items-center gap-3">
					{[
						{ href: "https://vite.dev", src: "/vite.svg", alt: "Vite" },
						{ href: "https://tauri.app", src: "/tauri.svg", alt: "Tauri" },
						{ href: "https://react.dev", src: "/src/assets/react.svg", alt: "React" },
					].map((logo) => (
						<a
							key={logo.alt}
							href={logo.href}
							target="_blank"
							rel="noreferrer"
							title={`Click to learn more about ${logo.alt}`}
							className="group flex h-12 w-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 p-3 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-zinc-500 hover:bg-zinc-800"
						>
							<img
								src={logo.src}
								alt={`${logo.alt} logo`}
								className="h-full w-full object-contain opacity-70 transition duration-300 group-hover:opacity-100"
							/>
						</a>
					))}
				</div>

				<form
					className="mt-14 flex w-full max-w-sm items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 p-1.5 pl-5 backdrop-blur transition focus-within:border-zinc-500"
					onSubmit={(e) => {
						e.preventDefault();
						greet();
					}}
				>
					<input
						id="greet-input"
						value={name}
						onChange={(e) => setName(e.currentTarget.value)}
						placeholder="Enter a name..."
						className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 outline-none"
					/>
					<button
						type="submit"
						className="shrink-0 rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-950 transition duration-300 hover:bg-white active:scale-95"
					>
						Greet
					</button>
				</form>

				{greetMsg && (
					<p className="mt-6 rounded-full border border-zinc-800 bg-zinc-900/60 px-5 py-2 text-sm text-zinc-300 backdrop-blur">
						{greetMsg}
					</p>
				)}
			</div>
		</div>
	);
}

export default HomePage;
