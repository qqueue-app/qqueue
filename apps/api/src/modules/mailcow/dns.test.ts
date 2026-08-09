import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveNs = vi.fn();
const resolveMx = vi.fn();
const resolveTxt = vi.fn();
const resolveCname = vi.fn();

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolveNs = resolveNs;
    resolveMx = resolveMx;
    resolveTxt = resolveTxt;
    resolveCname = resolveCname;
  },
}));

const { buildDnsRecords, checkDnsRecords, detectDnsProvider } = await import(
  "./dns.js"
);

const DKIM = {
  selector: "dkim",
  txtValue: "v=DKIM1;k=rsa;t=s;s=email;p=MIIBpubkey",
  keySize: 2048,
};

function records(dkim: typeof DKIM | null = DKIM) {
  return buildDnsRecords({
    domain: "acme.test",
    mailHost: "mail.acme.test",
    dkim,
  });
}

beforeEach(() => {
  resolveNs.mockReset();
  resolveMx.mockReset();
  resolveTxt.mockReset();
  resolveCname.mockReset();
});

describe("detectDnsProvider", () => {
  it("identifies the host from its nameserver suffix", async () => {
    resolveNs.mockResolvedValue(["kate.ns.cloudflare.com", "rick.NS.cloudflare.com."]);

    await expect(detectDnsProvider("acme.test")).resolves.toEqual({
      provider: "CLOUDFLARE",
      nameservers: ["kate.ns.cloudflare.com", "rick.ns.cloudflare.com"],
    });
  });

  it("reports OTHER when nameservers resolve but match nothing known", async () => {
    resolveNs.mockResolvedValue(["ns1.some-tiny-host.example"]);

    await expect(detectDnsProvider("acme.test")).resolves.toMatchObject({
      provider: "OTHER",
    });
  });

  // A failed lookup and a known-but-unlisted host are different answers: the
  // UI tells the owner "we couldn't check" rather than naming a host.
  it("reports UNKNOWN when the lookup fails", async () => {
    resolveNs.mockRejectedValue(
      Object.assign(new Error("nope"), { code: "ENOTFOUND" })
    );

    await expect(detectDnsProvider("acme.test")).resolves.toEqual({
      provider: "UNKNOWN",
      nameservers: [],
    });
  });
});

describe("buildDnsRecords", () => {
  it("includes the DKIM record under the selector Mailcow reported", () => {
    const dkim = records().find((record) => record.key === "dkim");

    expect(dkim).toMatchObject({
      type: "TXT",
      name: "dkim._domainkey.acme.test",
      value: DKIM.txtValue,
      required: true,
    });
  });

  // A placeholder DKIM record is worse than none: publishing a malformed one
  // is a verification failure rather than a missing signature.
  it("omits DKIM entirely when the server holds no key", () => {
    expect(records(null).some((record) => record.key === "dkim")).toBe(false);
  });

  it("starts DMARC at p=none so a half-configured domain isn't quarantined", () => {
    const dmarc = records().find((record) => record.key === "dmarc");

    expect(dmarc?.name).toBe("_dmarc.acme.test");
    expect(dmarc?.value).toContain("p=none");
  });

  it("marks the autoconfig conveniences as not required", () => {
    const optional = records()
      .filter((record) => !record.required)
      .map((record) => record.key);

    expect(optional).toEqual(["autodiscover", "autoconfig"]);
  });
});

describe("checkDnsRecords", () => {
  it("matches an MX record regardless of the trailing dot and case", async () => {
    resolveMx.mockResolvedValue([{ exchange: "Mail.Acme.Test.", priority: 10 }]);
    resolveTxt.mockResolvedValue([]);
    resolveCname.mockResolvedValue([]);

    const checked = await checkDnsRecords(records());

    expect(checked.find((record) => record.key === "mx")?.status).toBe("OK");
  });

  // Loose on purpose: a hand-tightened SPF is a working configuration, and
  // flagging it as missing would train owners to ignore the panel.
  it("accepts any valid SPF record, not only the suggested one", async () => {
    resolveMx.mockResolvedValue([]);
    resolveCname.mockResolvedValue([]);
    resolveTxt.mockImplementation(async (name: string) =>
      name === "acme.test" ? [["v=spf1 ", "mx a:relay.acme.test -all"]] : []
    );

    const checked = await checkDnsRecords(records());

    expect(checked.find((record) => record.key === "spf")?.status).toBe("OK");
  });

  // DKIM is the exception to the loose matching: a key that isn't Mailcow's
  // means every signature fails verification.
  it("requires the DKIM public key to match Mailcow's exactly", async () => {
    resolveMx.mockResolvedValue([]);
    resolveCname.mockResolvedValue([]);
    resolveTxt.mockImplementation(async (name: string) =>
      name === "dkim._domainkey.acme.test"
        ? [["v=DKIM1; k=rsa; p=SOMEOTHERKEY"]]
        : []
    );

    const checked = await checkDnsRecords(records());

    expect(checked.find((record) => record.key === "dkim")?.status).toBe(
      "MISSING"
    );
  });

  it("matches a DKIM record whose flags are reordered and chunked", async () => {
    resolveMx.mockResolvedValue([]);
    resolveCname.mockResolvedValue([]);
    resolveTxt.mockImplementation(async (name: string) =>
      name === "dkim._domainkey.acme.test"
        ? [["v=DKIM1; k=rsa; s=email; p=MIIB", "pubkey"]]
        : []
    );

    const checked = await checkDnsRecords(records());

    expect(checked.find((record) => record.key === "dkim")?.status).toBe("OK");
  });

  it("reads ENODATA as genuinely missing", async () => {
    const enodata = Object.assign(new Error("no data"), { code: "ENODATA" });
    resolveMx.mockRejectedValue(enodata);
    resolveTxt.mockRejectedValue(enodata);
    resolveCname.mockRejectedValue(enodata);

    const checked = await checkDnsRecords(records());

    expect(checked.every((record) => record.status === "MISSING")).toBe(true);
  });

  // A timeout says nothing about the zone, so it must not read as "missing" —
  // that would tell an owner to re-publish records that are already correct.
  it("reads a timeout as unknown rather than missing", async () => {
    const timeout = Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    resolveMx.mockRejectedValue(timeout);
    resolveTxt.mockRejectedValue(timeout);
    resolveCname.mockRejectedValue(timeout);

    const checked = await checkDnsRecords(records());

    expect(checked.every((record) => record.status === "UNKNOWN")).toBe(true);
  });
});
