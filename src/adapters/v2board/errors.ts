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

export class V2BoardTimeoutError extends Error {
  constructor() {
    super('V2Board upstream request timed out');
    this.name = 'V2BoardTimeoutError';
  }
}

export class V2BoardOrderQueryError extends Error {
  constructor() {
    super('V2Board order query failed');
    this.name = 'V2BoardOrderQueryError';
  }
}

export class V2BoardOrderCreateError extends Error {
  constructor() {
    super('V2Board order creation failed');
    this.name = 'V2BoardOrderCreateError';
  }
}

export class V2BoardOrderNotFoundError extends Error {
  constructor() {
    super('V2Board order not found');
    this.name = 'V2BoardOrderNotFoundError';
  }
}

export class V2BoardPaymentMethodUnavailableError extends Error {
  constructor() {
    super('V2Board payment method unavailable');
    this.name = 'V2BoardPaymentMethodUnavailableError';
  }
}

export class V2BoardPaymentCreateError extends Error {
  constructor() {
    super('V2Board payment creation failed');
    this.name = 'V2BoardPaymentCreateError';
  }
}
