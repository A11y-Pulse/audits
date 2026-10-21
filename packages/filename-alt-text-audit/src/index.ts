export type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
export type { FilenameAltTextOptions } from "./audit";
export { DEFAULT_IMAGE_LIMIT, DEFAULT_REPORT_LIMIT, runFilenameAltTextAudit } from "./audit";
export type { AltTextMatch, AltTextSignal } from "./classify";
export { classifyAltText } from "./classify";
export { PLACEHOLDER_WORDS, placeholderWordsFor } from "./placeholder-words";
export type { FilenameAltTextImage, FilenameAltTextResult } from "./result";
export { filenameOf, parseSrcset } from "./sources";
