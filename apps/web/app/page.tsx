"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "./components/BrandMark";
import { refreshAccessSession } from "./lib/auth-session";
import styles from "./landing.module.css";

type SamplePart = {
  id: string;
  sku: string;
  mpn: string;
  title: string;
  brand: string;
  category: string;
  condition: string;
  price: number;
  marketPrice: number;
  fitment: string[];
  matchRate: number;
};

const SAMPLE_PARTS: SamplePart[] = [
  {
    id: "p1",
    sku: "BLA-1035",
    mpn: "FDAB-035",
    title: "Febest Suspension Shock Absorber Bushing - Front Lower",
    brand: "Febest",
    category: "Suspension & Steering",
    condition: "NEW",
    price: 99.00,
    marketPrice: 114.50,
    fitment: ["2004-2011 Ford F-150", "2006-2008 Lincoln Mark LT"],
    matchRate: 99.8,
  },
  {
    id: "p2",
    sku: "BLA-1034",
    mpn: "0217-C24",
    title: "Febest C24 CV Joint Boot Outer - 4WD Std Trans",
    brand: "Febest",
    category: "Drivetrain & Transmission",
    condition: "NEW",
    price: 39.50,
    marketPrice: 48.00,
    fitment: ["2015-2022 Chevrolet Suburban", "2015-2022 GMC Yukon XL"],
    matchRate: 100.0,
  },
  {
    id: "p3",
    sku: "BLA-1021",
    mpn: "11000422941",
    title: "N52 Engine Longblock Assembly 525i N52B30A",
    brand: "BMW OEM",
    category: "Engines & Components",
    condition: "USED (68k mi)",
    price: 2200.00,
    marketPrice: 2445.10,
    fitment: ["2004-2010 BMW 5-Series E60 525i", "2006-2010 BMW 3-Series E90 325i"],
    matchRate: 99.4,
  },
];

