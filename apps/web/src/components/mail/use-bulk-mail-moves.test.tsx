import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import {
  api,
  type InboundMessage,
  type InboxMoveBatchSummary,
} from "../../lib/api.js";
import { useBulkMailMoves } from "./use-bulk-mail-moves.js";
vi.mock("../../lib/api.js", () => ({
  api: {
    createInboxMove: vi.fn(),
    getInboxMoveBatch: vi.fn(),
    checkInboxMoves: vi.fn(),
  },
}));
function batch(id: string, status = "PENDING"): InboxMoveBatchSummary {
  return {
    id,
    clientId: id,
    createdAt: "now",
    moves: [],
    total: 1,
    counts: {
      PENDING: Number(status === "PENDING"),
      PROCESSING: 0,
      UNCERTAIN: 0,
      DONE: Number(status === "DONE"),
      FAILED: Number(status === "FAILED"),
    },
  };
}
function thread(id: string, location = true) {
  const message = {
    id,
    subject: id,
    locations: location
      ? [
          {
            id: `loc-${id}`,
            inboxFolderId: "inbox",
            folder: { role: "INBOX", path: "INBOX", name: "Inbox" },
          },
        ]
      : [],
  } as InboundMessage;
  return { subject: id, latestMessage: message, messages: [message] };
}
function Harness({
  rows = [thread("a"), thread("b")],
  clear = () => {},
}: {
  rows?: ReturnType<typeof thread>[];
  clear?: () => void;
}) {
  const moves = useBulkMailMoves("org", "INBOX");
  return (
    <>
      {moves.controls(rows, clear)}
      {moves.progress}
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getInboxMoveBatch).mockImplementation(async (id) => batch(id));
  vi.mocked(api.checkInboxMoves).mockResolvedValue({ queued: true });
});
describe("bulk durable folder actions", () => {
  it("retains the selection after partial acceptance and retries only unconfirmed requests with the same identity", async () => {
    const clear = vi.fn(),
      user = userEvent.setup();
    vi.mocked(api.createInboxMove)
      .mockResolvedValueOnce(batch("a"))
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(batch("b"));
    renderWithProviders(<Harness clear={clear} />);
    await user.click(screen.getByRole("button", { name: "Archive selected" }));
    await screen.findByText(/Some folder requests were not confirmed/);
    expect(clear).not.toHaveBeenCalled();
    expect(api.createInboxMove).toHaveBeenNthCalledWith(
      1,
      "a",
      "org",
      expect.objectContaining({
        sourceLocationId: "loc-a",
        action: "ARCHIVE",
        scope: "CONVERSATION",
      })
    );
    const retryIdentity = vi.mocked(api.createInboxMove).mock.calls[1][2]
      .clientId;
    await user.click(screen.getByRole("button", { name: "Archive selected" }));
    await waitFor(() => expect(clear).toHaveBeenCalledOnce());
    expect(api.createInboxMove).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.createInboxMove).mock.calls[2][2].clientId).toBe(
      retryIdentity
    );
    expect(
      screen.getByText(/Folder action progress \(2 conversations\)/)
    ).toBeInTheDocument();
  });
  it("keeps messages without a known source location and never invents a move", async () => {
    const clear = vi.fn(),
      user = userEvent.setup();
    renderWithProviders(
      <Harness rows={[thread("missing", false)]} clear={clear} />
    );
    await user.click(
      screen.getByRole("button", { name: "Move selected to trash" })
    );
    await screen.findByText(
      /refresh this folder to confirm its current location/
    );
    expect(api.createInboxMove).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
  it("shows failed mailbox outcomes, lets the user check, and refreshes mail only after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createInboxMove).mockResolvedValue(batch("a", "FAILED"));
    vi.mocked(api.getInboxMoveBatch).mockResolvedValue(batch("a", "FAILED"));
    const view = renderWithProviders(<Harness rows={[thread("a")]} />);
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    await user.click(
      screen.getByRole("button", { name: "Move selected to trash" })
    );
    await screen.findByText(/some messages could not be moved/);
    vi.mocked(api.getInboxMoveBatch).mockResolvedValue(batch("a", "DONE"));
    await user.click(screen.getByRole("button", { name: "Check status" }));
    await screen.findByText("a: 1 of 1 messages moved.");
    expect(api.checkInboxMoves).toHaveBeenCalledWith("a", "org");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["inbound-messages", "org"],
    });
  });
});
