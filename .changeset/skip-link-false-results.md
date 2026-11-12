---
"@a11y-pulse/skip-link-audit": minor
"@a11y-pulse/audit-runner": patch
---

Reduce false results from the skip link audit.

- Skip links whose target has nothing focusable inside (`<h1 id>`, an empty `<a id>`) now pass when the next Tab lands after the target.
- Menu toggles and other in-page links are no longer treated as skip links: a link without skip wording counts only when its target is the page's main content (a heading, the `main` landmark or around it, or a conventional id such as `content`), is rendered and is not a navigation block. Links with `aria-expanded`, `role="tab"` or `role="button"` are never activated.
- Skip wording is matched on whole words in the link's text and `aria-label`, and "go to" verbs need a content or navigation noun, so "Popular posts" or "Aller au panier" no longer count. `class` and `id` only count when they are a skip token such as `skip-link`.
- Script-driven skip links whose fragment matches nothing are activated and pass when focus moves to later content.
- Same-document links written as `/page#main` or an absolute URL are recognised.
- A target that is not rendered is reported as `target-hidden`, and fragments no longer resolve to form controls or meta tags that share the name.
- Skip links that can never receive focus are reported under the new `unreachable` field.
- Results now carry the link text, the target, and where focus went after Enter and after the follow-up Tab.
- The URL, `:target` and scroll position are restored after each activation, and when the audit ends focus is dropped and the next Tab press starts from the first tab stop again, whether or not a skip link was found. The history entry added by following a fragment link remains as a forward entry.
