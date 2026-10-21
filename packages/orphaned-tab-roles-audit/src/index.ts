export type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
export type { OrphanedTabRolesOptions } from "./audit";
export { DEFAULT_REPORT_LIMIT, runOrphanedTabRolesAudit } from "./audit";
export type { CollectedTabRole, TabRole } from "./browser-scripts";
export type { TabRoleClassification, TabRoleFinding, TabRoleVerdict } from "./classify";
export { classifyTabRoles } from "./classify";
export type { OrphanedTabRolesElement, OrphanedTabRolesResult } from "./result";
