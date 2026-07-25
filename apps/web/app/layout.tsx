import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "PartPulse", description: "Automotive catalog operations and eBay pricing intelligence" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
