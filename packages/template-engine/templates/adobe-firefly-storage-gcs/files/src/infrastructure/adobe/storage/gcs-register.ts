// @hexagen-server-only
//
// Registers the GCS presigner with the core storage seam. Import this ONCE at
// startup, before any Firefly service call:
//
//   import "./infrastructure/adobe/storage/gcs-register";
//
// Side-effect only (like the bedrock provider registration): it swaps the core
// `passthrough` default for the GCS presigner via `setStoragePresigner`, so
// service adapters resolve it through `getStoragePresigner()` with no static
// import of this addon file.
import { setStoragePresigner } from "./passthrough-storage.adapter";
import { GcsPresignStorageAdapter } from "./gcs-presign.adapter";

setStoragePresigner(new GcsPresignStorageAdapter());
