import type { ElementInspection } from "../adaptor";

/** The part of a Chrome DevTools Protocol session this needs, as Puppeteer and Playwright expose it. */
export type CdpSession = {
	// biome-ignore lint/suspicious/noExplicitAny: protocol results are typed per method by each driver.
	send(method: any, params?: any): Promise<any>;
	detach(): Promise<unknown>;
};

const OBJECT_GROUP = "a11y-pulse-unreachable-controls";

type RemoteObject = { objectId?: string };

type PropertyDescriptor = { name: string; value?: RemoteObject };

/**
 * Ask Chromium which event listeners sit on each element of the array at `window[stashKey]`, and
 * the accessibility role of those listed in `roles`. An element the browser cannot answer for
 * comes back with no listeners and a null role.
 */
export async function inspectStashedElements(
	session: CdpSession,
	stashKey: string,
	count: number,
	roles: readonly number[],
): Promise<ElementInspection[]> {
	const inspections: ElementInspection[] = Array.from({ length: count }, () => ({
		listeners: [],
		role: null,
	}));

	try {
		const { result } = (await session.send("Runtime.evaluate", {
			expression: `window[${JSON.stringify(stashKey)}]`,
			objectGroup: OBJECT_GROUP,
		})) as { result: RemoteObject };

		if (!result.objectId) {
			return inspections;
		}

		const { result: properties } = (await session.send("Runtime.getProperties", {
			objectId: result.objectId,
			ownProperties: true,
		})) as { result: PropertyDescriptor[] };

		const objectIds = new Map<number, string>();

		for (const property of properties) {
			const index = Number(property.name);

			if (Number.isInteger(index) && index < count && property.value?.objectId) {
				objectIds.set(index, property.value.objectId);
			}
		}

		const wantsRole = new Set(roles);

		await Promise.all(
			Array.from(objectIds, async ([index, objectId]) => {
				const inspection = inspections[index];

				if (!inspection) {
					return;
				}

				try {
					const { listeners } = (await session.send("DOMDebugger.getEventListeners", {
						objectId,
					})) as { listeners: Array<{ type: string }> };

					inspection.listeners = [...new Set(listeners.map((listener) => listener.type))];
				} catch {
					// Left with no listeners.
				}

				if (!wantsRole.has(index)) {
					return;
				}

				try {
					const { nodes } = (await session.send("Accessibility.getPartialAXTree", {
						objectId,
						fetchRelatives: false,
					})) as { nodes: Array<{ ignored?: boolean; role?: { value?: unknown } }> };
					const node = nodes[0];

					if (node) {
						const role = node.role?.value;
						inspection.role = node.ignored ? "none" : typeof role === "string" ? role : null;
					}
				} catch {
					// Left with a null role.
				}
			}),
		);
	} finally {
		await session.send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP }).catch(() => {});
	}

	return inspections;
}
