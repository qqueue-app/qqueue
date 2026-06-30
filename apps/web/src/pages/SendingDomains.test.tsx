import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({
  current: { currentOrganizationId: "org_1" }
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current
}));

vi.mock("../lib/api.js", () => ({
  api: {
    listSendingDomains: vi.fn(),
    listSenderIdentities: vi.fn(),
    listSMTPConnections: vi.fn(),
    createSendingDomain: vi.fn(),
    deleteSendingDomain: vi.fn(),
    verifySendingDomain: vi.fn(),
    createSenderIdentity: vi.fn(),
    updateSenderIdentity: vi.fn(),
    deleteSenderIdentity: vi.fn()
  }
}));

import { SendingDomains } from "./SendingDomains.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const domains = [
  {
    id: "d1",
    organizationId: "org_1",
    domain: "acme.com",
    dkimMode: "MANAGED",
    dkimStatus: "FAILED",
    dkimSelector: "qqueue",
    dkimPublicKey: "pk",
    spfNote: null,
    verifiedAt: null,
    lastCheckedAt: "2026-06-30T10:00:00.000Z",
    createdAt: "x",
    updatedAt: "x",
    dnsRecords: {
      dkim: {
        host: "qqueue._domainkey.acme.com",
        type: "TXT",
        value: "v=DKIM1; k=rsa; p=AAA"
      },
      spf: { host: "acme.com", type: "TXT", value: "v=spf1 ip4:X ~all" },
      dmarc: {
        host: "_dmarc.acme.com",
        type: "TXT",
        value: "v=DMARC1; p=none; rua=mailto:dmarc@acme.com"
      }
    }
  },
  {
    id: "d2",
    organizationId: "org_1",
    domain: "beta.com",
    dkimMode: "EXTERNAL",
    dkimStatus: "NA",
    spfNote: null,
    createdAt: "x",
    updatedAt: "x",
    dnsRecords: null
  }
];

const identities = [
  {
    id: "i1",
    organizationId: "org_1",
    sendingDomainId: "d1",
    fromName: "Acme",
    fromEmail: "noreply@acme.com",
    smtpConnectionId: "s1",
    replyTo: null,
    isDefault: true,
    createdAt: "x",
    updatedAt: "x"
  },
  {
    id: "i2",
    organizationId: "org_1",
    sendingDomainId: "d1",
    fromName: "Support",
    fromEmail: "help@acme.com",
    smtpConnectionId: "s1",
    replyTo: null,
    isDefault: false,
    createdAt: "x",
    updatedAt: "x"
  }
];

const connections = [
  {
    id: "s1",
    organizationId: "org_1",
    name: "Primary",
    host: "h",
    port: 587,
    secure: true,
    fromEmail: "f@x.com",
    isDefault: true
  }
];

function setup() {
  mockedApi.listSendingDomains.mockResolvedValue(domains);
  mockedApi.listSenderIdentities.mockResolvedValue(identities);
  mockedApi.listSMTPConnections.mockResolvedValue(connections);
  mockedApi.updateSenderIdentity.mockResolvedValue({ id: "i2" });
  mockedApi.verifySendingDomain.mockResolvedValue({ status: "queued" });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SendingDomains />
    </MemoryRouter>
  );
}

describe("SendingDomains", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("groups identities under their domain and flags the default", async () => {
    setup();
    renderPage();
    // Both managed and external domains render, plus the two identities.
    expect(await screen.findByText("noreply@acme.com", { exact: false }))
      .toBeInTheDocument();
    expect(screen.getByText("help@acme.com", { exact: false }))
      .toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("sets a non-default identity as the default", async () => {
    const user = userEvent.setup();
    setup();
    renderPage();
    await screen.findByText("help@acme.com", { exact: false });

    await user.click(
      screen.getByRole("button", { name: "Set as default sender identity" })
    );

    await waitFor(() =>
      expect(mockedApi.updateSenderIdentity).toHaveBeenCalledWith("i2", {
        isDefault: true
      })
    );
  });

  it("surfaces a failure alert and re-verifies a managed domain", async () => {
    const user = userEvent.setup();
    setup();
    renderPage();

    expect(await screen.findByText("DKIM record not found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Re-verify/i }));

    await waitFor(() =>
      expect(mockedApi.verifySendingDomain).toHaveBeenCalledWith("d1")
    );
  });
});
