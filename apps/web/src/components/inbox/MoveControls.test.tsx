import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { api, type InboundMessage } from "../../lib/api.js";
import { MoveControls } from "./MoveControls.js";
vi.mock("../../lib/api.js", () => ({
  api: {
    listInboxFolders: vi.fn(),
    recentInboxMoves: vi.fn(),
    getInboxMoveBatch: vi.fn(),
    createInboxMove: vi.fn(),
    checkInboxMoves: vi.fn(),
  },
}));
const mocked = vi.mocked(api);
const message = {
  id: "m1",
  inboxAccountId: "a1",
  locations: [
    {
      id: "l1",
      inboxFolderId: "f1",
      folder: { name: "Inbox", path: "INBOX", role: "INBOX", isPrimary: true },
    },
  ],
} as InboundMessage;
const counts = { PENDING: 1, PROCESSING: 0, UNCERTAIN: 0, FAILED: 0, DONE: 0 };
const batch = {
  id: "b1",
  total: 1,
  counts,
  moves: [{ id: "op1", status: "PENDING", targetPath: "Archive" }],
};
function renderMoves(messages = [message], route = "/inbox?message=m1") {
  return renderWithProviders(
    <MoveControls
      messages={messages}
      anchorId="m1"
      organizationId="org1"
      view="INBOX"
    />,
    { route }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.listInboxFolders.mockResolvedValue([
    {
      id: "f1",
      inboxAccountId: "a1",
      name: "Inbox",
      path: "INBOX",
      role: "INBOX",
      present: true,
      isPrimary: true,
    },
    {
      id: "f2",
      inboxAccountId: "a1",
      name: "Archive",
      path: "Archive",
      role: "ARCHIVE",
      present: true,
      isPrimary: false,
    },
    {
      id: "f3",
      inboxAccountId: "a1",
      name: "Trash",
      path: "Trash",
      role: "TRASH",
      present: true,
      isPrimary: false,
    },
    {
      id: "f4",
      inboxAccountId: "a1",
      name: "Projects",
      path: "Projects",
      role: "OTHER",
      present: true,
      isPrimary: false,
    },
  ]);
  mocked.recentInboxMoves.mockResolvedValue([]);
  mocked.getInboxMoveBatch.mockResolvedValue(batch as never);
  mocked.createInboxMove.mockResolvedValue(batch as never);
  mocked.checkInboxMoves.mockResolvedValue({ queued: true });
});
describe("folder action controls", () => {
  it("accepts Archive as a durable conversation request and waits for provider confirmation", async () => {
    const user = userEvent.setup();
    renderMoves();
    await user.click(
      screen.getByRole("button", { name: "Archive conversation" })
    );
    expect(mocked.createInboxMove).toHaveBeenCalledWith(
      "m1",
      "org1",
      expect.objectContaining({
        action: "ARCHIVE",
        sourceLocationId: "l1",
        scope: "CONVERSATION",
        clientId: expect.any(String),
      })
    );
    expect(
      await screen.findByText(/0 of 1 messages moved/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Archive conversation" })
    ).toBeDisabled();
    expect(screen.queryByText(/^Moved to Archive/)).not.toBeInTheDocument();
  });
  it("preserves the request identity after a lost response, including when another reply arrives", async () => {
    mocked.createInboxMove.mockRejectedValueOnce(new Error("Response lost"));
    const user = userEvent.setup();
    const { rerender } = renderMoves();
    await user.click(
      screen.getByRole("button", { name: "Archive conversation" })
    );
    await screen.findByText("Response lost");
    rerender(
      <MoveControls
        messages={[message, { ...message, id: "new_reply" }]}
        anchorId="m1"
        organizationId="org1"
        view="INBOX"
      />
    );
    await user.click(
      screen.getByRole("button", { name: "Archive conversation" })
    );
    await waitFor(() =>
      expect(mocked.createInboxMove).toHaveBeenCalledTimes(2)
    );
    expect(mocked.createInboxMove.mock.calls[0][2].clientId).toBe(
      mocked.createInboxMove.mock.calls[1][2].clientId
    );
  });
  it("selects an explicit destination and source folder", async () => {
    const user = userEvent.setup();
    renderMoves();
    await user.click(
      screen.getByRole("button", { name: "Move conversation to a folder" })
    );
    await user.click(
      await screen.findByRole("combobox", { name: "Move to folder" })
    );
    await user.click(
      await screen.findByRole("option", { name: "Projects", exact: true })
    );
    await user.click(
      screen.getByRole("button", { name: "Move conversation", exact: true })
    );
    await waitFor(() =>
      expect(mocked.createInboxMove).toHaveBeenCalledWith(
        "m1",
        "org1",
        expect.objectContaining({
          action: "MOVE",
          targetFolderId: "f4",
          sourceLocationId: "l1",
        })
      )
    );
  });
  it("restores Trash and does not offer a second Trash action", async () => {
    const user = userEvent.setup();
    renderMoves([
      {
        ...message,
        locations: [
          {
            id: "l3",
            inboxFolderId: "f3",
            folder: { path: "Trash", name: "Trash", role: "TRASH" },
          },
        ],
      },
    ]);
    await user.click(
      screen.getByRole("button", { name: "Restore conversation" })
    );
    expect(mocked.createInboxMove).toHaveBeenCalledWith(
      "m1",
      "org1",
      expect.objectContaining({ action: "RESTORE", sourceLocationId: "l3" })
    );
    expect(
      screen.queryByRole("button", { name: "Move conversation to Trash" })
    ).not.toBeInTheDocument();
  });
  it("moves to Trash through the same acceptance surface", async () => {
    const user = userEvent.setup();
    renderMoves();
    await user.click(
      screen.getByRole("button", { name: "Move conversation to Trash" })
    );
    expect(mocked.createInboxMove).toHaveBeenCalledWith(
      "m1",
      "org1",
      expect.objectContaining({ action: "TRASH" })
    );
  });
  it("checks an uncertain outcome without issuing another move command", async () => {
    const uncertain = {
      ...batch,
      counts: { ...counts, PENDING: 0, UNCERTAIN: 1 },
      moves: [
        {
          ...batch.moves[0],
          status: "UNCERTAIN",
          error: "Outcome not confirmed; cached writing is kept.",
        },
      ],
    };
    mocked.recentInboxMoves.mockResolvedValue([uncertain] as never);
    mocked.getInboxMoveBatch.mockResolvedValue(uncertain as never);
    const user = userEvent.setup();
    renderMoves();
    expect(
      await screen.findByText("Outcome not confirmed; cached writing is kept.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Archive conversation" })
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() =>
      expect(mocked.checkInboxMoves).toHaveBeenCalledWith("m1", "org1")
    );
    expect(mocked.createInboxMove).not.toHaveBeenCalled();
  });
  it("shows confirmed completion and keeps failed outcomes distinct", async () => {
    const done = { ...batch, counts: { ...counts, PENDING: 0, DONE: 1 } };
    mocked.recentInboxMoves.mockResolvedValue([done] as never);
    mocked.getInboxMoveBatch.mockResolvedValue(done as never);
    renderMoves();
    expect(await screen.findByText("Moved to Archive.")).toBeInTheDocument();
  });
  it("reports failures without claiming that mail was moved", async () => {
    const failed = {
      ...batch,
      counts: { ...counts, PENDING: 0, FAILED: 1 },
      moves: [
        {
          ...batch.moves[0],
          status: "FAILED",
          error: "Destination disappeared",
        },
      ],
    };
    mocked.recentInboxMoves.mockResolvedValue([failed] as never);
    mocked.getInboxMoveBatch.mockResolvedValue(failed as never);
    renderMoves();
    expect(
      await screen.findByText("Destination disappeared")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 message could not be moved/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Moved to Archive/)).not.toBeInTheDocument();
  });
  it("does not invent a folder action when no server location is known", async () => {
    renderMoves([{ ...message, locations: [] }]);
    await waitFor(() => expect(mocked.recentInboxMoves).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Archive conversation" })
    ).not.toBeInTheDocument();
  });
});

