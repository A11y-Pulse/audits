/**
 * Stock alt text that CMSes default to or authors type to silence a required field, keyed by ISO
 * 639-1 language code. Lower case, compared against the whole alt text.
 */
export const PLACEHOLDER_WORDS: Readonly<Record<string, readonly string[]>> = {
	en: [
		"image",
		"images",
		"photo",
		"photograph",
		"picture",
		"pic",
		"img",
		"graphic",
		"icon",
		"logo",
		"banner",
		"thumbnail",
		"screenshot",
		"untitled",
		"placeholder",
		"alt",
		"alt text",
		"image description",
		"spacer",
		"blank",
	],
	sv: ["bild", "foto", "fotografi", "bildtext", "ikon", "logotyp", "namnlös", "platshållare"],
	de: ["bild", "foto", "grafik", "symbol", "logo", "vorschaubild", "unbenannt", "platzhalter"],
	fr: ["image", "photo", "illustration", "icône", "logo", "vignette", "sans titre"],
	es: ["imagen", "foto", "fotografía", "icono", "logo", "logotipo", "miniatura", "sin título"],
	it: [
		"immagine",
		"foto",
		"fotografia",
		"icona",
		"logo",
		"miniatura",
		"senza titolo",
		"segnaposto",
	],
	nl: ["afbeelding", "foto", "plaatje", "pictogram", "icoon", "logo", "naamloos"],
	nb: ["bilde", "foto", "ikon", "logo", "uten tittel", "plassholder"],
	da: ["billede", "foto", "ikon", "logo", "unavngivet", "pladsholder"],
	fi: ["kuva", "valokuva", "kuvake", "logo", "nimetön", "paikkamerkki"],
};

// Norwegian pages declare any of these, and Bokmål and Nynorsk share the list.
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = { no: "nb", nn: "nb" };

/**
 * The placeholder words that apply to a page in `lang`: that language's list and English.
 */
export function placeholderWordsFor(lang: string | null): ReadonlySet<string> {
	const primary = lang?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
	const language = LANGUAGE_ALIASES[primary] ?? primary;

	// English CMS defaults leak into every locale.
	return new Set([...(PLACEHOLDER_WORDS.en ?? []), ...(PLACEHOLDER_WORDS[language] ?? [])]);
}
