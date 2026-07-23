import type { Metadata } from "next";
import AccountSecurity from "./AccountSecurity";
export const metadata: Metadata = { title: "Account Security | PartPulse", description: "Manage password, sessions, and multi-factor authentication" };
export default function AccountSecurityPage() { return <AccountSecurity/>; }
