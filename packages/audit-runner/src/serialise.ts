const JSON_INDENT = 2;

export function base64Replacer(this: unknown, key: string, value: unknown): unknown {
	const rawBeforeToJson = (this as Record<string, unknown> | undefined)?.[key];

	if (rawBeforeToJson instanceof Uint8Array) {
		return Buffer.from(rawBeforeToJson).toString("base64");
	}

	return value;
}

export function toJson(value: unknown): string {
	return JSON.stringify(value, base64Replacer, JSON_INDENT);
}
