"use client";

import { useState } from "react";

export interface BundleIntakeProps {
  readonly onFile: (file: File) => void;
}

/**
 * File picker and drop zone. It only hands the chosen `File` to `onFile`; the
 * container reads it in memory (BW-D2: never uploaded, never stored).
 */
export function BundleIntake({ onFile }: BundleIntakeProps) {
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid="bundle-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file !== undefined) onFile(file);
      }}
      className={`rounded-lg border-2 border-dashed p-6 text-sm ${over ? "bg-muted" : ""}`}
    >
      <label className="block font-medium" htmlFor="bundle-file">
        Open a workbook bundle (.zip)
      </label>
      <input
        id="bundle-file"
        type="file"
        accept=".zip,application/zip"
        className="mt-2 block text-sm"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) onFile(file);
          e.target.value = "";
        }}
      />
      <p className="mt-2 text-muted-foreground">
        Drop a bundle written by <code>hexagen workbook export</code>. It is
        read in this browser tab only. It is never uploaded or stored.
      </p>
    </div>
  );
}
