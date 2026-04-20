import type { Metadata } from "next";
import { ProjectWorkspace } from "../features/workspace-shell/ProjectWorkspace";

export const metadata: Metadata = {
  title: "HexaGen Monaco — Project Workspace",
  description:
    "Design and generate production-ready hexagonal monorepos with DDD principles",
};

export default function Home() {
  return <ProjectWorkspace />;
}
