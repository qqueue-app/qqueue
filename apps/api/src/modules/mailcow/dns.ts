import { Resolver } from "node:dns/promises";
import type { MailDnsProvider, MailDnsRecord } from "@qqueue/shared";
import type { MailcowDkimKey } from "./client.js";

/**
 * DNS for a Mailcow domain: what must be published, who hosts the zone, and
 * which records are actually live.
 *
 * Creating a domain in Mailcow is one API call, but the domain neither sends
 * nor receives anything until its DNS is published. Without this module the UI
 * could only say "domain added", and the owner would discover it doesn't work
 * when mail silently fails — so the records, and their live state, are part of
 * the feature rather than a doc page.
 *
 * Every lookup here is advisory. DNS is slow, cached, and often unreachable
 * from inside a container, so a failed probe reports "unknown" and never fails
 * the request.
 */

// Short and few: this runs inside a request, and a domain that does not
// resolve yet is the expected case right after creation, not an outage.
const RESOLVER_TIMEOUT_MS = 4_000;
const RESOLVER_TRIES = 2;

function resolver() {
  return new Resolver({ timeout: RESOLVER_TIMEOUT_MS, tries: RESOLVER_TRIES });
}

/**
 * Nameserver suffix -> DNS host, matched against the domain's live NS records.
 * Those are authoritative facts rather than a guess from the registrar.
 *
 * The provider doubles as the key the UI uses to offer host-specific help, so
 * a new provider needs only a row here.
 */
const NAMESERVER_SIGNATURES: Array<{
  suffix: string;
  provider: MailDnsProvider;
}> = [
  { suffix: "ns.cloudflare.com", provider: "CLOUDFLARE" },
  { suffix: "awsdns", provider: "ROUTE53" },
  { suffix: "domaincontrol.com", provider: "GODADDY" },
  { suffix: "registrar-servers.com", provider: "NAMECHEAP" },
  { suffix: "googledomains.com", provider: "GOOGLE" },
  { suffix: "digitalocean.com", provider: "DIGITALOCEAN" },
  { suffix: "vultr.com", provider: "VULTR" },
  { suffix: "hetzner.com", provider: "HETZNER" },
  { suffix: "hetzner.de", provider: "HETZNER" },
  { suffix: "linode.com", provider: "LINODE" },
  { suffix: "nsone.net", provider: "NS1" },
  { suffix: "dnsimple.com", provider: "DNSIMPLE" },
  { suffix: "name.com", provider: "NAMECOM" },
  { suffix: "porkbun.com", provider: "PORKBUN" },
  { suffix: "azure-dns", provider: "AZURE" },
];

/** Who hosts this domain's zone, read from its live NS records. */
export async function detectDnsProvider(domain: string): Promise<{
  provider: MailDnsProvider;
  nameservers: string[];
}> {
  let nameservers: string[];
  try {
    nameservers = (await resolver().resolveNs(domain)).map((ns) =>
      ns.toLowerCase().replace(/\.$/, "")
    );
  } catch {
    // NXDOMAIN, SERVFAIL, no outbound DNS — one answer covers all of them.
    return { provider: "UNKNOWN", nameservers: [] };
  }

  for (const { suffix, provider } of NAMESERVER_SIGNATURES) {
    if (nameservers.some((ns) => ns.endsWith(suffix))) {
      return { provider, nameservers };
    }
  }
  return { provider: nameservers.length ? "OTHER" : "UNKNOWN", nameservers };
}

/**
 * The records a Mailcow domain needs, in the order they matter.
 *
 * SPF is `mx` rather than a literal IP so it survives the mail host moving.
 * DMARC starts at `p=none` deliberately: a stricter policy on a domain whose
 * SPF and DKIM are not yet live would quarantine legitimate mail on day one.
 *
 * DKIM is omitted entirely when Mailcow holds no key. A placeholder would be
 * worse than nothing, because publishing a malformed DKIM TXT is a
 * verification *failure* rather than a missing signature.
 */