it("does not retain a different source folder after the move dialog is cancelled", async () => {
  const user = userEvent.setup();
  renderMoves([
    {
      ...message,
      locations: [
        ...message.locations!,
        {
          id: "sent",
          inboxFolderId: "sent",
          folder: { path: "Sent", name: "Sent", role: "SENT" },
        },
      ],
    },
  ]);
  await user.click(
    screen.getByRole("button", { name: "Move conversation to a folder" })
  );
  await user.click(screen.getByRole("combobox", { name: "Move from folder" }));
  await user.click(screen.getByRole("option", { name: "Sent", exact: true }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(
    screen.getByRole("button", { name: "Archive conversation" })
  );
  expect(mocked.createInboxMove).toHaveBeenCalledWith(
    "m1",
    "org1",
    expect.objectContaining({ sourceLocationId: "l1" })
  );
});

it("starts a new deliberate attempt after an accepted move fails", async () => {
  const failed = {
    ...batch,
    clientId: "old",
    counts: { ...counts, PENDING: 0, FAILED: 1 },
    moves: [
      { ...batch.moves[0], status: "FAILED", error: "Folder was unavailable" },
    ],
  };
  mocked.createInboxMove.mockImplementationOnce(
    async (_id, _org, input) =>
      ({ ...failed, clientId: input.clientId }) as never
  );
  mocked.getInboxMoveBatch.mockResolvedValue(failed as never);
  const user = userEvent.setup();
  renderMoves();
  await user.click(
    screen.getByRole("button", { name: "Archive conversation" })
  );
  await screen.findByText("Folder was unavailable");
  await user.click(
    screen.getByRole("button", { name: "Archive conversation" })
  );
  await waitFor(() => expect(mocked.createInboxMove).toHaveBeenCalledTimes(2));
  expect(mocked.createInboxMove.mock.calls[0][2].clientId).not.toBe(
    mocked.createInboxMove.mock.calls[1][2].clientId
  );
});

it("keeps the move dialog stable until its acceptance response arrives", async () => {
  let accept!: (value: never) => void;
  mocked.createInboxMove.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      })
  );
  const user = userEvent.setup();
  renderMoves();
  await user.click(
    screen.getByRole("button", { name: "Move conversation to a folder" })
  );
  await user.click(screen.getByRole("combobox", { name: "Move to folder" }));
  await user.click(
    await screen.findByRole("option", { name: "Projects", exact: true })
  );
  await user.click(
    screen.getByRole("button", { name: "Move conversation", exact: true })
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("dialog", { name: "Move conversation" })
  ).toBeInTheDocument();
  accept(batch as never);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  );
});
