"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";

export function usePanelToggle(paramName: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggle = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get(paramName) === value) {
        params.delete(paramName);
      } else {
        params.set(paramName, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, paramName],
  );

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(paramName);
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams, paramName]);

  const currentValue = searchParams.get(paramName);

  return { toggle, close, currentValue } as const;
}
