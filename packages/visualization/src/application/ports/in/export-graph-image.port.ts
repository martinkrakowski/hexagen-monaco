import type { Result } from "../../result.js";

export type ImageFormat = "png" | "jpg" | "svg";

export interface ExportGraphImageInput {
  format: ImageFormat;
  width: number;
  height: number;
  backgroundColor?: string;
}

export interface ExportGraphImageOutput {
  data: Uint8Array;
  mimeType: string;
}

export interface ExportGraphImagePort {
  exportImage(
    input: ExportGraphImageInput,
  ): Promise<Result<ExportGraphImageOutput, Error>>;
}
