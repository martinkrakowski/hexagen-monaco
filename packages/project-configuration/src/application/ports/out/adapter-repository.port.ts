import type { Adapter } from "../../../domain/model/adapter/adapter";

export interface IAdapterRepository {
  save(entity: Adapter): Promise<Adapter>;
  findById(_id: string): Promise<Adapter | null>;
}
