import type { ValidateSpecPort } from "../ports/in/validate-spec.port";
import type {
  ValidateSpecRequest,
  ValidateSpecResponse,
} from "../ports/in/validate-spec.port";

export class ValidateSpecUseCase implements ValidateSpecPort {
  async execute(_data: ValidateSpecRequest): Promise<ValidateSpecResponse> {
    void _data; // TODO: Implement use case logic
    return { success: true };
  }
}
