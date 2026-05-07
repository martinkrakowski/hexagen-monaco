import type { ProjectConfig } from "@hexagen/project-configuration";

export interface ProjectSuccessResponse {
  id: string;
  name: string;
  formState: ProjectConfig;
  manifestYaml: string;
  createdAt: number;
  lastModifiedAt: number;
}

export interface ProjectErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}
