import type { Metadata } from "next";
import ForgotPasswordForm from "./ForgotPasswordForm";
export const metadata: Metadata = { title: "Recover Account | PartPulse", description: "Request secure PartPulse account recovery" };
export default function ForgotPasswordPage() { return <ForgotPasswordForm/>; }
