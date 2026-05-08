import { useMemo } from "react";
import {
  CREATION_PATH_OPTIONS,
  type CreationPathOption,
} from "../domain/creation-path";

export function useCreationPaths(): readonly CreationPathOption[] {
  return useMemo(() => CREATION_PATH_OPTIONS, []);
}
