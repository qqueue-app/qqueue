import { renderWithProviders, screen, waitFor, within } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: { getSentEmail: vi.fn(), downloadAttachment: vi.fn() },
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" }),
}));

// The page reads `:id` from the route rather than from a prop.
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom"
    );
  return { ...actual, useParams: () => ({ id: "job_1" }) };
});

import { api } from "../lib/api.js";
import { SentMessage } from "./SentMessage.js";

const mockedApi = api as unknown as {
  getSentEmail: ReturnType<typeof vi.fn>;
  downloadAttachment: ReturnType<typeof vi.fn>;
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    subject: "Friday update",
    to: ["a@x.com", "b@x.com"],
    ccCount: 1,
    bccCount: 0,
    cc: ["c@x.com"],
    bcc: [],
    replyTo: null,
    status: "SENT" as const,
    origin: "MANUAL" as const,
    sentAt: "2026-07-22T09:00:00.000Z",
    createdAt: "2026-07-22T08:59:00.000Z",
    campaignId: null,
    campaignName: null,
    messageId: "<abc@acme.com>",
    sendingAccount: {
      name: "Primary",
      fromEmail: "hi@acme.com",
      fromName: "Acme",
    },
    delivered: true,
    bounced: false,
    complained: false,
    opens: 0,
    clicks: 0,
    html: "<html><body><p>Hello there</p></body></html>",
    text: "Hello there",
    attachments: [],
    events: [
      {
        id: "ev_1",
        type: "SENT" as const,
        occurredAt: "2026-07-22T09:00:00.000Z",
        detail: null,
        count: 1,
        lastOccurredAt: null,
        automatedCount: 0,
      },
    ],
    failureReason: null,
    ...overrides,
  };
}

