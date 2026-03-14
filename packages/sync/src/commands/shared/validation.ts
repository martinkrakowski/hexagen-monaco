export const CONTEXT_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const PORT_NAME_PATTERN = /^[A-Z][a-zA-Z0-9]*$/;
export const PACKAGE_NAME_PATTERN = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

export function isValidContextName(name: string): boolean {
  return CONTEXT_NAME_PATTERN.test(name);
}

export function isValidPortName(name: string): boolean {
  return PORT_NAME_PATTERN.test(name);
}

export function isValidPackageName(name: string): boolean {
  return PACKAGE_NAME_PATTERN.test(name);
}

export function isPascalCase(str: string): boolean {
  return PORT_NAME_PATTERN.test(str);
}

export function isSnakeCase(str: string): boolean {
  return CONTEXT_NAME_PATTERN.test(str);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateContextName(name: string): ValidationResult {
  const errors: string[] = [];

  if (!name) {
    errors.push("Context name cannot be empty");
  } else if (!isValidContextName(name)) {
    errors.push(
      "Context name must be snake_case (e.g., 'user_auth', 'payment_processing')",
    );
  }

  return { valid: errors.length === 0, errors };
}

export function validatePortName(name: string): ValidationResult {
  const errors: string[] = [];

  if (!name) {
    errors.push("Port name cannot be empty");
  } else if (!isValidPortName(name)) {
    errors.push(
      "Port name must be PascalCase (e.g., 'UserRepository', 'PaymentPort')",
    );
  }

  return { valid: errors.length === 0, errors };
}
