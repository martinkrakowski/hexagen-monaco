import type { UseCase } from '../../../domain/model/use-case/use-case';

export interface IUseCaseRepository {
  save(entity: UseCase): Promise<UseCase>;
  findById(_id: string): Promise<UseCase | null>;
}