describe("SentMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getSentEmail.mockResolvedValue(detail());
  });

  it("shows the envelope: who it went as, and to whom", async () => {
    renderWithProviders(<SentMessage />);

    expect(
      await screen.findByRole("heading", { name: "Friday update" })
    ).toBeInTheDocument();
    expect(screen.getByText("Acme <hi@acme.com>")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    // The list's row could only fit two addresses and a count.
    expect(screen.getByText("c@x.com")).toBeInTheDocument();
  });

  it("renders the body in a frame that cannot run scripts", async () => {
    renderWithProviders(<SentMessage />);

    const frame = (await screen.findByTestId("sent-body")) as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    // No allow-scripts: an isolated document, so the email's own styles cannot
    // leak into the dashboard and nothing in it executes.
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("Hello there");
  });

  it("falls back to the plain-text part when there is no HTML", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({ html: null, text: "Plain words only" })
    );
    renderWithProviders(<SentMessage />);

    const body = await screen.findByTestId("sent-body");
    // Rendered as a text node, not as markup: there is no HTML part to sandbox.
    expect(body.tagName).not.toBe("IFRAME");
    expect(body).toHaveTextContent("Plain words only");
  });

  it("says so when nothing of the message was stored", async () => {
    mockedApi.getSentEmail.mockResolvedValue(detail({ html: null, text: null }));
    renderWithProviders(<SentMessage />);

    expect(
      await screen.findByText("This message has no stored body.")
    ).toBeInTheDocument();
  });

  it("puts the failure reason above the addresses, not in the history", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        status: "FAILED",
        delivered: false,
        sentAt: null,
        failureReason: "550 5.1.1 no such user",
        events: [
          {
            id: "ev_1",
            type: "FAILED" as const,
            occurredAt: "2026-07-22T09:00:00.000Z",
            detail: "550 5.1.1 no such user",
          },
        ],
      })
    );
    renderWithProviders(<SentMessage />);

    // When a send failed, the reason is the only thing anyone opened the page
    // for, so it must not be something you scroll to find.
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(
      screen.getAllByText("550 5.1.1 no such user").length
    ).toBeGreaterThan(0);
  });

  it("reads the pipeline's events as a history in plain words", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        opens: 1,
        events: [
          {
            id: "ev_1",
            type: "SENT" as const,
            occurredAt: "2026-07-22T09:00:00.000Z",
            detail: null,
          },
          {
            id: "ev_2",
            type: "OPENED" as const,
            occurredAt: "2026-07-22T10:00:00.000Z",
            detail: null,
          },
          {
            id: "ev_3",
            type: "CLICKED" as const,
            occurredAt: "2026-07-22T10:01:00.000Z",
            detail: "https://acme.com/pricing",
          },
        ],
      })
    );
    renderWithProviders(<SentMessage />);

    const history = await screen.findByRole("list", {
      name: "Message history",
    });
    // "SENT" is the moment the provider accepted it, not the moment someone
    // pressed send, so the enum's own word would mislead.
    expect(
      within(history).getByText("Handed to the mail server")
    ).toBeInTheDocument();
    // Scoped to the history: the outcome badge above says "Opened" too, and
    // that is the summary rather than the event.
    expect(within(history).getByText("Opened")).toBeInTheDocument();
    expect(within(history).getByText("Link clicked")).toBeInTheDocument();
    expect(
      within(history).getByText("https://acme.com/pricing")
    ).toBeInTheDocument();
  });

  it("says a repeated open is one reader, not many", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        opens: 12,
        events: [
          {
            id: "ev_2",
            type: "OPENED" as const,
            occurredAt: "2026-07-22T09:00:20.000Z",
            detail: null,
            count: 13,
            lastOccurredAt: "2026-07-22T15:17:57.000Z",
            automatedCount: 1,
          },
        ],
      })
    );
    renderWithProviders(<SentMessage />);

    const history = await screen.findByRole("list", {
      name: "Message history",
    });
    // One line, not thirteen — and the span it covers, because a bare count
    // reads as thirteen readers all over again.
    expect(within(history).getAllByText("Opened")).toHaveLength(1);
    expect(
      within(history).getByText(/13 times/)
    ).toBeInTheDocument();
    expect(
      within(history).getByText(/1 looked automated/)
    ).toBeInTheDocument();
    // And the gloss that stops "13" being read as thirteen people.
    expect(
      screen.getByText(/An open is recorded every time/)
    ).toBeInTheDocument();
  });

  it("leaves a one-off event unadorned", async () => {
    renderWithProviders(<SentMessage />);

    const history = await screen.findByRole("list", {
      name: "Message history",
    });
    expect(within(history).queryByText(/times/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/An open is recorded every time/)
    ).not.toBeInTheDocument();
  });

  it("offers the attached parts and downloads one on request", async () => {
    const user = userEvent.setup();
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        attachments: [
          {
            id: "att_1",
            filename: "report.zip",
            contentType: "application/zip",
            size: 2048,
            isInline: false,
            contentId: null,
          },
        ],
      })
    );
    mockedApi.downloadAttachment.mockResolvedValue(new Blob(["data"]));
    renderWithProviders(<SentMessage />);

    await user.click(await screen.findByText("report.zip"));

    await waitFor(() =>
      expect(mockedApi.downloadAttachment).toHaveBeenCalledWith("att_1")
    );
  });

  it("keeps inline parts out of the attachment list", async () => {
    mockedApi.downloadAttachment.mockResolvedValue(new Blob(["img"]));
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        html: '<html><body><img src="cid:qr@acme"></body></html>',
        attachments: [
          {
            id: "att_1",
            filename: "qr.png",
            contentType: "image/png",
            size: 64,
            isInline: true,
            contentId: "<qr@acme>",
          },
        ],
      })
    );
    renderWithProviders(<SentMessage />);

    await screen.findByTestId("sent-body");
    // A signature logo the sender meant to render in the body is not a file
    // anyone wants to download.
    expect(screen.queryByText("Attachment")).not.toBeInTheDocument();
    expect(screen.queryByText("qr.png")).not.toBeInTheDocument();
    // It is fetched, though — so the `cid:` reference in the body resolves.
    await waitFor(() =>
      expect(mockedApi.downloadAttachment).toHaveBeenCalledWith("att_1")
    );
  });

  it("links a campaign send back to its analytics", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        origin: "CAMPAIGN" as const,
        campaignId: "cmp_1",
        campaignName: "July newsletter",
      })
    );
    renderWithProviders(<SentMessage />);

    expect(
      await screen.findByRole("link", { name: /July newsletter/ })
    ).toHaveAttribute("href", "/campaigns/cmp_1/analytics");
  });

  it("offers a way back when the message is not the reader's to see", async () => {
    mockedApi.getSentEmail.mockRejectedValue(new Error("Email not found"));
    renderWithProviders(<SentMessage />);

    expect(await screen.findByText("Message not found")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Sent" })
    ).toHaveAttribute("href", "/sent");
  });

  it("carries a trail back to the archive", async () => {
    renderWithProviders(<SentMessage />);
    await screen.findByRole("heading", { name: "Friday update" });

    const links = screen.getAllByRole("link", { name: "Sent" });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/sent");
  });

  it("shows Bcc, which is the sender's own copy to see", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({ bcc: ["quiet@x.com"], bccCount: 1 })
    );
    renderWithProviders(<SentMessage />);

    const bcc = await screen.findByText("Bcc");
    expect(bcc).toBeInTheDocument();
    expect(screen.getByText("quiet@x.com")).toBeInTheDocument();
  });

  it("keeps the Message-ID available but out of the way", async () => {
    renderWithProviders(<SentMessage />);
    await screen.findByRole("heading", { name: "Friday update" });

    // What you quote to whoever is reading the mail server's logs.
    expect(screen.getByText("<abc@acme.com>")).toBeInTheDocument();
  });
});

