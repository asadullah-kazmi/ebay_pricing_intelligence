type BrandMarkProps = {
  inverse?: boolean;
  compact?: boolean;
  tagline?: string;
};

export default function BrandMark({ inverse = false, compact = false, tagline }: BrandMarkProps) {
  return (
    <span
      className={`partpulse-brand${inverse ? " partpulse-brand--inverse" : ""}${compact ? " partpulse-brand--compact" : ""}`}
      aria-label="PartPulse"
    >
      <span className="partpulse-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="partpulse-wordmark">
        Part<span>Pulse</span>
        {tagline && <small>{tagline}</small>}
      </span>
    </span>
  );
}
