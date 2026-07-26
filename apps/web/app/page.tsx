"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "./components/BrandMark";
import { refreshAccessSession } from "./lib/auth-session";
import styles from "./landing.module.css";

export default function Home() {
  const [authState, setAuthState] = useState<"loading" | "signedOut" | "signedIn">("loading");

  useEffect(() => {
    let cancelled = false;
    void refreshAccessSession()
      .then(() => { if (!cancelled) setAuthState("signedIn"); })
      .catch(() => { if (!cancelled) setAuthState("signedOut"); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BrandMark />
        <div className={styles.headerRight}>
          {authState !== "loading" && (
            authState === "signedIn"
              ? <Link className={styles.cta} href="/dashboard">Open dashboard</Link>
              : <Link className={styles.cta} href="/login">Sign in</Link>
          )}
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>Automotive store operations</p>
          <h1>Catalog, inventory, orders, and pricing — in one workspace.</h1>
          <p>PartPulse connects your yard inventory to marketplace pricing, listings, and fulfillment workflows.</p>
          <div className={styles.actions}>
            {authState === "signedIn" ? (
              <>
                <Link className={styles.cta} href="/pricing">Open pricing</Link>
                <Link className={styles.secondary} href="/dashboard">Go to dashboard</Link>
              </>
            ) : (
              <>
                <Link className={styles.cta} href="/login">Sign in to PartPulse</Link>
                <Link className={styles.secondary} href="/login">Get started</Link>
              </>
            )}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        PartPulse · Exact matches. Better margins. · <Link href="/about">About us</Link>
      </footer>
    </main>
  );
}
