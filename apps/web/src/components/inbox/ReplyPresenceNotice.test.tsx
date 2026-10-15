import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReplyPresenceNotice } from "./ReplyPresenceNotice.js";
afterEach(() => vi.useRealTimers());
it("hides this composer and expires stopped teammates without another server response", () => {
  vi.useFakeTimers();
  const expiresAt = new Date(Date.now() + 1000).toISOString();
  render(
    <ReplyPresenceNotice
      userId="me"
      clientId="this"
      participants={[
        { userId: "me", clientId: "this", name: "Self", expiresAt },
        { userId: "other", clientId: "other", name: "Ama", expiresAt },
      ]}
    />
  );
  expect(screen.getByRole("status")).toHaveTextContent("Ama is replying too");
  expect(screen.queryByText(/Self/)).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("warns about the same person's other open composer and failures without blocking writing", () => {
  render(
    <ReplyPresenceNotice
      userId="me"
      clientId="this"
      unavailable
      participants={[
        {
          userId: "me",
          clientId: "another",
          name: "Self",
          expiresAt: new Date(Date.now() + 45000).toISOString(),
        },
      ]}
    />
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "You're also replying in another tab or device"
  );
  expect(screen.getByRole("status")).toHaveTextContent("You can keep writing");
});
