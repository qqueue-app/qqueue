import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  SMTPConnectionForm,
  emptySMTPConnectionForm,
} from "./SMTPConnectionForm.js";

function renderForm(
  props: Partial<ComponentProps<typeof SMTPConnectionForm>> = {}
) {
  return render(
    <SMTPConnectionForm
      footer={<button type="submit">Save</button>}
      onSubmit={vi.fn()}
      {...props}
    />
  );
}

// First checkbox in the form is "Secure TLS" (the second is default-sender).
function secureCheckbox() {
  return screen.getAllByRole("checkbox")[0];
}

describe("SMTPConnectionForm", () => {
  it("syncs Secure TLS with well-known ports", async () => {
    renderForm();
    const port = screen.getByLabelText("Port");

    await userEvent.clear(port);
    await userEvent.type(port, "465");
    expect(secureCheckbox()).toHaveAttribute("aria-checked", "true");

    await userEvent.clear(port);
    await userEvent.type(port, "587");
    expect(secureCheckbox()).toHaveAttribute("aria-checked", "false");
  });

  it("reports the synced port and secure pair through onChange", async () => {
    const onChange = vi.fn();
    renderForm({ onChange });
    const port = screen.getByLabelText("Port");

    await userEvent.clear(port);
    await userEvent.type(port, "465");

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: "465", secure: true })
    );
  });

  it("lets a manual toggle stand until the port changes to a known value", async () => {
    renderForm();

    await userEvent.click(secureCheckbox());
    expect(secureCheckbox()).toHaveAttribute("aria-checked", "true");

    // Unrelated edits leave the manual choice alone.
    await userEvent.type(screen.getByLabelText("Host"), "smtp.example.com");
    expect(secureCheckbox()).toHaveAttribute("aria-checked", "true");

    const port = screen.getByLabelText("Port");
    await userEvent.clear(port);
    await userEvent.type(port, "25");
    expect(secureCheckbox()).toHaveAttribute("aria-checked", "false");
  });

  it("leaves Secure TLS alone for unknown ports", async () => {
    renderForm({
      initial: { ...emptySMTPConnectionForm, port: "465", secure: true },
    });
    const port = screen.getByLabelText("Port");

    await userEvent.clear(port);
    await userEvent.type(port, "8025");
    expect(secureCheckbox()).toHaveAttribute("aria-checked", "true");
  });

  it("renders an initial 465/secure connection without firing onChange", () => {
    const onChange = vi.fn();
    renderForm({
      initial: { ...emptySMTPConnectionForm, port: "465", secure: true },
      onChange,
    });

    expect(secureCheckbox()).toHaveAttribute("aria-checked", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains the port/TLS pairing next to the checkbox", () => {
    renderForm();
    expect(
      screen.getByText(/port 465 \(implicit TLS\)/)
    ).toBeInTheDocument();
  });
});
