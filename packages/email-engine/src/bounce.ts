/**
 * Bounce classification for the auto-suppression policy.
 *
 * `HARD` and `BLOCK` are permanent/serious and suppress an address immediately;
 * `SOFT` is transient and only suppresses after the org's threshold is reached.
 * An unclassifiable rejection is treated as `HARD` (conservative — matches the
 * pre-Phase-D behavior of suppressing on any bounce, so there is no regression).
 */
export type BounceType = "HARD" | "SOFT" | "BLOCK";

const BLOCK_PATTERNS =
  /blocked|black\s?list|block\s?list|spam|policy reasons?|reputation|denied by|rejected due to/i;

const HARD_PATTERNS =
  /no such user|user unknown|unknown user|does ?n[o']t exist|doesn't exist|no mailbox|mailbox unavailable|recipient (?:address )?rejected|address rejected|invalid recipient|recipient not found|unrouteable address|user not found|account (?:has been )?(?:disabled|closed)/i;

const SOFT_PATTERNS =
  /mailbox\s+(?:is\s+)?full|full mailbox|over ?quota|quota exceeded|insufficient (?:system )?storage|out of (?:storage|space)|grey ?-?list|try again|temporar|deferred|defer|timed? ?out|timeout|connection (?:refused|reset|error)|too many|rate ?limit|throttl|server busy|service unavailable/i;

/**
 * Parse a leading basic status code (e.g. "550", "421") and/or an enhanced
 * status code (e.g. "5.1.1", "4.2.2") from an SMTP response line.
 */
function parseCode(input: { code?: number | string; message?: string }): {
  basicClass?: number;
  enhancedClass?: number;
} {
  let basicClass: number | undefined;
  let enhancedClass: number | undefined;

  if (typeof input.code === "number" && input.code >= 100) {
    basicClass = Math.floor(input.code / 100);
  }

  const text = `${input.code ?? ""} ${input.message ?? ""}`.trim();
  const enhanced = text.match(/\b([45])\.\d{1,3}\.\d{1,3}\b/);
  if (enhanced) {
    enhancedClass = Number(enhanced[1]);
  }
  const basic = text.match(/(?:^|\s)([45])\d{2}(?:\s|$|-)/);
  if (basic && basicClass === undefined) {
    basicClass = Number(basic[1]);
  }

  return { basicClass, enhancedClass };
}

/**
 * Classify an SMTP rejection / ESP bounce into a {@link BounceType}. Phrasing is
 * checked before numeric class so a transient 4xx isn't misread and a permanent
 * 5xx phrased as "mailbox full" is still treated as soft.
 */
export function classifyBounce(input: {
  code?: number | string;
  message?: string;
}): BounceType {
  const text = input.message ?? "";

  if (BLOCK_PATTERNS.test(text)) {
    return "BLOCK";
  }
  if (SOFT_PATTERNS.test(text)) {
    return "SOFT";
  }
  if (HARD_PATTERNS.test(text)) {
    return "HARD";
  }

  const { basicClass, enhancedClass } = parseCode(input);
  const klass = enhancedClass ?? basicClass;
  if (klass === 4) {
    return "SOFT";
  }
  if (klass === 5) {
    return "HARD";
  }

  // Unknown: stay conservative and treat as a hard (immediate) suppression.
  return "HARD";
}
