"use client";

import { Suspense } from "react";

import ImportProjectSpecPage from "../../../../../features/manifest-generation/ImportProjectSpecPage";

export default function SpecPage() {
  return (
    <Suspense>
      <ImportProjectSpecPage />
    </Suspense>
  );
}
