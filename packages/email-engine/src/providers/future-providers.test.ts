import { describe, expect, it } from "vitest";
import {
  BrevoProvider,
  MailcowSMTPProvider,
  PostmarkProvider,
  ResendProvider,
  SESProvider
} from "./future-providers.js";

const payload = {
  from: "from@example.com",
  to: "to@example.com",
  subject: "Hi"
};

const cases = [
  ["MailcowSMTPProvider", MailcowSMTPProvider],
  ["SESProvider", SESProvider],
  ["ResendProvider", ResendProvider],
  ["BrevoProvider", BrevoProvider],
  ["PostmarkProvider", PostmarkProvider]
] as const;

describe("future providers", () => {
  for (const [name, Provider] of cases) {
    it(`${name}.send() rejects with a not-implemented error`, async () => {
      const provider = new Provider();
      await expect(provider.send(payload)).rejects.toThrow(
        `${name} is not implemented yet.`
      );
    });
  }
});
