import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../test/render.js";
import { ReplyDeviceCopies } from "./ReplyDeviceCopies.js";
const base = "qqueue.reply.u.o.m";
const useCopy = vi.fn().mockResolvedValue(undefined);
function renderCopies() {
  return renderWithProviders(
    <ReplyDeviceCopies
      userId="u"
      organizationId="o"
      messageId="m"
      draftId="d1"
      currentKey={`${base}.tab.current`}
      onUse={useCopy}
    />
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it("reviews a distinct scoped copy before explicitly using it", async () => {
  localStorage.setItem(
    `${base}.tab.other`,
    JSON.stringify({
      html: "<p>Other tab's unsent writing</p>",
      draftId: "d1",
      to: ["reader@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    })
  );
  localStorage.setItem(
    `${base}.tab.current`,
    JSON.stringify({ html: "current", draftId: "d1" })
  );
  localStorage.setItem(
    `${base}.tab.wrongDraft`,
    JSON.stringify({ html: "private other draft", draftId: "d2" })
  );
  renderCopies();
  await userEvent.click(
    screen.getByRole("button", { name: "Review device copies" })
  );
  expect(useCopy).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Review copy 1" }));
  expect(screen.getByTitle("Device reply copy")).toHaveAttribute(
    "srcdoc",
    expect.stringContaining("Other tab's unsent writing")
  );
  expect(screen.getByText("Bcc: bcc@example.com")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Use this device copy" })
  );
  expect(useCopy).toHaveBeenCalledWith(
    expect.objectContaining({ key: `${base}.tab.other` })
  );
  expect(localStorage.getItem(`${base}.tab.other`)).not.toBeNull();
});
it("keeps the review open when preserving current writing fails", async () => {
  useCopy.mockRejectedValueOnce(new Error("storage full"));
  localStorage.setItem(
    `${base}.tab.other`,
    JSON.stringify({ html: "copy", draftId: "d1", updatedAt: "2026-10-15" })
  );
  renderCopies();
  await userEvent.click(
    screen.getByRole("button", { name: "Review device copies" })
  );
  await userEvent.click(screen.getByRole("button", { name: /Review copy 1/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "Use this device copy" })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("storage full");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("deduplicates identical retained copies and explains an empty device history", async () => {
  renderCopies();
  await userEvent.click(
    screen.getByRole("button", { name: "Review device copies" })
  );
  expect(
    screen.getByText("No other device copies for this reply.")
  ).toBeInTheDocument();
});
