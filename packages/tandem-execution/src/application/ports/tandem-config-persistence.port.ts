import type { Result } from "@hexagen/shared";
import type { TandemConfig } from "../../domain/index.js";

export interface TandemConfigPersistencePort {
  read(): Result<TandemConfig>;
  write(config: TandemConfig): Result<void>;
  reset(): Result<void>;
}
