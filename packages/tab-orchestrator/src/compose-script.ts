import type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";

// biome-ignore lint/suspicious/noExplicitAny: page scripts take whatever arguments they declare.
type PageScript = (...args: any[]) => unknown;

export type ScriptParts = Record<string, PageScript>;

/**
 * What a composed script's body uses to reach its parts. The same body runs in two places: inside
 * the page, where a part is a plain function call, and on the host, where each part is its own
 * `adaptor.evaluate()`. A body must therefore go through this context for everything, and, because
 * it is serialised into the page, must not reference anything outside its own scope.
 */
export type ScriptContext<P extends ScriptParts, H> = {
	/** `null` inside the page. On the host, whatever the caller offered that only a host can do. */
	readonly host: H | null;
	/** Run the part `name`. Element arguments are elements in the page and handles on the host. */
	// biome-ignore lint/suspicious/noExplicitAny: each part's own signature says what it returns.
	call(name: keyof P, ...args: unknown[]): Promise<any>;
	/** Run the part `name`, which returns an element, and keep hold of that element. */
	handle(name: keyof P): Promise<ElementRef>;
	/** Let go of an element `handle()` returned. */
	release(ref: ElementRef): Promise<void>;
	sleep(ms: number): Promise<void>;
	/** Whether `error` is the page having navigated away. Never true inside the page. */
	isDestroyed(error: unknown): boolean;
};

export type ScriptBody<P extends ScriptParts, A, R, H> = (
	ctx: ScriptContext<P, H>,
	args: A,
	...refs: ElementRef[]
) => Promise<R>;

export type ComposedScript<P extends ScriptParts, A, R, H> = {
	parts: P;
	body: ScriptBody<P, A, R, H>;
	/**
	 * The body and every part as one self-contained function, for a single `evaluate()`. Built the
	 * first time it is read, and throws then on a host that forbids building code from strings.
	 */
	readonly pageFunction: (args: A, ...refs: ElementRef[]) => Promise<R>;
};

/**
 * Join page scripts into one that runs them all in a single round trip to the browser. `body`
 * decides which parts run and what comes back; it is written once and runs either in the page or
 * on the host (see `runComposed`).
 */
export function composeScript<P extends ScriptParts, A, R, H = Record<string, never>>(
	parts: P,
	body: ScriptBody<P, A, R, H>,
): ComposedScript<P, A, R, H> {
	type PageFunction = ComposedScript<P, A, R, H>["pageFunction"];

	let built: PageFunction | undefined;

	const build = (): PageFunction => {
		const partSources = Object.entries(parts)
			.map(([name, fn]) => `${JSON.stringify(name)}: (${fn.toString()})`)
			.join(",\n");

		// The page's own setTimeout cannot be relied on to fire (fake timers, a mocked clock), so a
		// wait also ends on the first animation frame past its time, whichever comes first.
		const source = `
const parts = {
${partSources}
};
const ctx = {
	host: null,
	call: async (name, ...values) => parts[name](...values),
	handle: async (name) => parts[name](),
	release: async () => {},
	sleep: (ms) => new Promise((resolve) => {
		const due = performance.now() + ms;
		let done = false;
		const finish = () => {
			if (!done) {
				done = true;
				resolve();
			}
		};
		const frame = () => {
			if (done) {
				return;
			}
			if (performance.now() >= due) {
				finish();
			} else {
				requestAnimationFrame(frame);
			}
		};
		try {
			setTimeout(finish, ms);
		} catch {}
		try {
			requestAnimationFrame(frame);
		} catch {}
	}),
	isDestroyed: () => false,
};
return (${body.toString()})(ctx, args, ...refs);`;

		// Built on the host, where no Content-Security-Policy applies. The page only ever receives
		// the resulting function the way it receives any other script.
		return new Function("args", "...refs", source) as PageFunction;
	};

	return {
		parts,
		body,
		// Not built until a session first sends it: importing this package must not need the host to
		// allow code generation from strings, which only composing does.
		get pageFunction(): PageFunction {
			built ??= build();

			return built;
		},
	};
}

/** A composed script did not come back from the page within the time the host allowed it. */
export class ComposedTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`A composed page script did not finish within ${timeoutMs}ms`);
		this.name = "ComposedTimeoutError";
	}
}

/**
 * How long a composed script may run in the page when the caller names no limit. Far longer than
 * any wait a script makes: it only exists so that a page where neither timers nor animation frames
 * fire fails the call instead of hanging it.
 */
export const DEFAULT_COMPOSED_TIMEOUT_MS = 30_000;

export type RunComposedOptions<H> = {
	/** Send the whole script in one `evaluate()`. Otherwise each part is its own call. */
	composed: boolean;
	host?: H;
	isDestroyed?: (error: unknown) => boolean;
	/**
	 * Longest a composed call may take before it is abandoned with a `ComposedTimeoutError`. The
	 * script's waits happen inside the page, where the host cannot otherwise bound them. Defaults to
	 * `DEFAULT_COMPOSED_TIMEOUT_MS`; has no bearing on a script run one part at a time.
	 */
	timeoutMs?: number;
};

/**
 * Run a composed script: as one call into the page when `composed`, or with the body on the host
 * making one call per part, which is what an adaptor that cannot take a composed function gets.
 */
export async function runComposed<P extends ScriptParts, A, R, H>(
	adaptor: BrowserAdaptor,
	script: ComposedScript<P, A, R, H>,
	options: RunComposedOptions<H>,
	args: A,
	...refs: ElementRef[]
): Promise<R> {
	if (options.composed) {
		const timeoutMs = options.timeoutMs ?? DEFAULT_COMPOSED_TIMEOUT_MS;
		const call = Promise.resolve(adaptor.evaluate(script.pageFunction, args, ...refs));
		let timer: ReturnType<typeof setTimeout> | undefined;

		const expiry = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new ComposedTimeoutError(timeoutMs)), timeoutMs);
		});

		// An abandoned call still settles one day, typically by rejecting when the page goes away.
		call.catch(() => {});

		try {
			return await Promise.race([call, expiry]);
		} finally {
			clearTimeout(timer);
		}
	}

	const ctx: ScriptContext<P, H> = {
		host: options.host ?? ({} as H),
		call: (name, ...values) => adaptor.evaluate(script.parts[name] as PageScript, ...values),
		handle: (name) => adaptor.evaluateHandle(script.parts[name] as () => Element | null),
		release: (ref) => adaptor.disposeRef(ref),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		isDestroyed: options.isDestroyed ?? (() => false),
	};

	return script.body(ctx, args, ...refs);
}
