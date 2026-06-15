import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const getObject = vi.fn();
vi.mock("./storage.js", () => ({
  storage: { getObject, putObject: vi.fn(), deleteObject: vi.fn() }
}));

const { loadAttachmentsForJob } = await import("./attachments.js");

beforeEach(() => {
  getObject.mockReset();
});

describe("loadAttachmentsForJob", () => {
  it("returns undefined when the job has no attachments", async () => {
    prismaMock.emailAttachment.findMany.mockResolvedValue([] as never);

    const result = await loadAttachmentsForJob("ej1");

    expect(result).toBeUndefined();
    expect(getObject).not.toHaveBeenCalled();
  });

  it("maps rows to Nodemailer payloads, streaming each blob from storage", async () => {
    prismaMock.emailAttachment.findMany.mockResolvedValue([
      {
        filename: "a.pdf",
        contentType: "application/pdf",
        storageKey: "k1"
      },
      {
        filename: "b.png",
        contentType: "image/png",
        storageKey: "k2"
      }
    ] as never);
    getObject.mockImplementation((key: string) =>
      Promise.resolve(Buffer.from(`blob:${key}`))
    );

    const result = await loadAttachmentsForJob("ej1");

    expect(prismaMock.emailAttachment.findMany).toHaveBeenCalledWith({
      where: { emailJobId: "ej1" }
    });
    expect(result).toEqual([
      {
        filename: "a.pdf",
        content: Buffer.from("blob:k1"),
        contentType: "application/pdf"
      },
      {
        filename: "b.png",
        content: Buffer.from("blob:k2"),
        contentType: "image/png"
      }
    ]);
  });
});
