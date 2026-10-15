import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../test/render.js";
import { MailboxDraftReview } from "./MailboxDraftReview.js";
import { api } from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
vi.mock("../../lib/api.js", () => ({
  api: { getMailboxDraftSource: vi.fn(), prepareMailboxDraftCopy: vi.fn() },
}));
const onKeep = vi.fn();
const onOpen = vi.fn();
const state = {
  state: "UPDATED",
  currentVersion: "v2",
  reviewed: false,
  source: {
    id: "m1",
    subject: "New external writing",
    html: null,
    text: "Original text",
    to: ["to@example.test"],
    cc: ["cc@example.test"],
    bcc: ["private@example.test"],
    attachments: [{ id: "f1", filename: "private.txt", size: 9 }],
  },
};
function renderReview() {
  return renderWithProviders(
    <MailboxDraftReview
      organizationId="org1"
      userId="u1"
      draftId="d1"
      onKeep={onKeep}
      onOpen={onOpen}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMailboxDraftSource).mockResolvedValue(state as never);
  vi.mocked(api.prepareMailboxDraftCopy).mockResolvedValue({
    id: "d2",
  } as never);
  onKeep.mockResolvedValue(undefined);
  onOpen.mockResolvedValue(undefined);
});
it("shows original recipients and files before a deliberate keep choice", async () => {
  const user = userEvent.setup();
  renderReview();
  await user.click(
    await screen.findByRole("button", { name: "Review mailbox draft" })
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByText("Bcc: private@example.test")
  ).toBeInTheDocument();
  expect(within(dialog).getByText(/private.txt/)).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Keep my private copy" })
  );
  await waitFor(() => expect(onKeep).toHaveBeenCalledWith("v2"));
  expect(api.prepareMailboxDraftCopy).not.toHaveBeenCalled();
});
it("does not substitute a newly polled version for the writing actually reviewed", async () => {
  const user = userEvent.setup();
  const { queryClient } = renderReview();
  await user.click(
    await screen.findByRole("button", { name: "Review mailbox draft" })
  );
  vi.mocked(api.getMailboxDraftSource).mockResolvedValue({
    ...state,
    currentVersion: "v3",
    source: { ...state.source, subject: "Another replacement" },
  } as never);
  await queryClient.invalidateQueries({
    queryKey: qk.mailboxDraftSource("org1", "u1", "d1"),
  });
  expect(screen.getByRole("dialog")).toHaveTextContent("New external writing");
  expect(screen.getByRole("dialog")).not.toHaveTextContent(
    "Another replacement"
  );
  onKeep.mockRejectedValueOnce(new Error("Source changed again"));
  await user.click(
    screen.getByRole("button", { name: "Keep my private copy" })
  );
  await waitFor(() => expect(onKeep).toHaveBeenCalledWith("v2"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("reuses the creation identity when opening the latest copy loses its response", async () => {
  const user = userEvent.setup();
  vi.mocked(api.prepareMailboxDraftCopy).mockRejectedValueOnce(
    new Error("Connection lost")
  );
  renderReview();
  await user.click(
    await screen.findByRole("button", { name: "Review mailbox draft" })
  );
  const button = screen.getByRole("button", {
    name: "Open latest as another private copy",
  });
  await user.click(button);
  await waitFor(() =>
    expect(api.prepareMailboxDraftCopy).toHaveBeenCalledTimes(1)
  );
  expect(onOpen).not.toHaveBeenCalled();
  await user.click(button);
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ id: "d2" }));
  expect(vi.mocked(api.prepareMailboxDraftCopy).mock.calls[0]).toEqual(
    vi.mocked(api.prepareMailboxDraftCopy).mock.calls[1]
  );
  expect(api.prepareMailboxDraftCopy).toHaveBeenCalledWith(
    "m1",
    "org1",
    expect.any(String),
    "v2"
  );
});
it("keeps incomplete content out of review and prevents sending through a keep acknowledgement", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getMailboxDraftSource).mockResolvedValue({
    state: "LOADING",
    currentVersion: "v2",
    reviewed: false,
  });
  renderReview();
  await user.click(
    await screen.findByRole("button", { name: "Review mailbox draft" })
  );
  expect(
    screen.getByRole("button", { name: "Keep my private copy" })
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", {
      name: "Open latest as another private copy",
    })
  ).not.toBeInTheDocument();
});
it("makes removal or lost access explicit while retaining the private copy", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getMailboxDraftSource).mockResolvedValue({
    state: "UNAVAILABLE",
    currentVersion: "unavailable",
    reviewed: false,
  });
  renderReview();
  await user.click(
    await screen.findByRole("button", { name: "Review mailbox draft" })
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("may have been sent");
  await user.click(
    screen.getByRole("button", { name: "Keep my private copy" })
  );
  await waitFor(() => expect(onKeep).toHaveBeenCalledWith("unavailable"));
});
it("offers an honest retry when the source check fails", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getMailboxDraftSource).mockRejectedValueOnce(
    new Error("Offline")
  );
  renderReview();
  expect(
    await screen.findByText(/Couldn’t check the original/)
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check again" }));
  expect(
    await screen.findByRole("button", { name: "Review mailbox draft" })
  ).toBeInTheDocument();
});