export default function Home() {
  const [authState, setAuthState] = useState<"loading" | "signedOut" | "signedIn">("loading");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"fitment" | "pricing" | "sync" | "vision">("fitment");
  const [activePart, setActivePart] = useState<SamplePart>(SAMPLE_PARTS[0]);

  useEffect(() => {
    let cancelled = false;
    void refreshAccessSession()
      .then(() => { if (!cancelled) setAuthState("signedIn"); })
      .catch(() => { if (!cancelled) setAuthState("signedOut"); });
    return () => { cancelled = true; };
  }, []);

  const filteredParts = SAMPLE_PARTS.filter(
    (p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.mpn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.brand.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={styles.page}>
      {/* Background Cyber Blueprint Overlay */}
      <div className={styles.gridOverlay} aria-hidden="true" />
      <div className={styles.glowOrb1} aria-hidden="true" />
      <div className={styles.glowOrb2} aria-hidden="true" />

      {/* Top Engineering Status Bar */}
      <div className={styles.topBanner}>
        <div className={styles.topBannerInner}>
          <div className={styles.statusGroup}>
            <span className={styles.statusDot} />
            <span className={styles.statusText}>ENGINEERING & TELEMETRY PLATFORM v2.4</span>
            <span className={styles.divider}>|</span>
            <span className={styles.statusSub}>ACES/PIES MATRICES ONLINE</span>
          </div>
          <div className={styles.telemetryMini}>
            <span>QUERY LATENCY: <strong>11.4ms</strong></span>
            <span>MATCH RATE: <strong>99.98%</strong></span>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <header className={styles.header}>
        <div className={styles.brandWrapper}>
          <BrandMark inverse tagline="AUTOMOTIVE OPERATIONAL SYSTEMS" />
        </div>
        <nav className={styles.navLinks}>
          <a href="#schematics">Schematics & Fitment</a>
          <a href="#telemetry">Telemetry Engine</a>
          <a href="#pricing">Algorithmic Pricing</a>
          <a href="#architecture">Architecture</a>
        </nav>
        <div className={styles.headerRight}>
          {authState !== "loading" && (
            authState === "signedIn" ? (
              <Link className={styles.primaryCta} href="/dashboard">
                Launch Workspace <span className={styles.ctaArrow}>→</span>
              </Link>
            ) : (
              <div className={styles.authGroup}>
                <Link className={styles.loginBtn} href="/login">Sign In</Link>
                <Link className={styles.primaryCta} href="/login">
                  Get Started <span className={styles.ctaArrow}>→</span>
                </Link>
              </div>
            )
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className={styles.heroSection}>
        <div className={styles.heroContent}>
          <div className={styles.kickerBadge}>
            <span className={styles.kickerPulse} />
            AUTOMOTIVE FITMENT & OPERATIONAL TELEMETRY PLATFORM
          </div>

          <h1 className={styles.heroTitle}>
            Precision Engineering for Modern <br />
            <span className={styles.gradientText}>Automotive Parts Commerce</span>
          </h1>

          <p className={styles.heroSubtitle}>
            Transform salvage teardowns, OEM part numbers, and yard inventory into verified, high-margin marketplace listings with real-time fitment resolution and automated price optimization.
          </p>

          <div className={styles.heroActions}>
            {authState === "signedIn" ? (
              <>
                <Link className={styles.heroPrimaryBtn} href="/pricing">
                  Open Pricing Telemetry <span className={styles.btnIcon}>⚡</span>
                </Link>
                <Link className={styles.heroSecondaryBtn} href="/dashboard">
                  Launch Engineering Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link className={styles.heroPrimaryBtn} href="/login">
                  Access Engineering Workspace <span className={styles.btnIcon}>→</span>
                </Link>
                <a className={styles.heroSecondaryBtn} href="#sandbox">
                  Test Fitment Sandbox
                </a>
              </>
            )}
          </div>

          {/* Telemetry Quick Bar */}
          <div className={styles.telemetryBar}>
            <div className={styles.telemetryItem}>
              <span className={styles.telemetryVal}>1.8M+</span>
              <span className={styles.telemetryLbl}>OEM Cross-References</span>
            </div>
            <div className={styles.telemetryDivider} />
            <div className={styles.telemetryItem}>
              <span className={styles.telemetryVal}>&lt; 12ms</span>
              <span className={styles.telemetryLbl}>Fitment Query Latency</span>
            </div>
            <div className={styles.telemetryDivider} />
            <div className={styles.telemetryItem}>
              <span className={styles.telemetryVal}>$68.4M</span>
              <span className={styles.telemetryLbl}>Synced Asset Inventory</span>
            </div>
            <div className={styles.telemetryDivider} />
            <div className={styles.telemetryItem}>
              <span className={styles.telemetryVal}>99.98%</span>
              <span className={styles.telemetryLbl}>Listing Policy Compliance</span>
            </div>
          </div>
        </div>

        {/* Hero Interactive Engineering Showcase Card */}
        <div className={styles.heroShowcaseWrapper}>
          <div className={styles.heroShowcaseCard}>
            <div className={styles.showcaseTopBar}>
              <div className={styles.windowDots}>
                <span /> <span /> <span />
              </div>
              <div className={styles.showcaseTitle}>
                VEHICLE DIAGNOSTICS & TELEMETRY ENGINE // REV 14.3
              </div>
              <div className={styles.showcaseBadge}>LIVE TELEMETRY</div>
            </div>

            <div className={styles.showcaseMediaStage}>
              {/* Generated Automotive Engineering 3D Chassis Image */}
              <img
                src="/partpulse_hero_schematic.jpg"
                alt="PartPulse Vehicle Engineering & Telemetry Dashboard Schematic"
                className={styles.schematicImg}
              />

              {/* Floating Engineering Pins */}
              <div className={`${styles.pin} ${styles.pin1}`}>
                <div className={styles.pinDot} />
                <div className={styles.pinTooltip}>
                  <b>SUSPENSION BUSHING</b>
                  <span>MPN: FDAB-035 · FITMENT 99.8%</span>
                </div>
              </div>

              <div className={`${styles.pin} ${styles.pin2}`}>
                <div className={styles.pinDot} />
                <div className={styles.pinTooltip}>
                  <b>CV JOINT BOOT</b>
                  <span>OEM: 0217-C24 · IN STOCK (14 QTY)</span>
                </div>
              </div>

              <div className={`${styles.pin} ${styles.pin3}`}>
                <div className={styles.pinDot} />
                <div className={styles.pinTooltip}>
                  <b>ENGINE N52B30A</b>
                  <span>MARGIN DELTA: +18.4%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live Fitment & OEM Search Sandbox Section */}
      <section id="sandbox" className={styles.sandboxSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTag}>INTERACTIVE ENGINE DEMO</span>
          <h2>Automotive Fitment &amp; Cross-Reference Resolver</h2>
          <p>Test real-time OEM part compatibility mapping and market pricing indexes.</p>
        </div>

        <div className={styles.sandboxCard}>
          <div className={styles.sandboxSearchBar}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by MPN, OEM part number, or vehicle model (e.g. FDAB-035, Febest, BMW N52)..."
            />
            {searchQuery && (
              <button type="button" className={styles.clearSearch} onClick={() => setSearchQuery("")}>
                Clear
              </button>
            )}
          </div>

          <div className={styles.sandboxGrid}>
            <div className={styles.partsList}>
              <div className={styles.listHeader}>SELECT SAMPLE PART</div>
              {filteredParts.length === 0 ? (
                <div className={styles.noResults}>No parts match "{searchQuery}"</div>
              ) : (
                filteredParts.map((part) => (
                  <article
                    key={part.id}
                    className={`${styles.partCardItem} ${activePart.id === part.id ? styles.activePartItem : ""}`}
                    onClick={() => setActivePart(part)}
                  >
                    <div className={styles.partItemTop}>
                      <b>{part.sku}</b>
                      <span className={styles.mpnBadge}>MPN: {part.mpn}</span>
                    </div>
                    <h3>{part.title}</h3>
                    <div className={styles.partItemMeta}>
                      <span>{part.brand}</span>
                      <span>•</span>
                      <span>${part.price.toFixed(2)}</span>
                      <span className={styles.matchBadge}>{part.matchRate}% MATCH</span>
                    </div>
                  </article>
                ))
              )}
            </div>

            {/* Part Telemetry Detail Inspector Pane */}
            <div className={styles.inspectorPane}>
              <div className={styles.inspectorHeader}>
                <div>
                  <span className={styles.inspectorEyebrow}>FITMENT DIAGNOSTICS &amp; PRICING</span>
                  <h3>{activePart.title}</h3>
                </div>
                <code className={styles.inspectorSku}>{activePart.sku}</code>
              </div>

              <div className={styles.specGrid}>
                <div className={styles.specItem}>
                  <span>BRAND</span>
                  <b>{activePart.brand}</b>
                </div>
                <div className={styles.specItem}>
                  <span>PART NUMBER (MPN)</span>
                  <b>{activePart.mpn}</b>
                </div>
                <div className={styles.specItem}>
                  <span>CONDITION</span>
                  <b>{activePart.condition}</b>
                </div>
                <div className={styles.specItem}>
                  <span>CATEGORY</span>
                  <b>{activePart.category}</b>
                </div>
                <div className={styles.specItem}>
                  <span>LISTING PRICE</span>
                  <b>${activePart.price.toFixed(2)}</b>
                </div>
                <div className={styles.specItem}>
                  <span>ESTIMATED MARKET VALUE</span>
                  <b className={styles.marketHighlight}>${activePart.marketPrice.toFixed(2)}</b>
                </div>
              </div>

              <div className={styles.fitmentBox}>
                <div className={styles.fitmentBoxHeader}>
                  <span>VERIFIED VEHICLE COMPATIBILITY (ACES/PIES)</span>
                  <span className={styles.verifiedTag}>VERIFIED 100%</span>
                </div>
                <div className={styles.fitmentChips}>
                  {activePart.fitment.map((vehicle) => (
                    <span key={vehicle} className={styles.fitmentChip}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {vehicle}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Systems Architectural Matrix */}
      <section id="schematics" className={styles.matrixSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTag}>CORE ARCHITECTURE</span>
          <h2>Four Pillar Engineering Architecture</h2>
          <p>Built explicitly for auto recyclers, teardown yards, and high-volume eBay motors operations.</p>
        </div>

        <div className={styles.systemTabsNav}>
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

        <div className={styles.systemDisplayCard}>
          {activeTab === "fitment" && (
            <div className={styles.systemTabContent}>
              <div className={styles.tabText}>
                <span className={styles.tabNumber}>MODULE // 01</span>
                <h3>ACES &amp; PIES Compatibility Matrix Resolver</h3>
                <p>
                  Eliminate manual year/make/model entry. PartPulse cross-indexes manufacturer part numbers (MPNs), interchange numbers, and OEM superseded numbers against full vehicle application databases.
                </p>
                <ul className={styles.featureList}>
                  <li>Instant VIN-to-Part interchange decoding</li>
                  <li>Automated eBay Motors compatibility table injection</li>
                  <li>Zero return rate due to incorrect fitment specifications</li>
                </ul>
              </div>
              <div className={styles.tabGraphic}>
                <div className={styles.codeBlock}>
                  <div className={styles.codeHeader}>
                    <span>fitment_resolver.py</span>
                    <span>PYTHON SCHEMATIC</span>
                  </div>
                  <pre>{`def resolve_fitment(mpn="FDAB-035"):
    part = oem_index.lookup(mpn)
    vehicles = aces_engine.match(
        chassis=part.chassis_code,
        year_range=(2004, 2011)
    )
    return {
        "status": "VERIFIED_100",
        "compatibilities": len(vehicles),
        "ebay_motors_ktype": part.ktype_list
    }`}</pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === "pricing" && (
            <div className={styles.systemTabContent}>
              <div className={styles.tabText}>
                <span className={styles.tabNumber}>MODULE // 02</span>
                <h3>Real-Time Algorithmic Pricing Telemetry</h3>
                <p>
                  Dynamically track sold eBay listings, active competitor prices, and shipping rate matrices. Maintain optimal margin thresholds automatically.
                </p>
                <ul className={styles.featureList}>
                  <li>Live competitor price delta monitoring</li>
                  <li>Automated fee reconciliation &amp; target profit floor locks</li>
                  <li>Bulk repricing across thousands of automotive SKUs</li>
                </ul>
              </div>
              <div className={styles.tabGraphic}>
                <div className={styles.telemetryCardSample}>
                  <div className={styles.sampleMetric}>
                    <span>TARGET MARGIN</span>
                    <b>34.2%</b>
                  </div>
                  <div className={styles.sampleMetric}>
                    <span>COMPETITOR LOW</span>
                    <b className={styles.blueVal}>$84.50</b>
                  </div>
                  <div className={styles.sampleMetric}>
                    <span>OPTIMIZED PRICE</span>
                    <b className={styles.greenVal}>$99.00</b>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "sync" && (
            <div className={styles.systemTabContent}>
              <div className={styles.tabText}>
                <span className={styles.tabNumber}>MODULE // 03</span>
                <h3>Multi-Store Zero-Drift Inventory Synchronization</h3>
                <p>
                  Connect multiple eBay seller accounts, US/DE/UK marketplaces, and yard management tools in real-time. When a part sells, stock updates globally in milliseconds.
                </p>
                <ul className={styles.featureList}>
                  <li>Instant multi-store inventory lock on checkout</li>
                  <li>Automated stock status tracking (In stock, Low stock, Out of stock)</li>
                  <li>Controlled revision logs with rollback safety</li>
                </ul>
              </div>
              <div className={styles.tabGraphic}>
                <div className={styles.syncGraphicBox}>
                  <div className={styles.syncNode}>eBay Store #1 (US)</div>
                  <div className={styles.syncCore}>PartPulse Core Engine</div>
                  <div className={styles.syncNode}>eBay Store #2 (UK)</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "vision" && (
            <div className={styles.systemTabContent}>
              <div className={styles.tabText}>
                <span className={styles.tabNumber}>MODULE // 04</span>
                <h3>Automated Vision &amp; Media Drive Pipeline</h3>
                <p>
                  Upload teardown photos straight from your smartphone or yard tablet. Backgrounds are automatically cleaned, OCR extracts part badge numbers, and listing slots are assigned.
                </p>
                <ul className={styles.featureList}>
                  <li>Automatic studio-clean white background isolation</li>
                  <li>OCR text detection on physical part labels &amp; tags</li>
                  <li>Up to 24 high-res slot uploads per listing with drag reorder</li>
                </ul>
              </div>
              <div className={styles.tabGraphic}>
                <div className={styles.visionDemoBox}>
                  <div className={styles.rawBox}>RAW YARD PHOTO</div>
                  <div className={styles.arrowAnim}>➔</div>
                  <div className={styles.cleanBox}>STUDIO CLEAN // OEM READY</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <BrandMark inverse tagline="AUTOMOTIVE OPERATIONAL SYSTEMS" />
            <p>High-yield inventory intelligence for professional auto dismantlers, recyclers, and motors sellers.</p>
          </div>
          <div className={styles.footerCols}>
            <div>
              <b>SYSTEMS</b>
              <Link href="/catalog">Catalog Workspace</Link>
              <Link href="/inventory">Inventory Engine</Link>
              <Link href="/pricing">Pricing Telemetry</Link>
              <Link href="/quick-sku">Quick SKU</Link>
            </div>
            <div>
              <b>PLATFORM</b>
              <Link href="/channels">Channels &amp; Stores</Link>
              <Link href="/pipeline">Teardown Pipeline</Link>
              <Link href="/media-drive">Media Drive</Link>
              <Link href="/fitment">Fitment Engine</Link>
            </div>
            <div>
              <b>COMPANY</b>
              <Link href="/about">About PartPulse</Link>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/login">Sign In</Link>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>PartPulse Inc. © 2026. All rights reserved.</span>
          <span>SYSTEM BUILD: v2.4.0-prod · LATENCY: 11.4ms</span>
        </div>
      </footer>
    </div>
  );
}
