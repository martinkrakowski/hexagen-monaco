import { SemanticPatch } from '../../../domain/model/semantic-patch/semantic-patch';

export interface TsMorphPort {
  parseToAst: (code: string) => unknown;
  generatePatchFromAst: (oldAst: unknown, newAst: unknown) => SemanticPatch;
}
