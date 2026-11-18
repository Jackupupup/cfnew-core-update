export class UpdateError extends Error {
  constructor(code) {
    super(code);
    this.name = "UpdateError";
    this.code = code;
  }
}
