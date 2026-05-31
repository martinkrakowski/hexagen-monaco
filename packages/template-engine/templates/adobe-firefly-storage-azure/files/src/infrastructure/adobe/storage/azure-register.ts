// @hexagen-server-only
//
// Registers the Azure Blob presigner with the core storage seam. Import this ONCE
// at startup, before any Firefly service call:
//
//   import "./infrastructure/adobe/storage/azure-register";
//
// Side-effect only (like the bedrock provider registration): it swaps the core
// `passthrough` default for the Azure presigner via `setStoragePresigner`, so
// service adapters resolve it through `getStoragePresigner()` with no static
// import of this addon file.
import { setStoragePresigner } from "./passthrough-storage.adapter";
import { AzureBlobPresignStorageAdapter } from "./azure-blob-presign.adapter";

setStoragePresigner(new AzureBlobPresignStorageAdapter());
