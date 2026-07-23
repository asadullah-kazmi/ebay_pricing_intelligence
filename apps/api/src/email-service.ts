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

async function sendActionEmail(input: { to: string; subject: string; heading: string; message: string; action: string; url: string }) {
  const transport = emailTransport();
  try {
    await transport.transporter.sendMail({
      from: transport.from,
      to: input.to,
      subject: input.subject,
      text: `${input.heading}\n\n${input.message}\n\n${input.action}: ${input.url}\n\nIf you did not request this, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#10231e">
        <h1 style="font-size:28px">${escapeHtml(input.heading)}</h1>
        <p style="line-height:1.6">${escapeHtml(input.message)}</p>
        <p><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#c9f56a;color:#10231e;padding:14px 20px;text-decoration:none;font-weight:700">${escapeHtml(input.action)}</a></p>
        <p style="color:#64716c;font-size:12px">If you did not request this, you can ignore this email.</p>
      </div>`,
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

export function sendOrganizationInvitationEmail(to: string, organizationName: string, role: string, url: string) {
  return sendActionEmail({
    to,
    subject: `Join ${organizationName} on PartPulse`,
    heading: `Join ${organizationName}`,
    message: `You have been invited to PartPulse with the ${role.toLowerCase().replaceAll("_", " ")} role. This single-use invitation expires in seven days.`,
    action: "Accept invitation",
    url,
  });
}
