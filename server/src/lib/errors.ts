export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly title = statusCode >= 500 ? "Internal Server Error" : "Request Rejected",
  ) {
    super(message)
    this.name = "HttpError"
  }
}

export class ForbiddenRoleError extends HttpError {
  constructor() {
    super(403, "forbidden_role", "Your role does not allow this action.", "Forbidden")
    this.name = "ForbiddenRoleError"
  }
}
