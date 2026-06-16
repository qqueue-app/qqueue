import { describe, expect, it } from "vitest";
import { classifyBounce } from "./bounce.js";

describe("classifyBounce", () => {
  it("classifies permanent 5xx rejections as HARD", () => {
    expect(classifyBounce({ code: 550 })).toBe("HARD");
    expect(classifyBounce({ message: "550 5.1.1 No such user here" })).toBe(
      "HARD"
    );
    expect(
      classifyBounce({ message: "Recipient address rejected: User unknown" })
    ).toBe("HARD");
    expect(classifyBounce({ code: "5.1.1" })).toBe("HARD");
  });

  it("classifies transient 4xx rejections as SOFT", () => {
    expect(classifyBounce({ code: 421 })).toBe("SOFT");
    expect(
      classifyBounce({ message: "452 4.2.2 Mailbox full, over quota" })
    ).toBe("SOFT");
    expect(
      classifyBounce({ message: "Greylisted, please try again later" })
    ).toBe("SOFT");
    expect(classifyBounce({ message: "421 4.7.0 Server busy, try again" })).toBe(
      "SOFT"
    );
  });

  it("treats a 5xx phrased as a transient condition as SOFT", () => {
    // Phrasing wins over numeric class: a permanent code that describes a
    // temporary problem should not permanently suppress.
    expect(
      classifyBounce({ message: "552 5.2.2 Mailbox is full" })
    ).toBe("SOFT");
  });

  it("classifies policy/reputation blocks as BLOCK", () => {
    expect(
      classifyBounce({ message: "550 5.7.1 Message blocked as spam" })
    ).toBe("BLOCK");
    expect(
      classifyBounce({ message: "Your IP is on a blacklist" })
    ).toBe("BLOCK");
    expect(
      classifyBounce({ message: "554 rejected due to policy reasons" })
    ).toBe("BLOCK");
  });

  it("defaults to HARD for unclassifiable input (no regression vs pre-D)", () => {
    expect(classifyBounce({})).toBe("HARD");
    expect(classifyBounce({ message: "" })).toBe("HARD");
    expect(classifyBounce({ message: "something unexpected" })).toBe("HARD");
  });
});
