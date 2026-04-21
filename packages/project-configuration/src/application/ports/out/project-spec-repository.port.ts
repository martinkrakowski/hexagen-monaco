import type { ProjectSpec } from "../../../domain/model/project-spec/project-spec";

export interface IProjectSpecRepository {
  save(entity: ProjectSpec): Promise<ProjectSpec>;
  findById(_id: string): Promise<ProjectSpec | null>;
}
