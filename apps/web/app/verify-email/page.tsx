import type { Metadata } from "next";
import VerifyEmail from "./VerifyEmail";
export const metadata: Metadata = { title: "Verify Email | PartPulse", description: "Verify a PartPulse account email" };
export default function VerifyEmailPage() { return <VerifyEmail/>; }
