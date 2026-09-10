export class V2BoardAuthenticationError extends Error {
  constructor() {
    super('V2Board authentication rejected');
    this.name = 'V2BoardAuthenticationError';
  }
}

export class V2BoardValidationError extends Error {
  constructor() {
    super('V2Board validation rejected');
    this.name = 'V2BoardValidationError';
  }
}

export class V2BoardUpstreamError extends Error {
  constructor() {
    super('V2Board upstream request failed');
    this.name = 'V2BoardUpstreamError';
  }
}
