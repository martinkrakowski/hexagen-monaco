// @hexagen-server-only
//
// Registers the S3 presigner with the core storage seam. Import this ONCE at
// startup, before any Firefly service call:
//
//   import "./infrastructure/adobe/storage/s3-register";
//
// Side-effect only (like the bedrock provider registration): it swaps the core
// `passthrough` default for the S3 presigner via `setStoragePresigner`, so
// service adapters resolve it through `getStoragePresigner()` with no static
// import of this addon file.
import { setStoragePresigner } from "./passthrough-storage.adapter";
import { S3PresignStorageAdapter } from "./s3-presign.adapter";

setStoragePresigner(new S3PresignStorageAdapter());
