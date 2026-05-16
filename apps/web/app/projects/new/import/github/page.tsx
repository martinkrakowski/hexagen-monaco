"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GitHubImportStubPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/projects/new/import?highlight=github");
  }, [router]);

  return null;
}
