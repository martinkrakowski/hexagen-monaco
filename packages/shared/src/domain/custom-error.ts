import { BaseError } from "../errors/base.error.js";

export class CustomError extends BaseError {
  constructor(message: string) {
    super(message);
    // Set the prototype explicitly.
    Object.setPrototypeOf(this, CustomError.prototype);
  }
}
