import type { SessionEndReason, TabSessionHandle } from "./types";

export const DEFAULT_ELEMENT_LIMIT = 1024;
export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33; // ~2 frames at 60fps
export const DEFAULT_FAILED_ELEMENT_LIMIT = 0; // 0 = never finish early
export const DEFAULT_TIMEOUT = 0; // 0 = no timeout

export type BaseAuditOptions = {
	/** Max focusable elements to tab through. */
	elementLimit?: number;
	/** How long to wait (ms) after each Tab for the page to settle. */
	screenshotSettleDelay?: number;
	/** Disconnect early after this many elements fail (0 = never). */
	failedElementLimit?: number;
	/** Return whatever's gathered so far after this many ms (0 = no timeout). */
	timeout?: number;
};

export type BaseAuditSummary = {
	checked: number;
	passed: number;
	failed: number;
	/** True if the element limit was hit before tabbing finished. */
	reachedLimit: boolean;
	/** True if the audit stopped early after hitting `failedElementLimit`. */
	reachedFailedElementLimit: boolean;
	/**
	 * True if the audit returned early because `timeout` elapsed. The results
	 * are whatever had been gathered when the deadline hit.
	 */
	timedOut: boolean;
	/**
	 * Why the tab session ended, or `null` when this consumer disconnected
	 * itself (element limit, failed-element limit, or timeout).
	 */
	sessionEnd: SessionEndReason | null;
};

export type AuditSelfDisconnect = {
	/** True once this consumer has disconnected itself from the session. */
	readonly disconnectedSelf: boolean;
	/** Arm a timeout that calls `onTimeout` then disconnects, if `timeout` is greater than 0. */
	armTimeout(
		timeout: number,
		session: TabSessionHandle,
		onTimeout: () => void,
	): void;
	/** Disconnect the session and record that this consumer initiated it. */
	disconnect(session: TabSessionHandle): void;
	/** Clear any pending timeout without disconnecting. */
	clear(): void;
};

/**
 * Tracks the clearTimer/disconnectSelf pattern shared by every audit
 * consumer: an optional timeout that self-disconnects, plus the flag
 * `onSessionEnd` needs to tell a self-initiated disconnect apart from the
 * session ending for some other reason.
 */
export function createAuditSelfDisconnect(): AuditSelfDisconnect {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disconnectedSelf = false;

	const clear = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	};

	const disconnect = (session: TabSessionHandle): void => {
		disconnectedSelf = true;
		clear();
		session.disconnect();
	};

	return {
		get disconnectedSelf() {
			return disconnectedSelf;
		},
		armTimeout(timeout, session, onTimeout) {
			if (timeout > 0) {
				timer = setTimeout(() => {
					timer = undefined;
					onTimeout();
					disconnect(session);
				}, timeout);
			}
		},
		disconnect,
		clear,
	};
}
