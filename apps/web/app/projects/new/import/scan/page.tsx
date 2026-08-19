"use client";

import { Suspense } from "react";

import { ImportScanPage } from "../../../../../features/landing/ImportScanPage";

export default function ScanPage() {
  return (
    <Suspense>
      <ImportScanPage />
    </Suspense>
  );
}
