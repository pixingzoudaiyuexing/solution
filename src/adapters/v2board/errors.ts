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

export class V2BoardRegistrationUnavailableError extends Error {
  constructor() {
    super('V2Board registration unavailable');
    this.name = 'V2BoardRegistrationUnavailableError';
  }
}

export class V2BoardVerificationError extends Error {
  constructor() {
    super('V2Board verification rejected');
    this.name = 'V2BoardVerificationError';
  }
}

export class V2BoardRateLimitedError extends Error {
  constructor() {
    super('V2Board request rate limited');
    this.name = 'V2BoardRateLimitedError';
  }
}

export class V2BoardPasswordResetError extends Error {
  constructor() {
    super('V2Board password reset rejected');
    this.name = 'V2BoardPasswordResetError';
  }
}

export class V2BoardPasswordChangeError extends Error {
  constructor() {
    super('V2Board password change rejected');
    this.name = 'V2BoardPasswordChangeError';
  }
}

export class V2BoardPreferencesUpdateError extends Error {
  constructor() {
    super('V2Board preferences update failed');
    this.name = 'V2BoardPreferencesUpdateError';
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

export class V2BoardOrderNotCancellableError extends Error {
  constructor() {
    super('V2Board order is not cancellable');
    this.name = 'V2BoardOrderNotCancellableError';
  }
}

export class V2BoardOrderCancelError extends Error {
  constructor() {
    super('V2Board order cancellation failed');
    this.name = 'V2BoardOrderCancelError';
  }
}

export class V2BoardPromotionInvalidError extends Error {
  constructor() {
    super('V2Board promotion rejected');
    this.name = 'V2BoardPromotionInvalidError';
  }
}

export class V2BoardOrderExpiredError extends Error {
  constructor() {
    super('V2Board order expired');
    this.name = 'V2BoardOrderExpiredError';
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

export class V2BoardSubscriptionUnavailableError extends Error {
  constructor() {
    super('V2Board subscription unavailable');
    this.name = 'V2BoardSubscriptionUnavailableError';
  }
}

export class V2BoardTicketNotFoundError extends Error {
  constructor() {
    super('V2Board ticket not found');
    this.name = 'V2BoardTicketNotFoundError';
  }
}

export class V2BoardTicketUnavailableError extends Error {
  constructor() {
    super('V2Board ticket creation unavailable');
    this.name = 'V2BoardTicketUnavailableError';
  }
}

export class V2BoardTicketCreateError extends Error {
  constructor() {
    super('V2Board ticket creation failed');
    this.name = 'V2BoardTicketCreateError';
  }
}

export class V2BoardTicketReplyError extends Error {
  constructor() {
    super('V2Board ticket reply failed');
    this.name = 'V2BoardTicketReplyError';
  }
}

export class V2BoardTicketCloseError extends Error {
  constructor() {
    super('V2Board ticket close failed');
    this.name = 'V2BoardTicketCloseError';
  }
}
