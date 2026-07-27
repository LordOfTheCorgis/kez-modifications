import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "strong", "em", "del", "code", "pre", "blockquote",
    "ul", "ol", "li", "h2", "h3", "h4", "a",
  ],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    // Pack pages already have an h1; demote authored headings below it.
    h1: "h2",
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
  },
};

/** Markdown → sanitized HTML, safe to inject with set:html. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false });
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Markdown → plain text (for meta descriptions and previews). */
export function markdownToPlainText(markdown: string): string {
  const html = marked.parse(markdown, { async: false });
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}
