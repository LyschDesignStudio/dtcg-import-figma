/* An error a source answered: its status and its body. */

export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.message === "string" ? body.message : `The server answered ${status}.`);
  }
  get code() {
    return typeof this.body.error === "string" ? this.body.error : "";
  }
}
