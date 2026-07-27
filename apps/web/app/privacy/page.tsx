import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "../components/BrandMark";
import styles from "../site-page.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · PartPulse",
  description: "How PartPulse handles account and marketplace data.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="PartPulse home">
          <BrandMark />
        </Link>
        <nav className={styles.nav}>
          <Link className={styles.navLink} href="/about">About</Link>
          <Link className={`${styles.navLink} ${styles.navLinkActive}`} href="/privacy">Privacy</Link>
          <Link className={styles.cta} href="/login">Sign in</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <p className={styles.kicker}>Legal</p>
        <h1 className={styles.heroTitle}>Privacy Policy</h1>
        <p className={styles.lead}>
          How PartPulse collects, uses, and protects account and marketplace data when you run catalog,
          pricing, and listing workflows.
        </p>
        <div className={styles.meta}>Last updated · July 26, 2026</div>
      </section>

      <div className={styles.content}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Who we are</h2>
          <p>
            PartPulse (“we”, “us”) provides automotive catalog, inventory, pricing, and marketplace
            operations software. This policy describes how we handle information when you use PartPulse at{" "}
            <a href="https://price-intelweb-production.up.railway.app">
              price-intelweb-production.up.railway.app
            </a>.
          </p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Information we collect</h2>
          <ul className={styles.list}>
            <li>Account details you provide (name, email, organization, password).</li>
            <li>Workspace data you upload or create (parts, inventory, fitment, listing drafts, pricing jobs).</li>
            <li>
              Marketplace connection data when you authorize eBay (seller identity, OAuth tokens stored
              encrypted, listing metadata needed to operate the product).
            </li>
            <li>Technical logs needed to run and secure the service (request metadata, authentication events).</li>
          </ul>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>How we use information</h2>
          <ul className={styles.list}>
            <li>To provide sign-in, catalog, pricing, fitment, and listing workflows.</li>
            <li>
              To connect your eBay seller account when you choose Connect eBay and to process authorized API
              calls.
            </li>
            <li>To send transactional email such as verification and password reset messages.</li>
            <li>To maintain security, prevent abuse, and improve reliability.</li>
          </ul>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Sharing</h2>
          <p>
            We do not sell your personal information. We share data only with processors needed to run
            PartPulse (for example hosting, database, email, object storage, and eBay when you connect your
            seller account), or when required by law.
          </p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Security and retention</h2>
          <p>
            Access credentials and seller tokens are protected with industry-standard controls (hashed
            passwords, encrypted seller tokens where configured). We retain workspace data while your
            organization account is active and as needed for security and legal obligations.
          </p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Your choices</h2>
          <p>
            You can update account security settings in PartPulse, disconnect eBay from Channels, or request
            deletion of organization data by contacting us at the email below.
          </p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Contact</h2>
          <p>
            Privacy questions:{" "}
            <a href="mailto:syedasadullahkazmik@gmail.com">syedasadullahkazmik@gmail.com</a>
          </p>
          <div className={styles.actions} style={{ marginTop: 18 }}>
            <Link className={styles.cta} href="/login">Sign in</Link>
            <Link className={styles.secondary} href="/about">About PartPulse</Link>
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <span>PartPulse · Exact matches. Better margins.</span>
        <div className={styles.footerNav}>
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </main>
  );
}
