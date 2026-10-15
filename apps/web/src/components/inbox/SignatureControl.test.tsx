import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { api } from "../../lib/api.js";
import {
  SignatureControl,
  replaceSignature,
  signatureStamp,
  type SignatureStamp,
} from "./SignatureControl.js";
vi.mock("../../lib/api.js", () => ({ api: { listMailSignatures: vi.fn() } }));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => ({ user: { id: "u1" } }),
}));
const accounts = [
  {
    smtpConnectionId: "s1",
    fromEmail: "one@example.com",
    fromName: "One",
    isDefault: true,
    text: "Ama & team\nSupport",
    enabled: true,
    revision: 1,
  },
  {
    smtpConnectionId: "s2",
    fromEmail: "two@example.com",
    fromName: "Two",
    isDefault: false,
    text: "Ama at Two",
    enabled: true,
    revision: 1,
  },
];
function Harness({
  connectionId,
  initial = "",
  auto = true,
  disabled = false,
  initialStamp,
}: {
  connectionId?: string;
  initial?: string;
  auto?: boolean;
  disabled?: boolean;
  initialStamp?: SignatureStamp;
}) {
  const [html, setHtml] = useState(initial),
    [stamp, setStamp] = useState(initialStamp);
  return (
    <>
      <textarea
        aria-label="Writing"
        value={html}
        onChange={(event) => setHtml(event.target.value)}
      />
      <SignatureControl
        organizationId="org1"
        connectionId={connectionId}
        value={html}
        onChange={setHtml}
        stamp={stamp}
        onStamp={setStamp}
        autoReady={auto}
        generation="draft1"
        disabled={disabled}
      />
      <output aria-label="Signature identity">{stamp?.smtpConnectionId}</output>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listMailSignatures).mockResolvedValue(accounts);
});
describe("personal composer signature", () => {
  it("inserts the selected default signature once into a new blank message", async () => {
    renderWithProviders(<Harness />);
    await waitFor(() =>
      expect(screen.getByLabelText("Writing")).toHaveValue(
        "<p></p><p>Ama &amp; team<br>Support</p>"
      )
    );
    expect(screen.getByLabelText("Signature identity")).toHaveTextContent("s1");
  });
  it("preserves existing writing and permits explicit insertion", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial="<p>Existing draft</p>" />);
    await user.click(
      await screen.findByRole("button", { name: "Insert signature" })
    );
    expect(screen.getByLabelText("Writing")).toHaveValue(
      "<p>Existing draft</p><p>Ama &amp; team<br>Support</p>"
    );
  });
  it("updates an untouched signature when the sending account changes", async () => {
    const view = renderWithProviders(<Harness connectionId="s1" />);
    await waitFor(() =>
      expect(screen.getByLabelText("Signature identity")).toHaveTextContent(
        "s1"
      )
    );
    view.rerender(<Harness connectionId="s2" />);
    await waitFor(() =>
      expect(screen.getByLabelText("Writing")).toHaveValue(
        "<p></p><p>Ama at Two</p>"
      )
    );
    expect(screen.getByLabelText("Signature identity")).toHaveTextContent("s2");
  });
  it("keeps a signature edited by the author when From changes", async () => {
    const view = renderWithProviders(
      <Harness
        connectionId="s1"
        initial="<p>Edited sign-off</p>"
        initialStamp={{ smtpConnectionId: "s1", html: "<p>Original</p>" }}
        auto={false}
      />
    );
    await screen.findByRole("button", { name: "Insert signature" });
    view.rerender(
      <Harness
        connectionId="s2"
        initial="<p>Edited sign-off</p>"
        auto={false}
      />
    );
    expect(
      await screen.findByText(/Your signature was edited/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Writing")).toHaveValue(
      "<p>Edited sign-off</p>"
    );
  });
  it("allows manual insertion when automatic signatures are disabled", async () => {
    vi.mocked(api.listMailSignatures).mockResolvedValue([
      { ...accounts[0], enabled: false },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(
      await screen.findByRole("button", { name: "Insert signature" })
    );
    expect(screen.getByLabelText("Writing")).toHaveValue(
      "<p></p><p>Ama &amp; team<br>Support</p>"
    );
  });
  it("leaves writing alone while a send is being accepted", async () => {
    renderWithProviders(<Harness disabled />);
    expect(
      await screen.findByRole("button", { name: "Insert signature" })
    ).toBeDisabled();
    expect(screen.getByLabelText("Writing")).toHaveValue("");
  });
  it("provides an honest load error and recovers on retry", async () => {
    vi.mocked(api.listMailSignatures)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(accounts);
    const user = userEvent.setup();
    renderWithProviders(<Harness initial="<p>Keep me</p>" />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Insert signature" });
    expect(screen.getByLabelText("Writing")).toHaveValue("<p>Keep me</p>");
  });
  it("keeps a full HTML document intact when adding or replacing its signature", () => {
    expect(
      replaceSignature(
        "<html><body><p>Body</p></body></html>",
        undefined,
        "<p>Sign</p>"
      ).html
    ).toBe("<html><body><p>Body</p><p>Sign</p></body></html>");
    expect(
      replaceSignature(
        "<html><body><p>Body</p><p>Old</p></body></html>",
        "<p>Old</p>",
        "<p>New</p>"
      )
    ).toEqual({
      html: "<html><body><p>Body</p><p>New</p></body></html>",
      replaced: true,
    });
    expect(signatureStamp(null)).toBeUndefined();
    expect(signatureStamp({ html: 7 })).toBeUndefined();
    expect(
      signatureStamp({ html: "<p>Saved</p>", smtpConnectionId: "s1" })
    ).toEqual({ html: "<p>Saved</p>", smtpConnectionId: "s1" });
  });
});
