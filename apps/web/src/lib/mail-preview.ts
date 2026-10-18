/** Plain, readable excerpts only. The stored message is never changed. */
export function mailPreview(
  text?: string | null,
  html?: string | null
): string {
  const clean = (value: string) =>
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/(?:\[?image:?\s*)\[https?:\/\/[^\]]+\]/gi, " ")
      .replace(/https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?/gi, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  const usable = (value: string) =>
    !/^(?:none|null|undefined)$/i.test(value) &&
    !/^(?:\*|html|body|table|td|div|p|a|span|[.#][\w-]+)\s*(?:[.:#][\w-]+\s*)?\{[^}]*[:;]/i.test(
      value
    );
  const plain = clean(text ?? "");
  const fallback = clean(html ?? "");
  return (
    plain && usable(plain) ? plain : usable(fallback) ? fallback : ""
  ).slice(0, 200);
}
