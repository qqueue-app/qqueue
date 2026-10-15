import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { api } from "../../lib/api.js";
import { PrivateMailPreview } from "./PrivateMailPreview.js";
vi.mock("../../lib/api.js", () => ({
  api: { downloadAttachment: vi.fn(), downloadInboundAttachment: vi.fn() },
}));
const props = {
  html: '<p>Private<img src="cid:logo"><img src="https://tracker.example.test/pixel"></p>',
  files: [{ id: "f1", filename: "logo.png", cid: "<logo>" }],
  organizationId: "org1",
  userId: "u1",
  version: "v1",
  title: "Private preview",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.downloadAttachment).mockResolvedValue(new Blob(["image"]));
  vi.mocked(api.downloadInboundAttachment).mockResolvedValue(
    new Blob(["image"])
  );
});
it("renders private parts through authenticated blobs without changing draft HTML or loading trackers", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const { unmount } = renderWithProviders(<PrivateMailPreview {...props} />);
  await waitFor(() =>
    expect(
      screen.getByTitle("Private preview").getAttribute("srcdoc")
    ).toContain('src="blob:')
  );
  expect(api.downloadAttachment).toHaveBeenCalledWith("f1");
  const html = screen.getByTitle("Private preview").getAttribute("srcdoc")!;
  expect(html).not.toContain("https://tracker.example.test/pixel");
  expect(html).toContain("default-src 'none'");
  expect(props.html).toContain('src="cid:logo"');
  unmount();
  expect(revoke).toHaveBeenCalled();
});
it("scopes original preview parts to the source mailbox message", async () => {
  renderWithProviders(<PrivateMailPreview {...props} receivedMessageId="m1" />);
  await waitFor(() =>
    expect(api.downloadInboundAttachment).toHaveBeenCalledWith({
      organizationId: "org1",
      messageId: "m1",
      attachmentId: "f1",
    })
  );
  expect(api.downloadAttachment).not.toHaveBeenCalled();
});
it("makes a private-image fetch failure visible and recoverable", async () => {
  const user = userEvent.setup();
  vi.mocked(api.downloadAttachment).mockRejectedValueOnce(new Error("Offline"));
  renderWithProviders(<PrivateMailPreview {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("logo.png");
  await user.click(screen.getByRole("button", { name: "Retry images" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  );
  expect(api.downloadAttachment).toHaveBeenCalledTimes(2);
});
