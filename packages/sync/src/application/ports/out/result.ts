// Re-export the generic Result type from the shared package.
// This barrel allows the sync domain to import Result without
// referencing the shared package directly, making the import path
// stable even if the implementation location changes.
//
// Example usage:
//   import { Result } from '@hexagen/sync/application/ports/out/result';
//
export type { Result } from '@hexagen/shared';
