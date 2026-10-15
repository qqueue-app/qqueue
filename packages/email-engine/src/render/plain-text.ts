import { load } from "cheerio";

/** Plain quoted content for forwarding HTML-only mail. Never inserts received
 * markup into the composer, and never executes or fetches the document. */
export function plainTextFromHtml(html: string): string {
  const $ = load(html);
  $(
    "script, style, noscript, template, iframe, object, input, button, [hidden]"
  ).remove();
  $("br").replaceWith("\n");
  $("img[alt]").each((_, element) => {
    $(element).replaceWith($("<span>").text($(element).attr("alt") ?? ""));
  });
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text();
    if (/^https?:\/\//i.test(href) && text.trim() !== href)
      $(element).text(`${text} <${href}>`);
  });
  $("p, div, blockquote, li, tr, h1, h2, h3, h4, h5, h6").append("\n");
  $("td, th").append("\t");
  return $("body")
    .text()
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
