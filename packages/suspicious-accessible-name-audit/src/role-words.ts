/**
 * The words a language uses for each kind of control, keyed by ISO 639-1 language code and then by
 * computed role. Lower case, compared against the end of the accessible name.
 */
export const ROLE_WORDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
	en: {
		button: ["button"],
		link: ["link"],
		checkbox: ["checkbox", "check box"],
		radio: ["radio button", "radio"],
		switch: ["switch", "toggle"],
		slider: ["slider"],
		textbox: ["textbox", "text box", "text field", "input", "field"],
		combobox: ["dropdown", "combobox", "select"],
		tab: ["tab"],
		menuitem: ["menu item"],
		dialog: ["dialog", "modal"],
		iframe: ["iframe", "frame"],
	},
	sv: {
		button: ["knapp"],
		link: ["länk"],
		checkbox: ["kryssruta"],
		radio: ["radioknapp"],
		textbox: ["textfält"],
		combobox: ["rullgardinsmeny"],
		tab: ["flik"],
		dialog: ["dialogruta"],
	},
	nb: {
		button: ["knapp"],
		link: ["lenke"],
		checkbox: ["avkrysningsboks"],
		radio: ["radioknapp"],
		textbox: ["tekstfelt"],
		combobox: ["nedtrekksmeny"],
		tab: ["fane"],
		dialog: ["dialogboks"],
	},
};

// Norwegian pages declare any of these, and Bokmål and Nynorsk share the list.
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = { no: "nb", nn: "nb" };

// Roles that share a list with a role screen readers announce the same way.
const ROLE_ALIASES: Readonly<Record<string, string>> = {
	searchbox: "textbox",
	spinbutton: "textbox",
	listbox: "combobox",
	menuitemcheckbox: "menuitem",
	menuitemradio: "menuitem",
	alertdialog: "dialog",
};

/**
 * The role words for a page in `lang`: that language's lists, or English when there are none.
 */
export function roleWordsFor(lang: string | null): Readonly<Record<string, readonly string[]>> {
	const primary = lang?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
	const language = LANGUAGE_ALIASES[primary] ?? primary;

	return ROLE_WORDS[language] ?? ROLE_WORDS.en!;
}

/**
 * The words in `roleWords` for an element with the computed `role`.
 */
export function wordsForRole(
	roleWords: Readonly<Record<string, readonly string[]>>,
	role: string,
): readonly string[] {
	return roleWords[ROLE_ALIASES[role] ?? role] ?? [];
}
