import { describe, expect, it, vi } from "vitest";
import { StorageClient, type S3Like } from "./storage.js";

const config = {
  region: "us-east-1",
  bucket: "qqueue-attachments",
  accessKeyId: "key",
  secretAccessKey: "secret",
  endpoint: "http://localhost:9000",
  forcePathStyle: true
};

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

function commandInput(command: unknown): Record<string, unknown> {
  return (command as { input: Record<string, unknown> }).input;
}

describe("StorageClient", () => {
  it("putObject sends a PutObjectCommand with the bucket, key, body and type", async () => {
    const send = vi.fn().mockResolvedValue({});
    const fake: S3Like = { send };
    const storage = new StorageClient(config, fake);

    await storage.putObject({
      key: "org/o1/file.pdf",
      body: Buffer.from("hello"),
      contentType: "application/pdf"
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(commandName(command)).toBe("PutObjectCommand");
    expect(commandInput(command)).toMatchObject({
      Bucket: "qqueue-attachments",
      Key: "org/o1/file.pdf",
      ContentType: "application/pdf"
    });
  });

  it("getObject returns the object bytes as a Buffer", async () => {
    const bytes = new TextEncoder().encode("file-contents");
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(bytes) }
    });
    const storage = new StorageClient(config, { send });

    const result = await storage.getObject("org/o1/file.pdf");

    expect(commandName(send.mock.calls[0][0])).toBe("GetObjectCommand");
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe("file-contents");
  });

  it("getObject throws when the object has no body", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new StorageClient(config, { send });

    await expect(storage.getObject("missing")).rejects.toThrow(
      /Storage object not found/
    );
  });

  it("deleteObject sends a DeleteObjectCommand", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new StorageClient(config, { send });

    await storage.deleteObject("org/o1/file.pdf");

    const command = send.mock.calls[0][0];
    expect(commandName(command)).toBe("DeleteObjectCommand");
    expect(commandInput(command)).toMatchObject({
      Bucket: "qqueue-attachments",
      Key: "org/o1/file.pdf"
    });
  });

  it("ensureBucket does nothing when the bucket already exists", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new StorageClient(config, { send });

    await storage.ensureBucket();

    expect(send).toHaveBeenCalledTimes(1);
    expect(commandName(send.mock.calls[0][0])).toBe("HeadBucketCommand");
  });

  it("ensureBucket creates the bucket when HeadBucket fails", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "NotFound" }))
      .mockResolvedValueOnce({});
    const storage = new StorageClient(config, { send });

    await storage.ensureBucket();

    expect(send).toHaveBeenCalledTimes(2);
    expect(commandName(send.mock.calls[1][0])).toBe("CreateBucketCommand");
  });

  it("ensureBucket swallows a concurrent-create race", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("not found"))
      .mockRejectedValueOnce(
        Object.assign(new Error("exists"), { name: "BucketAlreadyOwnedByYou" })
      );
    const storage = new StorageClient(config, { send });

    await expect(storage.ensureBucket()).resolves.toBeUndefined();
  });

  it("ensureBucket rethrows unexpected create errors", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("not found"))
      .mockRejectedValueOnce(
        Object.assign(new Error("denied"), { name: "AccessDenied" })
      );
    const storage = new StorageClient(config, { send });

    await expect(storage.ensureBucket()).rejects.toThrow(/denied/);
  });
});
