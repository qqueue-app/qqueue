import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LegalPage } from "./Legal.js";

type Kind = "terms" | "privacy" | "licensing" | "trademark";

function renderPage(kind: Kind) {
  return render(
    <MemoryRouter>
      <LegalPage kind={kind} />
    </MemoryRouter>
  );
}

const pages: Array<{ kind: Kind; title: string; effectiveDate: string }> = [
  {
    kind: "terms",
    title: "QQueue Cloud Terms of Service",
    effectiveDate: "Draft - not yet effective"
  },
  {
    kind: "privacy",
    title: "QQueue Privacy Policy",
    effectiveDate: "Draft - not yet effective"
  },
  {
    kind: "licensing",
    title: "QQueue Licensing",
    effectiveDate: "Current repository summary"
  },
  {
    kind: "trademark",
    title: "QQueue Trademark Notice",
    effectiveDate: "Current repository summary"
  }
];

describe("LegalPage", () => {
  it.each(pages)("renders the $kind page heading and date", ({ kind, title, effectiveDate }) => {
    renderPage(kind);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(`Effective Date: ${effectiveDate}`)).toBeInTheDocument();
  });

  it.each(pages)("renders section headings and body copy for $kind", ({ kind }) => {
    renderPage(kind);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
    // Intro paragraphs always render above the sections.
    expect(screen.getAllByText(/QQueue/).length).toBeGreaterThan(0);
  });

  // Only the two draft documents carry the lawyer-review notice.
  it.each([
    { kind: "terms" as const, shown: true },
    { kind: "privacy" as const, shown: true },
    { kind: "licensing" as const, shown: false },
    { kind: "trademark" as const, shown: false }
  ])("$kind draft notice shown: $shown", ({ kind, shown }) => {
    renderPage(kind);
    const notice = screen.queryByRole("heading", {
      level: 2,
      name: "Draft Legal Review Notice"
    });
    expect(notice === null).toBe(!shown);
  });

  it("renders bulleted lists where a section declares bullets", () => {
    renderPage("terms");
    const accountsHeading = screen.getByRole("heading", { level: 2, name: "2. Accounts" });
    const section = accountsHeading.closest("section");
    expect(section).not.toBeNull();
    expect(within(section!).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("omits the list for sections without bullets", () => {
    renderPage("trademark");
    const heading = screen.getByRole("heading", { level: 2, name: "Use of Marks" });
    const section = heading.closest("section");
    expect(within(section!).queryByRole("listitem")).toBeNull();
  });

  it("links back home and across the legal footer", () => {
    renderPage("terms");
    expect(screen.getByRole("link", { name: /QQueue/ })).toHaveAttribute("href", "/");
    for (const [name, href] of [
      ["Terms", "/terms"],
      ["Privacy", "/privacy"],
      ["Licensing", "/licensing"],
      ["Trademark", "/trademark"]
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});
