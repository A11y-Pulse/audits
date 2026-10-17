import type { PageGroup } from "../expectations";
import { content } from "./content";
import { dialogs } from "./dialogs";
import { forms } from "./forms";
import { interaction } from "./interaction";
import { layout } from "./layout";
import { reordering } from "./reordering";
import { site } from "./site";

export const GROUPS: readonly PageGroup[] = [
	interaction,
	content,
	layout,
	reordering,
	dialogs,
	forms,
	site,
];
