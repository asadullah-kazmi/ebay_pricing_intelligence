import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "../components/BrandMark";
import styles from "../site-page.module.css";

export const metadata: Metadata = {
  title: "About Us · PartPulse",
  description: "PartPulse helps automotive yards turn inventory into marketplace-ready listings with pricing, fitment, and catalog operations.",
};

export default function AboutPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="PartPulse home">
          <BrandMark />
        </Link>
        <nav className={styles.nav}>
          <Link className={`${styles.navLink} ${styles.navLinkActive}`} href="/about">About</Link>
          <Link className={styles.navLink} href="/privacy">Privacy</Link>
          <Link className={styles.cta} href="/login">Sign in</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <p className={styles.kicker}>About us</p>
        <h1 className={styles.heroTitle}>Built for automotive parts operations.</h1>
        <p className={styles.lead}>
          PartPulse helps salvage yards and parts sellers turn OEM inventory into clean catalog records,
          market-aware prices, and marketplace-ready listings — without spreadsheet chaos.
        </p>
        <div className={styles.actions}>
          <Link className={styles.cta} href="/login">Open PartPulse</Link>
          <Link className={styles.secondary} href="/">Back to home</Link>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.featureGrid}>
          <article className={styles.feature}>
            <strong>Identify faster</strong>
            <span>Match OEM part numbers to listing-ready titles and vehicle fitment signals.</span>
          </article>
          <article className={styles.feature}>
            <strong>Price with context</strong>
            <span>Compare market comps so used OEM inventory can move at competitive margins.</span>
          </article>
          <article className={styles.feature}>
            <strong>List with less friction</strong>
            <span>Keep catalog, drafts, and seller policies connected in one workspace.</span>
          </article>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>What we do</h2>
          <p>
            We connect yard inventory to marketplace workflows: identify parts from OEM numbers, generate
            listing titles, attach vehicle fitment, compare market pricing, and prepare drafts for eBay.
          </p>
          <ul className={styles.list}>
            <li>Quick SKU uploads that identify parts and build guideline-ready titles</li>
            <li>Catalog, fitment, pricing, and listing draft tools in one workspace</li>
            <li>Seller account connections so operations stay tied to your live store</li>
          </ul>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Why PartPulse</h2>
          <p>
            Used OEM parts move fast, but listing them well is slow. PartPulse is designed for teams who need
            accurate part matching, consistent titles, and fewer manual steps between the shelf and the
            marketplace.
          </p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Contact</h2>
          <p>
            Questions about PartPulse, partnerships, or your workspace:{" "}
            <a href="mailto:syedasadullahkazmik@gmail.com">syedasadullahkazmik@gmail.com</a>
          </p>
        </section>
      </div>

      <footer className={styles.footer}>
        <span>PartPulse · Exact matches. Better margins.</span>
        <div className={styles.footerNav}>
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </main>
  );
}
