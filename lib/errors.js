export class VisionInputError extends Error {}
export class VisionApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export class VisionTimeoutError extends Error {}
