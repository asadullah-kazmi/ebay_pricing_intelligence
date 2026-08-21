"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "./components/BrandMark";
import { refreshAccessSession } from "./lib/auth-session";
import styles from "./landing.module.css";

export default function Home() {
  const [authState, setAuthState] = useState<"loading" | "signedOut" | "signedIn">("loading");
  const [activeTab, setActiveTab] = useState<"fitment" | "pricing" | "sync" | "vision">("fitment");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void refreshAccessSession()
      .then(() => { if (!cancelled) setAuthState("signedIn"); })
      .catch(() => { if (!cancelled) setAuthState("signedOut"); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={styles.page}>
      {/* Blueprint Grid & Architectural Background Lines */}
      <div className={styles.blueprintGrid} aria-hidden="true" />
      <div className={styles.radialGlow} aria-hidden="true" />

      {/* Top Telemetry & Status Strip (Light Theme) */}
      <div className={styles.topTelemetryBar}>
        <div className={styles.topTelemetryInner}>
          <div className={styles.statusCluster}>
            <span className={styles.pulseIndicator} />
            <span className={styles.systemTag}>ENGINEERING &amp; TELEMETRY PLATFORM v2.4</span>
            <span className={styles.stripDivider}>|</span>
            <span className={styles.matrixTag}>ACES/PIES MATRICES ONLINE</span>
          </div>
          <div className={styles.telemetryMetrics}>
            <span>QUERY LATENCY: <strong>11.4ms</strong></span>
            <span className={styles.stripDivider}>|</span>
            <span>MATCH RATE: <strong>99.98%</strong></span>
          </div>
        </div>
      </div>

      {/* Sticky Navigation Header */}
      <header className={styles.navHeader}>
        <div className={styles.navInner}>
          <div className={styles.brandContainer}>
            <BrandMark tagline="Automotive Operational Systems" />
          </div>

          <nav className={`${styles.navLinks} ${mobileMenuOpen ? styles.navLinksMobileOpen : ""}`}>
            <a href="#workflow" onClick={() => setMobileMenuOpen(false)}>Workflow</a>
            <a href="#architecture" onClick={() => setMobileMenuOpen(false)}>Architecture</a>
            <a href="#metrics" onClick={() => setMobileMenuOpen(false)}>Performance</a>
            <a href="#use-cases" onClick={() => setMobileMenuOpen(false)}>Solutions</a>
          </nav>

          <div className={styles.navActions}>
            {authState !== "loading" && (
              authState === "signedIn" ? (
                <Link className={styles.navPrimaryBtn} href="/dashboard">
                  Access Workspace <span className={styles.arrowIcon}>→</span>
                </Link>
              ) : (
                <div className={styles.authCluster}>
                  <Link className={styles.navLoginBtn} href="/login">Sign In</Link>
                  <Link className={styles.navPrimaryBtn} href="/login">
                    Get Started <span className={styles.arrowIcon}>→</span>
                  </Link>
                </div>
              )
            )}
            <button
              type="button"
              className={styles.mobileMenuToggle}
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label="Toggle navigation menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {mobileMenuOpen ? (
                  <path d="M18 6L6 18M6 6l12 12" />
                ) : (
                  <path d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className={styles.heroSection}>
        <div className={styles.heroInner}>
          <div className={styles.heroTextCol}>
            <div className={styles.technicalBadge}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              AUTOMOTIVE FITMENT &amp; OPERATIONAL TELEMETRY PLATFORM
            </div>

            <h1 className={styles.heroTitle}>
              Precision Engineering for Modern <br />
              <span className={styles.heroGradientText}>Automotive Parts Commerce</span>
            </h1>

            <p className={styles.heroSubtitle}>
              Transform salvage teardowns, OEM part numbers, and yard inventory into accurate, high-margin marketplace listings through fitment resolution and price optimization.
            </p>

            <div className={styles.heroActionGroup}>
              {authState === "signedIn" ? (
                <>
                  <Link className={styles.heroPrimaryBtn} href="/dashboard">
                    Access Engineering Workspace <span className={styles.btnArrow}>→</span>
                  </Link>
                  <Link className={styles.heroSecondaryBtn} href="/pricing">
                    Pricing Telemetry
                  </Link>
                </>
              ) : (
                <Link className={styles.heroPrimaryBtn} href="/login">
                  Access Engineering Workspace <span className={styles.btnArrow}>→</span>
                </Link>
              )}
            </div>

            {/* Quick Hero Metrics Bar */}
            <div className={styles.heroMetricsRow}>
              <div className={styles.heroMetricItem}>
                <span className={styles.heroMetricVal}>99.98%</span>
                <span className={styles.heroMetricLbl}>Fitment Match</span>
              </div>
              <div className={styles.heroMetricItem}>
                <span className={styles.heroMetricVal}>&lt; 12ms</span>
                <span className={styles.heroMetricLbl}>Real-Time Sync</span>
              </div>
              <div className={styles.heroMetricItem}>
                <span className={styles.heroMetricVal}>Algorithmic</span>
                <span className={styles.heroMetricLbl}>Pricing Telemetry</span>
              </div>
              <div className={styles.heroMetricItem}>
                <span className={styles.heroMetricVal}>Zero-Drift</span>
                <span className={styles.heroMetricLbl}>Inventory Control</span>
              </div>
            </div>
          </div>

          {/* Hero Visual Console Card */}
          <div className={styles.heroConsoleWrapper}>
            <div className={styles.consoleCard}>
              <div className={styles.consoleHeader}>
                <div className={styles.consoleControls}>
                  <span className={styles.dotRed} />
                  <span className={styles.dotYellow} />
                  <span className={styles.dotGreen} />
                </div>
                <div className={styles.consoleTitle}>
                  VEHICLE INTELLIGENCE CONSOLE // DIAGNOSTICS &amp; FITMENT
                </div>
                <span className={styles.consoleBadge}>CAD VERIFIED</span>
              </div>

              <div className={styles.consoleViewport}>
                <img
                  src="/partpulse_cad_console_light.jpg"
                  alt="PartPulse Vehicle Intelligence Console CAD Workstation Preview"
                  className={styles.consoleImg}
                />

                {/* Layered Floating Callout Panels */}
                <div className={`${styles.calloutCard} ${styles.callout1}`}>
                  <div className={styles.calloutStatusDot} />
                  <div>
                    <b>Suspension Bushing</b>
                    <span>Fitment Verified · 99.8%</span>
                  </div>
                </div>

                <div className={`${styles.calloutCard} ${styles.callout2}`}>
                  <div className={styles.calloutStatusDotBlue} />
                  <div>
                    <b>CV Joint Boot Outer</b>
                    <span>In Stock · 14 Qty</span>
                  </div>
                </div>

                <div className={`${styles.calloutCard} ${styles.callout3}`}>
                  <div className={styles.calloutStatusDotOrange} />
                  <div>
                    <b>Engine N52B30A</b>
                    <span>Margin Delta +18.4%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Visual Storytelling Section: Workflow Pipeline */}
      <section id="workflow" className={styles.workflowSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>OPERATIONAL FLOW</span>
          <h2>Streamlined Dismantle-to-Marketplace Workflow</h2>
          <p>From vehicle intake to live multi-store listing dispatch in five automated stages.</p>
        </div>

        <div className={styles.workflowGrid}>
          <div className={styles.workflowStep}>
            <div className={styles.stepBadge}>01</div>
            <div className={styles.stepIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="3" width="22" height="18" rx="2" />
                <path d="M7 8h10M7 12h10M7 16h6" />
              </svg>
            </div>
            <h3>Vehicle Teardown</h3>
            <p>Salvage intake, VIN scanning, and component harvesting.</p>
          </div>

          <div className={styles.workflowConnector}>→</div>

          <div className={styles.workflowStep}>
            <div className={styles.stepBadge}>02</div>
            <div className={styles.stepIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <h3>Part Identification</h3>
            <p>Automated OCR badge scanning and OEM interchange lookup.</p>
          </div>

          <div className={styles.workflowConnector}>→</div>

          <div className={styles.workflowStep}>
            <div className={styles.stepBadge}>03</div>
            <div className={styles.stepIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            </div>
            <h3>Fitment Verification</h3>
            <p>ACES/PIES compatibility injection and vehicle cross-matching.</p>
          </div>

          <div className={styles.workflowConnector}>→</div>

          <div className={styles.workflowStep}>
            <div className={styles.stepBadge}>04</div>
            <div className={styles.stepIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            </div>
            <h3>Price Optimization</h3>
            <p>Competitor price telemetry and profit margin protection locks.</p>
          </div>

          <div className={styles.workflowConnector}>→</div>

          <div className={styles.workflowStep}>
            <div className={styles.stepBadge}>05</div>
            <div className={styles.stepIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </svg>
            </div>
            <h3>Marketplace Publishing</h3>
            <p>Multi-store eBay US/UK/DE listing dispatch with zero inventory drift.</p>
          </div>
        </div>
      </section>

      {/* Four-Pillar Engineering Platform */}
      <section id="architecture" className={styles.matrixSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>CORE ARCHITECTURE</span>
          <h2>Four-Pillar Engineering Platform</h2>
          <p>Built explicitly for auto recyclers, teardown yards, and high-volume eBay Motors operations.</p>
        </div>

        <div className={styles.tabNavRow}>
          <button
            type="button"
            className={activeTab === "fitment" ? styles.activeTabBtn : styles.tabBtn}
            onClick={() => setActiveTab("fitment")}
          >
            01. Fitment &amp; ACES Matrix
          </button>
          <button
            type="button"
            className={activeTab === "pricing" ? styles.activeTabBtn : styles.tabBtn}
            onClick={() => setActiveTab("pricing")}
          >
            02. Algorithmic Pricing Engine
          </button>
          <button
            type="button"
            className={activeTab === "sync" ? styles.activeTabBtn : styles.tabBtn}
            onClick={() => setActiveTab("sync")}
          >
            03. Multi-Store Zero-Drift Sync
          </button>
          <button
            type="button"
            className={activeTab === "vision" ? styles.activeTabBtn : styles.tabBtn}
            onClick={() => setActiveTab("vision")}
          >
            04. AI Vision &amp; Media Pipeline
          </button>
        </div>

        <div className={styles.pillarDisplayCard}>
          {activeTab === "fitment" && (
            <div className={styles.pillarLayout}>
              <div className={styles.pillarTextCol}>
                <span className={styles.pillarBadge}>MODULE // 01</span>
                <h3>ACES &amp; PIES Compatibility Matrix Resolver</h3>
                <p>
                  Eliminate manual year/make/model entry. PartPulse cross-indexes manufacturer part numbers (MPNs), interchange numbers, and OEM superseded numbers against full vehicle application databases.
                </p>
                <ul className={styles.pillarList}>
                  <li>Instant VIN-to-Part interchange decoding</li>
                  <li>Automated eBay Motors compatibility table injection</li>
                  <li>Reduced returns caused by incorrect fitment specifications</li>
                </ul>
              </div>
              <div className={styles.pillarVisualCol}>
                <div className={styles.resolverCard}>
                  <div className={styles.resolverRow}>
                    <span>INPUT OEM / MPN</span>
                    <code>FDAB-035</code>
                  </div>
                  <div className={styles.resolverRow}>
                    <span>MATCHED VEHICLES</span>
                    <b>142 Applications</b>
                  </div>
                  <div className={styles.resolverRow}>
                    <span>COMPATIBILITY STATUS</span>
                    <span className={styles.statusVerified}>VERIFIED 100%</span>
                  </div>
                  <div className={styles.resolverRow}>
                    <span>EBAY MOTORS K-TYPE</span>
                    <span className={styles.ktypeBadge}>K-TYPE READY</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "pricing" && (
            <div className={styles.pillarLayout}>
              <div className={styles.pillarTextCol}>
                <span className={styles.pillarBadge}>MODULE // 02</span>
                <h3>Real-Time Algorithmic Pricing Telemetry</h3>
                <p>
                  Dynamically track sold eBay listings, active competitor prices, and shipping rate matrices. Maintain optimal margin thresholds automatically.
                </p>
                <ul className={styles.pillarList}>
                  <li>Live competitor price delta monitoring</li>
                  <li>Automated fee reconciliation &amp; target profit floor locks</li>
                  <li>Bulk repricing across thousands of automotive SKUs</li>
                </ul>
              </div>
              <div className={styles.pillarVisualCol}>
                <div className={styles.pricingCard}>
                  <div className={styles.pricingMetric}>
                    <span>COMPETITOR LOWEST</span>
                    <b className={styles.blueMetric}>$84.50</b>
                  </div>
                  <div className={styles.pricingMetric}>
                    <span>SHIPPING &amp; FEES</span>
                    <b>$23.50</b>
                  </div>
                  <div className={styles.pricingMetric}>
                    <span>TARGET MARGIN</span>
                    <b className={styles.greenMetric}>34.2%</b>
                  </div>
                  <div className={styles.pricingMetricHighlight}>
                    <span>OPTIMIZED SELLING PRICE</span>
                    <b>$99.00</b>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "sync" && (
            <div className={styles.pillarLayout}>
              <div className={styles.pillarTextCol}>
                <span className={styles.pillarBadge}>MODULE // 03</span>
                <h3>Multi-Store Zero-Drift Inventory Synchronization</h3>
                <p>
                  Connect multiple eBay seller accounts, US/DE/UK marketplaces, and yard management tools in real-time. When a part sells, stock updates globally in milliseconds.
                </p>
                <ul className={styles.pillarList}>
                  <li>Instant multi-store inventory lock on checkout</li>
                  <li>Automated stock status tracking (In stock, Low stock, Out of stock)</li>
                  <li>Controlled revision logs with rollback safety</li>
                </ul>
              </div>
              <div className={styles.pillarVisualCol}>
                <div className={styles.syncNodesCard}>
                  <div className={styles.nodeItem}>eBay Store #1 (US) — Active</div>
                  <div className={styles.nodeCore}>Central Inventory Engine</div>
                  <div className={styles.nodeItem}>eBay Store #2 (UK) — Active</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "vision" && (
            <div className={styles.pillarLayout}>
              <div className={styles.pillarTextCol}>
                <span className={styles.pillarBadge}>MODULE // 04</span>
                <h3>Automated Vision &amp; Media Drive Pipeline</h3>
                <p>
                  Upload teardown photos straight from your smartphone or yard tablet. Backgrounds are automatically cleaned, OCR extracts part badge numbers, and listing slots are assigned.
                </p>
                <ul className={styles.pillarList}>
                  <li>Automatic studio-clean white background isolation</li>
                  <li>OCR text detection on physical part labels &amp; tags</li>
                  <li>Up to 24 high-res slot uploads per listing with drag reorder</li>
                </ul>
              </div>
              <div className={styles.pillarVisualCol}>
                <div className={styles.visionCard}>
                  <div className={styles.visionBefore}>RAW YARD PHOTO</div>
                  <div className={styles.visionArrow}>➔</div>
                  <div className={styles.visionAfter}>STUDIO CLEAN // OCR READY</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Results & Measurable Benefits Section */}
      <section id="metrics" className={styles.resultsSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>MEASURABLE OUTCOMES</span>
          <h2>Enterprise Benchmark Results</h2>
          <p>Engineered to maximize efficiency, eliminate returns, and protect profit margins.</p>
        </div>

        <div className={styles.resultsGrid}>
          <div className={styles.resultCard}>
            <div className={styles.resultValue}>99.98%</div>
            <h3>Fitment Match Rate</h3>
            <p>Virtually eliminates expensive returns caused by fitment &amp; application errors.</p>
          </div>

          <div className={styles.resultCard}>
            <div className={styles.resultValue}>70%</div>
            <h3>Less Manual Catalog Work</h3>
            <p>Automates vehicle compatibility table creation and technical spec filling.</p>
          </div>

          <div className={styles.resultCard}>
            <div className={styles.resultValue}>40%</div>
            <h3>Faster Listing Speed</h3>
            <p>Streamlines image uploading, background cleanup, and multi-channel publishing.</p>
          </div>

          <div className={styles.resultCard}>
            <div className={styles.resultValue}>Zero</div>
            <h3>Inventory Drift Errors</h3>
            <p>Real-time quantity sync prevents out-of-stock cancellations across stores.</p>
          </div>
        </div>
      </section>

      {/* Audience / Use Cases Section */}
      <section id="use-cases" className={styles.useCaseSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>TARGET AUDIENCE</span>
          <h2>Built for Automotive Parts Operations</h2>
          <p>Tailored workflows for recycling yards, dismantle teams, and motors e-commerce sellers.</p>
        </div>

        <div className={styles.useCaseGrid}>
          <div className={styles.useCaseCard}>
            <div className={styles.useCaseIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.3 1 12.1 1 13v3c0 .6.4 1 1 1h2" />
                <circle cx="7" cy="17" r="2" />
                <circle cx="17" cy="17" r="2" />
              </svg>
            </div>
            <h3>Auto Dismantlers</h3>
            <p>Direct vehicle teardown cataloging with OEM part number cross-referencing.</p>
          </div>

          <div className={styles.useCaseCard}>
            <div className={styles.useCaseIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
              </svg>
            </div>
            <h3>Vehicle Recyclers</h3>
            <p>Maximize recovery value per vehicle with automated market price indexing.</p>
          </div>

          <div className={styles.useCaseCard}>
            <div className={styles.useCaseIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3>Salvage &amp; Teardown Yards</h3>
            <p>Unified warehouse location tracking and physical stock audit control.</p>
          </div>

          <div className={styles.useCaseCard}>
            <div className={styles.useCaseIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 000 20M2 12h20" />
              </svg>
            </div>
            <h3>eBay Motors Power Sellers</h3>
            <p>Multi-account listing management with automated policy template injection.</p>
          </div>
        </div>
      </section>

      {/* Final Action CTA Section */}
      <section className={styles.finalCtaSection}>
        <div className={styles.finalCtaCard}>
          <h2>Turn Every Vehicle Into Marketplace-Ready Inventory</h2>
          <p>
            Connect vehicle teardown data, fitment intelligence, pricing automation, media, and marketplace operations in one platform.
          </p>
          <div className={styles.finalCtaButtons}>
            <Link className={styles.finalPrimaryBtn} href="/login">
              Start With PartPulse <span className={styles.arrowIcon}>→</span>
            </Link>
            <Link className={styles.finalSecondaryBtn} href="/login">
              Sign In to Account
            </Link>
          </div>
        </div>
      </section>

      {/* Minimalistic Light Footer */}
      <footer className={styles.minimalFooter}>
        <div className={styles.minimalFooterInner}>
          <div className={styles.minimalFooterBrand}>
            <BrandMark tagline="Automotive Operational Systems" />
          </div>

          <div className={styles.minimalFooterNav}>
            <Link href="/login">Catalog</Link>
            <Link href="/login">Inventory</Link>
            <Link href="/login">Pricing</Link>
            <Link href="/login">Channels</Link>
            <Link href="/about">About</Link>
            <Link href="/privacy">Privacy</Link>
          </div>

          <div className={styles.minimalFooterMeta}>
            <span>© 2026 PartPulse Inc.</span>
            <span className={styles.minimalVersionTag}>v2.4.0-prod</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
