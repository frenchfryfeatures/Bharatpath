import Image from "next/image";
import logo from "@/assets/bharatpath-icon.png";

/** The same BharatPath mark in every portal and authentication flow. */
export function BrandIcon({
  className = "h-9 w-9",
}: {
  readonly className?: string;
}) {
  return (
    <Image
      src={logo}
      alt="BharatPath"
      className={`shrink-0 object-contain ${className}`}
      sizes="48px"
      priority
    />
  );
}
