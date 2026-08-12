export class InvitationInputError extends Error {}

export class InvitationConfigurationError extends Error {
  constructor() {
    super("Invitation email delivery is not configured");
    this.code = "INVITATION_CONFIG_ERROR";
  }
}

export class InvitationAuthorizationError extends Error {
  constructor(deliveries = []) {
    super("Google Mail authorization is missing or expired");
    this.code = "INVITATION_AUTH_ERROR";
    this.deliveries = deliveries;
  }
}

export class InvitationDeliveryError extends Error {
  constructor(deliveries = []) {
    super("Invitation email delivery failed");
    this.code = "INVITATION_DELIVERY_ERROR";
    this.deliveries = deliveries;
  }
}
