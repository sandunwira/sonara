import { useEffect } from 'react';

function ContextMenu() {
	const handleContextMenu = async (event) => {
		event.preventDefault();
	};

	useEffect(() => {
		document.addEventListener('contextmenu', handleContextMenu);

		return () => {
			document.removeEventListener('contextmenu', handleContextMenu);
		};
	}, []);

	return null;
}

export default ContextMenu;