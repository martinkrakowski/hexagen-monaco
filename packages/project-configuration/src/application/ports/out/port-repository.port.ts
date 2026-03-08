import type { Port } from '../../../domain/model/port/port';

export interface IPortRepository {
  save(entity: Port): Promise<Port>;
  findById(_id: string): Promise<Port | null>;
}
