/**
 * The machine-readable, per-recipient portion of an RFC 3464 delivery status
 * notification. Kept in the email engine so both inbox ingestion and the API's
 * historical deliverability view interpret stored notices the same way.
 */
export interface DsnRecipientReport {
  recipient: string;
  action: string;
  status?: string;
  diagnosticCode?: string;
}

/** Unfold RFC 822 continuation lines so folded diagnostics read whole. */
function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]+/g, " ");
}

function fieldValue(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "im"));
  return match?.[1]?.trim() || undefined;
}

/** Strip the address-type prefix: `rfc822; bob@example.com` -> address. */
function parseFinalRecipient(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutType = value.replace(/^[\w-]+\s*;\s*/, "").trim();
  const match = withoutType.match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/);
  return match?.[0]?.toLowerCase();
}

/** Parse every per-recipient block in a delivery-status body. */
export function parseDsnRecipientReports(text: string): DsnRecipientReport[] {
  const unfolded = unfold(text);
  const reports: DsnRecipientReport[] = [];

  for (const block of unfolded.split(/\r?\n\s*\r?\n/)) {
    const recipient = parseFinalRecipient(
      fieldValue(block, "Final-Recipient") ??
        fieldValue(block, "Original-Recipient")
    );
    if (!recipient) continue;

    reports.push({
      recipient,
      // Missing Action on a recipient report is treated as failed. A sender
      // that emits such a block is reporting a terminal problem, and the
      // bounce classifier remains conservative when its reason is ambiguous.
      action: fieldValue(block, "Action")?.toLowerCase() ?? "failed",
      status: fieldValue(block, "Status")?.match(
        /\b([245]\.\d{1,3}\.\d{1,3})\b/
      )?.[1],
      diagnosticCode: fieldValue(block, "Diagnostic-Code"),
    });
  }

  return reports;
}

const DELAYED_NOTICE =
  /delivery (?:is |has been |was )?delayed|delayed delivery|delivery incomplete|will (?:keep|continue) (?:re)?trying|has not (?:yet )?been delivered yet|delivery will be attempted/i;

/**
 * Last-ditch parser for daemon notices without machine-readable fields. This
 * is deliberately pure so it can also recover useful details from the text
 * already stored on historical InboundMessage rows.
 */
export function scanDsnTextForBounce(input: {
  subject?: string | null;
  text?: string | null;
  excludeAddresses?: string[];
}): DsnRecipientReport[] {
  const text = `${input.subject ?? ""}\n${input.text ?? ""}`;
  if (DELAYED_NOTICE.test(text)) return [];

  const status = text.match(/\b([45]\.\d{1,3}\.\d{1,3})\b/)?.[1];
  const basicCode = text.match(/(?:^|\s)([45]\d{2})(?:\s|$|-)/m)?.[1];
  if (!status && !basicCode) return [];

  const excluded = new Set(
    (input.excludeAddresses ?? []).map((address) => address.toLowerCase())
  );
  const recipient = Array.from(
    text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g),
    (match) => match[0].toLowerCase()
  ).find(
    (address) =>
      !excluded.has(address) && !/^(mailer-daemon|postmaster)@/i.test(address)
  );
  if (!recipient) return [];

  return [
    {
      recipient,
      action: "failed",
      status,
      diagnosticCode: text
        .split(/\r?\n/)
        .find(
          (line) =>
            (status && line.includes(status)) ||
            (basicCode && line.includes(basicCode))
        )
        ?.trim(),
    },
  ];
}
