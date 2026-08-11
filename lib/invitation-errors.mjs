export class InvitationInputError extends Error {}

export class InvitationConfigurationError extends Error {
  constructor() {
    super("Invitation email delivery is not configured");
    this.code = "INVITATION_CONFIG_ERROR";
  }
}

export class InvitationAuthorizationError extends Error {
  constructor() {
    super("Google Mail authorization is missing or expired");
    this.code = "INVITATION_AUTH_ERROR";
  }
}

export class InvitationDeliveryError extends Error {
  constructor() {
    super("Invitation email delivery failed");
    this.code = "INVITATION_DELIVERY_ERROR";
  }
}
