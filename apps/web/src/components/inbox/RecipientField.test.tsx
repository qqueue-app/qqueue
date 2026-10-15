import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../test/render.js";
import { RecipientField } from "./RecipientField.js";

function Field({
  send = vi.fn(),
  pending = "",
}: {
  send?: () => void;
  pending?: string;
}) {
  const [emails, setEmails] = useState<string[]>([]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <RecipientField
        id="to"
        label="To"
        emails={emails}
        onChange={setEmails}
        pendingValue={pending}
      />
      <button>Send</button>
    </form>
  );
}
describe("recipient entry", () => {
  it("retains an invalid address and prevents a form submit after blur", async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    renderWithProviders(<Field send={send} />);
    const input = screen.getByRole("combobox", { name: "To" });
    await user.type(input, "unfinished@");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(input).toHaveValue("unfinished@");
    expect(input).toBeInvalid();
    expect(send).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "person@example.com{Enter}");
    expect(screen.getByText("person@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(send).toHaveBeenCalledOnce();
  });
  it("keeps invalid pasted entries while committing the valid recipients", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Field />);
    const input = screen.getByRole("combobox", { name: "To" });
    await user.type(input, "one@example.com;broken{Enter}");
    expect(screen.getByText("one@example.com")).toBeInTheDocument();
    expect(input).toHaveValue("broken");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("broken");
  });
  it("validates a restored incomplete address before a submission", () => {
    renderWithProviders(<Field pending="saved-incomplete" />);
    expect(screen.getByRole("combobox", { name: "To" })).toBeInvalid();
  });
});
