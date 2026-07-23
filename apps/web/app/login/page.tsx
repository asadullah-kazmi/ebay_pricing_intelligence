import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign In | PartPulse", description: "Securely sign in to PartPulse" };
export default function LoginPage() { return <LoginForm/>; }
