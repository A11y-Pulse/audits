/**
 * Computed-style properties that are likely to draw a visible focus indicator. Layout properties
 * like margin and padding are deliberately excluded.
 */
export const FOCUS_STYLE_PROPERTIES = [
	"background-color",
	"background-image",
	"border-bottom-color",
	"border-bottom-style",
	"border-bottom-width",
	"border-left-color",
	"border-left-style",
	"border-left-width",
	"border-right-color",
	"border-right-style",
	"border-right-width",
	"border-top-color",
	"border-top-style",
	"border-top-width",
	"box-shadow",
	"color",
	"font-weight",
	"outline-color",
	"outline-style",
	"outline-width",
	"text-decoration",
] as const;
