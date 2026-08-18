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
      json: vi.fn().mockResolvedValue({
        data: { id: "job_1", status: "QUEUED" }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QQueueClient({ apiKey: "key_3" });
    const result = await client.sendEmail({
      to: "a@b.com",
      templateId: "tpl_1",
      variables: { firstName: "Ada" }
    });

    expect(result).toEqual({ id: "job_1", status: "QUEUED" });
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

  it("forwards inline attachments in the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({
        data: { id: "job_1", status: "QUEUED" }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QQueueClient({ apiKey: "key_3" });
    const attachments = [
      {
        filename: "qr.png",
        contentBase64: "cGluZy1ieXRlcw==",
        contentType: "image/png",
        cid: "ticket-qr"
      }
    ];
    await client.sendEmail({
      to: "a@b.com",
      subject: "Ticket",
      html: '<img src="cid:ticket-qr" />',
      attachments
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.attachments).toEqual(attachments);
  });

  it("sends the Idempotency-Key header only when a key is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({
        data: { id: "job_1", status: "QUEUED" }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QQueueClient({ apiKey: "key_3" });
    await client.sendEmail(
      { to: "a@b.com", subject: "Hi", text: "Body" },
      { idempotencyKey: "otp-42" }
    );
    await client.sendEmail({ to: "a@b.com", subject: "Hi", text: "Body" });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "Idempotency-Key": "otp-42"
    });
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty(
      "Idempotency-Key"
    );
  });

  it("accepts the legacy nested send response while self-hosted APIs upgrade", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          data: { emailJob: { id: "job_1", status: "SENT" } }
        })
      })
    );

    const client = new QQueueClient({ apiKey: "key_3" });
    await expect(
      client.sendEmail({ to: "a@b.com", subject: "Hi", text: "Body" })
    ).resolves.toEqual({ id: "job_1", status: "SENT" });
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
      code: undefined,
      message: "Invalid API key"
    } satisfies Partial<QQueueError>);
  });

  it("preserves API error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: {
            code: "validation_error",
            message: "Invalid request body"
          }
        })
      })
    );

    const client = new QQueueClient({ apiKey: "key_3" });

    await expect(
      client.sendEmail({ to: "not-an-email", subject: "Hi", text: "Body" })
    ).rejects.toMatchObject({
      status: 400,
      code: "validation_error",
      message: "Invalid request body"
    } satisfies Partial<QQueueError>);
  });
});
