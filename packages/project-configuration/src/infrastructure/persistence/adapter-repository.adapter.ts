import type { IAdapterRepository } from '../../application/ports/out/adapter-repository.port';
import type { Adapter } from '../../domain/model/adapter/adapter';

export class AdapterRepositoryAdapter implements IAdapterRepository {
  async save(entity: Adapter): Promise<Adapter> {
    // TODO: real persistence
    return entity;
  }

  async findById(_id: string): Promise<Adapter | null> {
    // TODO: real query
    void _id;
    return null;
  }
}
