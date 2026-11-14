import type {
	MotionKind,
	MovingContentFinding,
	MovingContentRegion,
	MovingContentResult,
} from "@a11y-pulse/moving-content-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	sortedResultToAxe,
} from "./audit-output";

export const MOVING_CONTENT_AUDIT_ID = "moving-content";

export const MOVING_CONTENT_EVIDENCE_CHECK_ID = "moving-content-evidence";

const METADATA: AuditMetadata = {
	id: MOVING_CONTENT_AUDIT_ID,
	help: "Moving content must have a way to pause, stop or hide it",
	description:
		"Ensures that content which starts moving on its own and keeps moving for more than five seconds can be paused, stopped or hidden (WCAG 2.2.2 Pause, Stop, Hide).",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/moving-content-audit#readme",
	impact: "serious",
	tags: ["wcag2a", "wcag222", "cat.time-and-media"],
};

const MOTION: Record<MotionKind, string> = {
	video: "This video plays on its own",
	marquee: "This <marquee> scrolls on its own",
	"css-animation": "This content is moved by a CSS animation that starts on its own",
	"web-animation": "This content is moved by a script-driven animation that starts on its own",
	script: "This content is moved by a script on a timer",
};

const FIX = "Add a control that pauses, stops or hides it";

const REVIEW: Partial<Record<MovingContentFinding, string>> = {
	"pauses-on-hover": `It pauses while the pointer is over it, which a keyboard user cannot do. ${FIX} that works from the keyboard.`,
	"pauses-on-focus":
		"It pauses while focus is inside it. Check that a keyboard user can find and use that, or add a visible pause control.",
	"small-region": `It is small, so check whether it is decoration. If it sits beside other content and keeps moving for more than five seconds, ${FIX.toLowerCase()}.`,
	"subtle-animation": `Only its colour or shading changes. If that reads as blinking or movement, ${FIX.toLowerCase()}.`,
	"changed-once": `It changed late in the observation window. If it keeps changing on a timer, ${FIX.toLowerCase()}.`,
	"pseudo-element": `Only a decoration drawn by its stylesheet (a pseudo-element) is animated, and its size could not be read. If more than a small mark keeps moving, ${FIX.toLowerCase()}.`,
	"finite-loop": `It stops after a set number of loops. If it moves for more than five seconds in total, ${FIX.toLowerCase()}.`,
	"uncertain-playback": `Its length could not be read. If it plays for more than five seconds, ${FIX.toLowerCase()} or show the browser's controls.`,
};

function describeAnimation(region: MovingContentRegion): string {
	const named = region.animations.find((animation) => animation.name);

	return named ? ` ("${named.name}")` : "";
}

function failureSummary(region: MovingContentRegion): string {
	const what = `${MOTION[region.motion]}${describeAnimation(region)}`;
	const seconds = (region.observedMs / 1000).toFixed(1);

	if (region.finding === "no-pause-control") {
		return `${what}, was still moving after ${seconds} seconds, and no control to pause, stop or hide it was found. ${FIX}.`;
	}

	return `${what} and no control to pause, stop or hide it was found. ${REVIEW[region.finding] ?? `${FIX}.`}`;
}

function toAuditNode(region: MovingContentRegion): AuditNode {
	const node: AuditNode = { selector: region.selector, html: region.html };
	const passed = region.finding === "pause-control" || region.finding === "native-controls";

	if (!passed) {
		node.failureSummary = failureSummary(region);
	}

	node.evidence = {
		id: MOVING_CONTENT_EVIDENCE_CHECK_ID,
		impact: "serious",
		message: region.pauseControl
			? `Moving content with the pause control "${region.pauseControl.name}" (${region.pauseControl.selector})`
			: passed
				? "Video with the browser's own controls"
				: "Moving content with no pause control found",
		data: {
			motion: region.motion,
			detectedBy: region.detectedBy,
			reason: region.finding,
			observedMs: region.observedMs,
			rect: region.rect,
			animations: region.animations,
			pauseControl: region.pauseControl,
			pausesOn: region.pausesOn,
			reducedMotion: region.reducedMotion,
			...(region.screenshot ? { screenshot: region.screenshot } : {}),
			...(region.laterScreenshot ? { laterScreenshot: region.laterScreenshot } : {}),
		},
	};

	return node;
}

export function movingContentToAxe(result: MovingContentResult): AuditOutput {
	return sortedResultToAxe(METADATA, result, toAuditNode);
}
