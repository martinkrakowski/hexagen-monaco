import { CustomError } from "@hexagen/shared";

export class Rejection extends CustomError {
  public readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
