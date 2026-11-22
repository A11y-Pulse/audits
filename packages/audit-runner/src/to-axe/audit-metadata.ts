import type { AuditMetadata } from "./audit-output";
import { METADATA as contextChangeOnFocus } from "./context-change-on-focus";
import { METADATA as disclosureOperability } from "./disclosure-operability";
import { METADATA as filenameAltText } from "./filename-alt-text";
import { METADATA as focusAppearance } from "./focus-appearance";
import { METADATA as focusColorOnly } from "./focus-color-only";
import { METADATA as focusIndicatorContrast } from "./focus-indicator-contrast";
import { METADATA as focusNotObscured } from "./focus-not-obscured";
import { METADATA as focusOrder } from "./focus-order";
import { METADATA as keyboardTrap } from "./keyboard-trap";
import { METADATA as movingContent } from "./moving-content";
import { METADATA as orphanedTabRoles } from "./orphaned-tab-roles";
import { METADATA as pasteBlocking } from "./paste-blocking";
import { METADATA as reflow } from "./reflow";
import { METADATA as resizeText } from "./resize-text";
import { METADATA as skipLink } from "./skip-link";
import { METADATA as suspiciousAccessibleName } from "./suspicious-accessible-name";
import { METADATA as textSpacing } from "./text-spacing";
import {
	ROLE as controlWithoutRole,
	REACHABILITY as keyboardReachability,
} from "./unreachable-controls";

/** What an audit says about itself whatever it finds: its name, description and help page. */
export type AuditDescription = Pick<AuditMetadata, "id" | "help" | "description" | "helpUrl">;

/** Each converted audit's description, keyed by audit ID. */
export const AUDIT_METADATA: Readonly<Record<string, AuditDescription>> = Object.fromEntries(
	[
		contextChangeOnFocus,
		disclosureOperability,
		filenameAltText,
		focusAppearance,
		focusColorOnly,
		focusIndicatorContrast,
		focusNotObscured,
		focusOrder,
		keyboardTrap,
		movingContent,
		orphanedTabRoles,
		pasteBlocking,
		reflow,
		resizeText,
		skipLink,
		suspiciousAccessibleName,
		textSpacing,
		keyboardReachability,
		controlWithoutRole,
	].map(({ id, help, description, helpUrl }) => [id, { id, help, description, helpUrl }]),
);
