const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const FRAME_INTERVAL_MS = 80;

const CLEAR_LINE = "\r\x1b[2K";

export type Spinner = {
	update: (text: string) => void;
	stop: () => void;
};

/**
 * Animate a single status line on `stream`. Does nothing when `stream` is not a terminal, so piped
 * or redirected output stays clean.
 */
export function createSpinner(stream: NodeJS.WriteStream): Spinner {
	if (!stream.isTTY) {
		return { update: () => {}, stop: () => {} };
	}

	let text = "";
	let frame = 0;

	const render = () => {
		stream.write(`${CLEAR_LINE}${FRAMES[frame]} ${text}`);
	};

	const timer = setInterval(() => {
		frame = (frame + 1) % FRAMES.length;
		render();
	}, FRAME_INTERVAL_MS);
	// A spinner that is never stopped must not keep the process alive.
	timer.unref();

	return {
		update: (next) => {
			text = next;
			render();
		},
		stop: () => {
			clearInterval(timer);
			stream.write(CLEAR_LINE);
		},
	};
}
