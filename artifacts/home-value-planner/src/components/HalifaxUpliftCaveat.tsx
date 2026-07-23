type HalifaxUpliftCaveatVariant = "improve" | "plan" | "deal";

const copyByVariant: Record<HalifaxUpliftCaveatVariant, string> = {
  improve:
    "Halifax data measures one broad permitted-renovation signal. Multiple scope selections add cost and context, not separate measured uplift. Any p25–p75 band is the spread of observed outcomes, not estimation error.",
  plan: "Halifax selections share one broad permit-renovation evidence category. Costs are separate, but measured uplift does not stack by checkbox.",
  deal: "Halifax evidence measures one broad permitted-renovation category. These selections describe scope and cost; they do not create separate additive uplift effects.",
};

interface HalifaxUpliftCaveatProps {
  variant: HalifaxUpliftCaveatVariant;
  className?: string;
}

export function HalifaxUpliftCaveat({ variant, className = "mt-4" }: HalifaxUpliftCaveatProps) {
  return (
    <p className={`rounded-field border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning ${className}`}>
      {copyByVariant[variant]}
    </p>
  );
}
