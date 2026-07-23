import type { Metadata } from "next";
import RegisterForm from "./RegisterForm";
export const metadata: Metadata = { title: "Create Account | PartPulse", description: "Create a PartPulse organization owner account" };
export default function RegisterPage() { return <RegisterForm/>; }
