import Link from "next/link";
import BrandMark from "../components/BrandMark";
import styles from "../auth-ui.module.css";

export const metadata = {
  title: "Privacy Policy · PartPulse",
  description: "How PartPulse handles account and marketplace data.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={`${styles.card} ${styles.wide}`}>
        <Link className={styles.brand} href="/">
          <BrandMark />
        </Link>
        <span className={styles.eyebrow}>Legal</span>
        <h1>Privacy Policy</h1>
        <p>Last updated: July 26, 2026</p>

        <div style={{ display: "grid", gap: 18, marginTop: 24, color: "#334155", fontSize: 14, lineHeight: 1.65 }}>
          <section>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#0c274d" }}>Who we are</h2>
            <p style={{ margin: 0 }}>
              PartPulse (“we”, “us”) provides automotive catalog, inventory, pricing, and marketplace
              operations software. This policy describes how we handle information when you use PartPulse
              at <a href="https://price-intelweb-production.up.railway.app">price-intelweb-production.up.railway.app</a>.
            </p>
          </section>

          <section>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#0c274d" }}>Information we collect</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Account details you provide (name, email, organization, password).</li>
              <li>Workspace data you upload or create (parts, inventory, fitment, listing drafts, pricing jobs).</li>
              <li>Marketplace connection data when you authorize eBay (seller identity, OAuth tokens stored encrypted, listing metadata needed to operate the product).</li>
              <li>Technical logs needed to run and secure the service (request metadata, authentication events).</li>
            </ul>
          </section>

          <section>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#0c274d" }}>How we use information</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>To provide sign-in, catalog, pricing, fitment, and listing workflows.</li>
              <li>To connect your eBay seller account when you choose Connect eBay and to process authorized API calls.</li>
              <li>To send transactional email such as verification and password reset messages.</li>
              <li>To maintain security, prevent abuse, and improve reliability.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#0c274d" }}>Sharing</h2>
            <p style={{ margin: 0 }}>
              We do not sell your personal information. We share data only with processors needed to run
              PartPulse (for example hosting, database, email, object storage, and eBay when you connect
              your seller account), or when required by law.
            </p>
          </section>

          <section>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#0c274d" }}>Security and retention</h2>
            <p style={{ margin: 0 }}>
              Access credentials and seller tokens are protected with industry-standard controls (hashed
              passwords, encrypted seller tokens where configured). We retain workspace data while your
              organization account is active and as needed for security and legal obligations.
            </p>
          </section>

          <section>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#0c274d" }}>Your choices</h2>
            <p style={{ margin: 0 }}>
              You can update account security settings in PartPulse, disconnect eBay from Catalog, or
              request deletion of organization data by contacting us at the email below.
            </p>
          </section>

          <section>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#0c274d" }}>Contact</h2>
            <p style={{ margin: 0 }}>
              Privacy questions: <a href="mailto:syedasadullahkazmik@gmail.com">syedasadullahkazmik@gmail.com</a>
            </p>
          </section>
        </div>

        <div className={styles.links} style={{ marginTop: 28 }}>
          <span className={styles.linkLine}>
            <Link href="/">Back to PartPulse</Link>
            {" · "}
            <Link href="/login">Sign in</Link>
          </span>
        </div>
      </article>
    </main>
  );
}
