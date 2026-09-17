/**
 * A doubleRAF that aims to wait until the page has painted the next frame.
 */
export function nextPaintScript(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}