export function buildDnsRecords(input: {
  domain: string;
  mailHost: string;
  dkim: MailcowDkimKey | null;
}): MailDnsRecord[] {
  const { domain, mailHost, dkim } = input;
  const records: MailDnsRecord[] = [
    {
      key: "mx",
      type: "MX",
      name: domain,
      value: mailHost,
      priority: 10,
      required: true,
      purpose: "Routes mail for this domain to your mail server.",
    },
    {
      key: "spf",
      type: "TXT",
      name: domain,
      value: "v=spf1 mx ~all",
      required: true,
      purpose:
        "Authorises your mail server to send for this domain. Without it most providers treat your mail as spam.",
    },
  ];

  if (dkim) {
    records.push({
      key: "dkim",
      type: "TXT",
      name: `${dkim.selector}._domainkey.${domain}`,
      value: dkim.txtValue,
      required: true,
      purpose:
        "Publishes the key your mail server signs with, so recipients can verify the signature.",
    });
  }

  records.push(
    {
      key: "dmarc",
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`,
      required: true,
      purpose:
        "Tells recipients what to do with mail that fails SPF and DKIM. Start at p=none and tighten once reports look clean.",
    },
    {
      key: "autodiscover",
      type: "CNAME",
      name: `autodiscover.${domain}`,
      value: mailHost,
      required: false,
      purpose: "Lets Outlook configure a mailbox from just the address.",
    },
    {
      key: "autoconfig",
      type: "CNAME",
      name: `autoconfig.${domain}`,
      value: mailHost,
      required: false,
      purpose: "The same convenience for Thunderbird and mobile mail clients.",
    }
  );

  return records;
}

/** Flatten node's chunked TXT answers into one string per record. */
function joinTxt(chunks: string[][]): string[] {
  return chunks.map((parts) => parts.join(""));
}

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/\.$/, "");
}

/** The `p=` payload of a DKIM TXT value, ignoring whitespace and quoting. */
function publicKeyOf(value: string): string {
  const match = /p=([A-Za-z0-9+/=\s"]+)/.exec(value);
  return match ? match[1].replace(/[\s"]/g, "") : "";
}

/**
 * Check each record against live DNS.
 *
 * Matching is deliberately loose — "is a working record of this kind present",
 * not "does it match our suggestion byte for byte". A hand-tightened SPF or a
 * stricter DMARC policy is a correct configuration, and flagging it as missing
 * would train owners to ignore this panel. DKIM is the exception: the public
 * key either matches Mailcow's or signatures fail, so it compares the `p=`
 * value exactly.
 */
export async function checkDnsRecords(
  records: MailDnsRecord[]
): Promise<MailDnsRecord[]> {
  const dns = resolver();

  return Promise.all(
    records.map(async (record): Promise<MailDnsRecord> => {
      try {
        if (record.type === "MX") {
          const answers = await dns.resolveMx(record.name);
          const want = normalizeHost(record.value);
          return {
            ...record,
            status: answers.some(
              (answer) => normalizeHost(answer.exchange) === want
            )
              ? "OK"
              : "MISSING",
          };
        }

        if (record.type === "CNAME") {
          const answers = await dns.resolveCname(record.name);
          const want = normalizeHost(record.value);
          return {
            ...record,
            status: answers.some((answer) => normalizeHost(answer) === want)
              ? "OK"
              : "MISSING",
          };
        }

        const answers = joinTxt(await dns.resolveTxt(record.name));

        if (record.key === "spf") {
          return {
            ...record,
            status: answers.some((answer) =>
              answer.toLowerCase().startsWith("v=spf1")
            )
              ? "OK"
              : "MISSING",
          };
        }

        if (record.key === "dmarc") {
          return {
            ...record,
            status: answers.some((answer) =>
              answer.toLowerCase().startsWith("v=dmarc1")
            )
              ? "OK"
              : "MISSING",
          };
        }

        if (record.key === "dkim") {
          // Compare key material only: selectors and flag ordering differ
          // between what Mailcow prints and what a DNS host stores back.
          const want = publicKeyOf(record.value);
          return {
            ...record,
            status:
              want && answers.some((answer) => publicKeyOf(answer) === want)
                ? "OK"
                : "MISSING",
          };
        }

        return { ...record, status: answers.length ? "OK" : "MISSING" };
      } catch (error) {
        // ENODATA/NXDOMAIN mean the record genuinely is not published; any
        // other failure (timeout, no resolver) is our problem, not the zone's.
        const code = (error as NodeJS.ErrnoException).code;
        return {
          ...record,
          status:
            code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN"
              ? "MISSING"
              : "UNKNOWN",
        };
      }
    })
  );
}
