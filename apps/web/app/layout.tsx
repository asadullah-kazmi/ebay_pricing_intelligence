import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "PartPulse", description: "eBay automotive competitor pricing intelligence" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
