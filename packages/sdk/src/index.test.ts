import { describe, expect, it } from "vitest";
import { QQueueClient } from "./index.js";

describe("QQueueClient", () => {
  it("applies the default baseUrl when none is provided", () => {
    const client = new QQueueClient({ apiKey: "key_1" });
    expect((client as unknown as { baseUrl: string }).baseUrl).toBe(
      "http://localhost:4000/api/v1"
    );
    expect((client as unknown as { apiKey: string }).apiKey).toBe("key_1");
  });

  it("applies a custom baseUrl when provided", () => {
    const client = new QQueueClient({
      apiKey: "key_2",
      baseUrl: "https://api.example.com/v1"
    });
    expect((client as unknown as { baseUrl: string }).baseUrl).toBe(
      "https://api.example.com/v1"
    );
  });

  it("rejects sendEmail with a not-implemented error", async () => {
    const client = new QQueueClient({ apiKey: "key_3" });
    await expect(
      client.sendEmail({
        organizationId: "org_1",
        to: "a@b.com",
        templateId: "tpl_1"
      })
    ).rejects.toThrow("QQueueClient.sendEmail is not implemented yet.");
  });
});
