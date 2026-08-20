export type ReflowBucket = "pass" | "violation" | "incomplete";

export type ReflowOffender = {
	selector: string;
	html: string;
	overflowPx: number;
	reason: "element-overflow" | "fixed-width-container";
};

export type ReflowResult = {
	viewport: { width: number; height: number };
	restored: boolean;
	unsettled: boolean;
	alreadyNarrow: boolean;
	documentOverflowPx: number;
	bucket: ReflowBucket;
	offenders: ReflowOffender[];
};
