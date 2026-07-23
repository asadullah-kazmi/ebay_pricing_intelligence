import type { Metadata } from "next";
import ResetPasswordForm from "./ResetPasswordForm";
export const metadata: Metadata = { title: "Reset Password | PartPulse", description: "Choose a new PartPulse password" };
export default function ResetPasswordPage() { return <ResetPasswordForm/>; }
