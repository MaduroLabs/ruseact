export type DomHostErrorCode =
  | "disposed_context"
  | "detached_node"
  | "foreign_document"
  | "foreign_node"
  | "invalid_attribute"
  | "invalid_attribute_value"
  | "invalid_element_name"
  | "invalid_insertion_anchor"
  | "invalid_listener"
  | "invalid_listener_options"
  | "invalid_node"
  | "invalid_parent"
  | "invalid_parent_child"
  | "invalid_property"
  | "invalid_property_value"
  | "unsupported_namespace";

/** Internal host-adapter failure; it is not part of the public package API. */
export class DomHostError extends Error {
  readonly code: DomHostErrorCode;
  readonly operation: string;

  constructor(code: DomHostErrorCode, operation: string, message: string) {
    super(`${operation}: ${message}`);
    this.name = "DomHostError";
    this.code = code;
    this.operation = operation;
  }
}

export function hostError(
  code: DomHostErrorCode,
  operation: string,
  message: string,
): DomHostError {
  return new DomHostError(code, operation, message);
}
