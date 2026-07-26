export function ebayConnectNotice(result: string | null, reason: string | null, detail: string | null) {
  if (result === "connected") return "eBay seller account connected successfully.";
  if (result === "declined") return "eBay authorization was cancelled.";
  if (detail) return detail;
  switch (reason) {
    case "state":
      return "eBay authorization expired or was already used. Click Connect and finish within 10 minutes.";
    case "token":
      return "eBay token exchange failed. Verify EBAY_RUNAME, client credentials, and OAuth scopes on the API service.";
    case "identity":
      return "eBay connected but identity lookup failed. Confirm EBAY_OAUTH_SCOPES includes commerce.identity.readonly.";
    case "config":
      return "eBay seller OAuth is not configured on the API service.";
    case "callback":
      return "eBay returned an invalid authorization response. Try connecting again.";
    default:
      return "eBay connection could not be completed. Check API logs for ebay_oauth_callback_failed.";
  }
}
