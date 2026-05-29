import type { UserContext } from "../../../domain/value-objects/user-context";

export function mapEmailToUserContext(email: string): UserContext {
  return {
    id: email.toLowerCase().trim(),
    email: email.toLowerCase().trim(),
    name: email.split("@")[0] ?? email,
    roles: ["user"],
  };
}
