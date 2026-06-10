import { afterEach, describe, expect, it, vi } from "vitest";
import { QQueueClient, QQueueError } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("trims trailing slashes from a custom baseUrl", () => {
    const client = new QQueueClient({
      apiKey: "key_2",
      baseUrl: "https://api.example.com/v1/"
    });
    expect((client as unknown as { baseUrl: string }).baseUrl).toBe(
      "https://api.example.com/v1"
    );
  });

  it("sends an email through the configured API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({ data: { emailJob: { id: "job_1" } } })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QQueueClient({ apiKey: "key_3" });
    const result = await client.sendEmail({
      to: "a@b.com",
      templateId: "tpl_1",
      variables: { firstName: "Ada" }
    });

    expect(result).toEqual({ id: "job_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/transactional-email/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer key_3",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: "a@b.com",
          templateId: "tpl_1",
          variables: { firstName: "Ada" }
        })
      })
    );
  });

  it("throws QQueueError for failed API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({
          error: { message: "Invalid API key" }
        })
      })
    );

    const client = new QQueueClient({ apiKey: "bad" });

    await expect(
      client.sendEmail({ to: "a@b.com", subject: "Hi", text: "Body" })
    ).rejects.toMatchObject({
      name: "QQueueError",
      status: 401,
      message: "Invalid API key"
    } satisfies Partial<QQueueError>);
  });
});
