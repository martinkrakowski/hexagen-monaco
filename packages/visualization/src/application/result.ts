// TODO: Unify with @hexagen/shared Result<T, E> when consolidating
// Currently shared uses { success, value } but visualization uses { success, data }
// When unifying, change shared to use .data (more conventional)
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
