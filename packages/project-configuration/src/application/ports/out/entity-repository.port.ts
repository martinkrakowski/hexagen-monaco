import type { Entity } from "../../../domain/model/entity/entity";

export interface IEntityRepository {
  save(entity: Entity): Promise<Entity>;
  findById(_id: string): Promise<Entity | null>;
}
