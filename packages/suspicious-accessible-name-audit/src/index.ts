export type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
export type { SuspiciousNameOptions } from "./audit";
export { DEFAULT_ELEMENT_LIMIT, DEFAULT_REPORT_LIMIT, runSuspiciousNameAudit } from "./audit";
export type { Identifier, NameSource } from "./browser-scripts";
export type { NameMatch, NameSignal, NameToClassify } from "./classify";
export { classifyName } from "./classify";
export type { WcagCriterion } from "./criterion";
export { wcagCriterion } from "./criterion";
export type { SuspiciousNameElement, SuspiciousNameResult } from "./result";
export { ROLE_WORDS, roleWordsFor } from "./role-words";
export type { RoleWords, Vocabulary, VocabularyOverride } from "./vocabulary";
export {
	DEFAULT_ARTEFACTS,
	DEFAULT_VOCABULARY,
	PLACEHOLDER_STEMS,
	resolveVocabulary,
} from "./vocabulary";
