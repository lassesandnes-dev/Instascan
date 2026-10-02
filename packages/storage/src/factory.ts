import path from "node:path";
import { LocalFileStorage } from "./local";
import { S3Storage } from "./s3";
import type { ObjectStorage } from "./types";

/**
 * Build storage from environment:
 *   STORAGE_DRIVER=local  STORAGE_LOCAL_ROOT=./.data/storage
 *   STORAGE_DRIVER=s3     S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 */
export function createStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    if (!env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    return new S3Storage({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === "true" : undefined,
    });
  }
  if (driver === "local") {
    return new LocalFileStorage(env.STORAGE_LOCAL_ROOT ?? path.resolve(process.cwd(), ".data/storage"));
  }
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}
