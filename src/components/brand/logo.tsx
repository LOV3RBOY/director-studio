import Image from "next/image";
import { brand } from "@/config/brand";
import { cn } from "@/ui";

export function LogoMark({ size = 20, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <Image src="/out-of-order/symbol.png" width={size} height={size} alt={title ?? ""} className={cn("shrink-0 object-contain", className)} />
  );
}

/** The mark with the name beside it, for footers and dialogs. */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} />
      <span className="font-display text-base leading-5 font-bold tracking-[-0.01em] text-text-primary">{brand.name}</span>
    </span>
  );
}

/** A model maker's badge: the first letter of the maker's name. We ship no third-party logos. */
export function VendorGlyph({ vendor, className }: { vendor: string; className?: string }) {
  return (
    <span aria-hidden className={cn("font-display text-xs leading-4 font-bold text-text-primary uppercase", className)}>
      {vendor.trim().charAt(0) || "·"}
    </span>
  );
}