describe("SentMessage inline images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("points a cid: reference at the part it downloaded", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        html: '<html><body><img src="cid:qr@acme"></body></html>',
        attachments: [
          {
            id: "att_1",
            filename: "qr.png",
            contentType: "image/png",
            size: 64,
            isInline: true,
            contentId: "<qr@acme>",
          },
        ],
      })
    );
    mockedApi.downloadAttachment.mockResolvedValue(new Blob(["img"]));
    renderWithProviders(<SentMessage />);

    const frame = (await screen.findByTestId("sent-body")) as HTMLIFrameElement;
    // Content-IDs travel wrapped in angle brackets in MIME but bare in the URL,
    // so the two only meet after normalization.
    await waitFor(() =>
      expect(frame.getAttribute("srcdoc")).toContain('src="blob:')
    );
  });

  it("drops the src of a part it could not fetch, rather than breaking the image", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        html: '<html><body><img src="cid:gone@acme"></body></html>',
        attachments: [],
      })
    );
    renderWithProviders(<SentMessage />);

    const frame = (await screen.findByTestId("sent-body")) as HTMLIFrameElement;
    // An empty <img> still renders as a broken-image icon; no src renders as
    // nothing, which is the honest outcome for a part we cannot resolve.
    expect(frame.getAttribute("srcdoc")).not.toContain("cid:gone@acme");
  });
});

describe("SentMessage engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the strongest thing that happened, with the counts beside it", async () => {
    mockedApi.getSentEmail.mockResolvedValue(detail({ opens: 4, clicks: 2 }));
    renderWithProviders(<SentMessage />);

    expect(await screen.findByText("Clicked")).toBeInTheDocument();
    expect(screen.getByText("4 opens · 2 clicks")).toBeInTheDocument();
  });

  it("says the account is gone rather than showing a blank From", async () => {
    mockedApi.getSentEmail.mockResolvedValue(detail({ sendingAccount: null }));
    renderWithProviders(<SentMessage />);

    // EmailJob.smtpConnectionId is SetNull on delete, so this is reachable for
    // any message whose sending account was later removed.
    expect(await screen.findByText("Account removed")).toBeInTheDocument();
  });
});

describe("SentMessage history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says so when the pipeline recorded nothing beyond the send", async () => {
    mockedApi.getSentEmail.mockResolvedValue(detail({ events: [] }));
    renderWithProviders(<SentMessage />);

    expect(
      await screen.findByText("Nothing recorded beyond the send itself.")
    ).toBeInTheDocument();
  });

  it("lists the history oldest first, as a history rather than a feed", async () => {
    mockedApi.getSentEmail.mockResolvedValue(
      detail({
        events: [
          {
            id: "ev_1",
            type: "SENT" as const,
            occurredAt: "2026-07-22T09:00:00.000Z",
            detail: null,
          },
          {
            id: "ev_2",
            type: "DELIVERED" as const,
            occurredAt: "2026-07-22T09:00:30.000Z",
            detail: null,
          },
        ],
      })
    );
    renderWithProviders(<SentMessage />);

    // Named, because the envelope above renders the recipients as a list too.
    const history = await screen.findByRole("list", {
      name: "Message history",
    });
    const rows = within(history).getAllByRole("listitem");
    expect(
      within(rows[0]).getByText("Handed to the mail server")
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText("Delivered")).toBeInTheDocument();
  });
});
