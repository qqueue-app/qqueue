import { describe, expect, it } from "vitest";
import {
  parseDsnRecipientReports,
  scanDsnTextForBounce,
} from "./dsn-report.js";

describe("parseDsnRecipientReports", () => {
  it("extracts a structured failed-recipient report", () => {
    expect(
      parseDsnRecipientReports(
        [
          "Reporting-MTA: dns; mx.example.test",
          "",
          "Final-Recipient: rfc822; Person@Example.com",
          "Action: failed",
          "Status: 5.1.1",
          "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
        ].join("\r\n")
      )
    ).toEqual([
      {
        recipient: "person@example.com",
        action: "failed",
        status: "5.1.1",
        diagnosticCode: "smtp; 550 5.1.1 user unknown",
      },
    ]);
  });
});

describe("scanDsnTextForBounce", () => {
  it("recovers an unstructured daemon failure but ignores delay notices", () => {
    expect(
      scanDsnTextForBounce({
        subject: "Undelivered Mail Returned to Sender",
        text: "<outside@example.net>: 550 5.1.1 user unknown",
      })
    ).toEqual([
      {
        recipient: "outside@example.net",
        action: "failed",
        status: "5.1.1",
        diagnosticCode: "<outside@example.net>: 550 5.1.1 user unknown",
      },
    ]);

    expect(
      scanDsnTextForBounce({
        subject: "Delivery delayed",
        text: "Mail to later@example.net has not yet been delivered. Will keep trying. 4.4.1",
      })
    ).toEqual([]);
  });
});
