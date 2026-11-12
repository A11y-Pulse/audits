/**
 * Computed-style properties that are likely to draw a visible focus indicator. Layout properties
 * like margin and padding are deliberately excluded. `opacity` is here both because a change to it
 * is visible and because an element at opacity 0 cannot show an indicator of its own.
 * `outline-offset` says whether an outline is drawn outside the element or inside it.
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
	"opacity",
	"outline-color",
	"outline-offset",
	"outline-style",
	"outline-width",
	"text-decoration",
] as const;
