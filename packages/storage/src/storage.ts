import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

export interface StorageConfig {
  /**
   * S3-compatible endpoint. Set for MinIO / non-AWS providers
   * (e.g. `http://localhost:9000`). Omit to use the real AWS S3.
   */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required for MinIO and most self-hosted S3-compatibles. */
  forcePathStyle?: boolean;
}

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

/** Minimal surface of S3Client used here — lets tests inject a fake. */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

interface GetObjectResponse {
  Body?: { transformToByteArray(): Promise<Uint8Array> };
}

/**
 * Thin wrapper over the AWS S3 v3 client that works against both real AWS S3 and
 * S3-compatible stores (MinIO for self-host). Metadata lives in Postgres; only
 * opaque blobs live here, addressed by `storageKey`.
 */
export class StorageClient {
  private readonly client: S3Like;
  private readonly bucket: string;

  constructor(config: StorageConfig, client?: S3Like) {
    this.bucket = config.bucket;
    this.client =
      client ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      });
  }

  /**
   * Create the configured bucket if it does not already exist. Idempotent and
   * safe to call on every startup.
   */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // Bucket missing (or not yet visible) — fall through to create it.
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      // A concurrent startup may have created it first; that is not an error.
      const name = (error as { name?: string })?.name ?? "";
      if (
        name !== "BucketAlreadyOwnedByYou" &&
        name !== "BucketAlreadyExists"
      ) {
        throw error;
      }
    }
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType
      })
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const response = (await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    )) as GetObjectResponse;

    if (!response.Body) {
      throw new Error(`Storage object not found: ${key}`);
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }
}
