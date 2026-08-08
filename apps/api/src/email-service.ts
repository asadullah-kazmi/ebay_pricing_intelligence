import nodemailer from "nodemailer";
import { getConfig } from "./config.js";

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

let transporter: nodemailer.Transporter | undefined;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function emailTransport() {
  const config = getConfig().email;
  if (!config) throw new EmailDeliveryError("Email delivery is not configured");
  transporter ??= nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return { transporter, from: config.from };
}

export function emailIsConfigured() {
  return Boolean(getConfig().email);
}

export async function verifyEmailTransport() {
  const transport = emailTransport();
  await transport.transporter.verify();
  return { configured: true, host: getConfig().email!.host, port: getConfig().email!.port, from: transport.from };
}

function renderBrandedEmail(input: { heading: string; message: string; action: string; url: string }) {
  const heading = escapeHtml(input.heading);
  const message = escapeHtml(input.message);
  const action = escapeHtml(input.action);
  const url = escapeHtml(input.url);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f7f9fc;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f9fc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(11,20,38,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0b1426,#132038);padding:22px 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:34px;height:34px;border-radius:9px;background:linear-gradient(145deg,#3b82f6,#0055ff);text-align:center;vertical-align:middle;">
                    <span style="display:inline-block;width:18px;height:2px;background:#ffffff;border-radius:2px;box-shadow:0 5px 0 #ffffff,0 10px 0 #ffffff;"></span>
                  </td>
                  <td style="padding-left:12px;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;">
                    Part<span style="color:#93c5fd;">Pulse</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#0055ff;">PartPulse</p>
              <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;letter-spacing:-0.8px;color:#0f172a;font-weight:800;">${heading}</h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#64748b;">${message}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius:10px;background:#0055ff;">
                    <a href="${url}" style="display:inline-block;padding:14px 22px;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;color:#ffffff;text-decoration:none;">${action}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">If the button does not work, copy and paste this link into your browser:<br/>
                <a href="${url}" style="color:#0055ff;word-break:break-all;text-decoration:none;">${url}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 24px;border-top:1px solid #e2e8f0;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">
              If you did not request this, you can ignore this email.<br/>
              © PartPulse · Automotive catalog operations
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendActionEmail(input: { to: string; subject: string; heading: string; message: string; action: string; url: string }) {
  const transport = emailTransport();
  try {
    await transport.transporter.sendMail({
      from: transport.from,
      to: input.to,
      subject: input.subject,
      text: `${input.heading}\n\n${input.message}\n\n${input.action}: ${input.url}\n\nIf you did not request this, you can ignore this email.`,
      html: renderBrandedEmail(input),
    });
  } catch (error) {
    throw new EmailDeliveryError(error instanceof Error ? `Email delivery failed: ${error.message}` : "Email delivery failed");
  }
}

export function sendVerificationEmail(to: string, url: string) {
  return sendActionEmail({
    to,
    subject: "Verify your PartPulse email",
    heading: "Verify your email",
    message: "Confirm this email address to activate secure login for your PartPulse account. This link expires in 24 hours.",
    action: "Verify email",
    url,
  });
}

export function sendPasswordResetEmail(to: string, url: string) {
  return sendActionEmail({
    to,
    subject: "Reset your PartPulse password",
    heading: "Reset your password",
    message: "Use this secure, single-use link to choose a new password. This link expires in one hour.",
    action: "Reset password",
    url,
  });
}

export function sendAccountRecoveryEmail(to: string, url: string) {
  return sendActionEmail({
    to,
    subject: "Recover your PartPulse account",
    heading: "Recover your account",
    message: "Use this high-security, single-use link to replace your password and remove the current authenticator. All active sessions will be revoked. This link expires in 15 minutes.",
    action: "Recover account",
    url,
  });
}

export function sendOrganizationInvitationEmail(to: string, invitedName: string, organizationName: string, role: string, permissions: string[], url: string) {
  const roleLabel = role === "LISTING_MANAGER" ? "Listing Manager" : role === "STORE_MANAGER" ? "Store Manager" : "Admin";
  const tabLabels = permissions
    .filter((permission) => permission.startsWith("tab."))
    .map((permission) => permission.slice(4).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()));
  return sendActionEmail({
    to,
    subject: `Join ${organizationName} on PartPulse`,
    heading: `${invitedName}, join ${organizationName}`,
    message: `You have been invited as ${roleLabel}. Your workspace includes ${tabLabels.length ? tabLabels.join(", ") : "the access selected by your administrator"}. Accept the invitation and create your secure password. This single-use link expires in seven days.`,
    action: "Accept invitation and set password",
    url,
  });
}

export function sendOperationalNotificationEmail(input: {
  to: string;
  title: string;
  message: string;
  actionUrl: string;
}) {
  return sendActionEmail({
    to: input.to,
    subject: `PartPulse: ${input.title}`,
    heading: input.title,
    message: input.message,
    action: "Open PartPulse",
    url: input.actionUrl,
  });
}
