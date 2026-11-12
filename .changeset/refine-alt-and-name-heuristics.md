---
"@a11y-pulse/filename-alt-text-audit": minor
"@a11y-pulse/suspicious-accessible-name-audit": minor
"@a11y-pulse/audit-runner": patch
---

Refine the alt text and accessible name heuristics.

`filename-alt-text-audit`:

- Reads lazy-loading sources (`data-src`, `data-lazy-src`, `data-original`, `data-srcset`, `data-lazy-srcset`) and the CSS background of `role="img"` elements.
- Matches the filename as it was uploaded, before a CMS or bundler added `-300x200`, `-scaled`, `@2x` or a content hash.
- Checks `role="img"` elements with an `aria-label`, inline `<svg role="img">` titles and linked `<area>` elements, and skips images made presentational.
- Adds the `artefact` signal, a failure, for alt text that is `undefined`, `null` or `NaN` in exactly that spelling, `[object Object]`, or an unrendered template token, including one written across several lines.
- Stops reporting a single plain word that is also the filename ("GitHub" on `github.svg`), short numbers ("1", "2024") and "Pano 360".
- Reports where the text came from as `altTextSource`.
- Waits once, for up to 2 seconds in total, for the images it screenshots, instead of up to 2 seconds for each.

`suspicious-accessible-name-audit`:

- A name that matches the element's `id`, `class` or `name` is only reviewed when it comes from a visible `<label>`, `aria-labelledby` target or button value, and passes unless the value has a separator. A plain word that is also the `id`, `class` or `name` ("Title" on `id="title"`) no longer matches from any source. Only test-id attributes are compared among `data-*`.
- "True", "False", "Test", "Label", "Banner", "Element" and "Module" are reviewed rather than failed, and can be changed with the new `reviewWords` vocabulary list.
- A name that is nothing but a template token or `[object Object]` fails from any source, visible text included. A token among other words is reviewed rather than failed.
- Translation keys with a namespace or a camelCase or snake_case part, such as `nav.homeTitle` and `common:buttons.submit`, are reviewed as an `identifier-pattern`. Hosts, packages and file names pass.
- "undefined", "null" and "NaN" only fail in exactly that spelling.
- Template tokens are matched in time linear in the length of the name.
- "Please select" is no longer a role word.
- An inline SVG's `<title>` now counts towards the name of the control around it.
- `evidence` holds the matched template token, and the new `labelSelector` points at the labelling element of a flagged name. `classifyName` returns a `verdict`.
- Elements past `elementLimit` are counted without computing their names.

`audit-runner`: describes the new `artefact` alt text signal.
