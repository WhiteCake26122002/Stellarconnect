"use client";

import { ReactNode, useState } from "react";
import { logoUrl, type LogoQuery } from "@/lib/logo";

/** URLs that already 404'd this session, so re-renders and other rows skip straight to the fallback. */
const missing = new Set<string>();

export function CompanyLogo({
  size = 20,
  className,
  fallback = null,
  ...query
}: LogoQuery & {
  size?: number;
  className?: string;
  /** Shown when there is no key, no identifier, or no logo on file. */
  fallback?: ReactNode;
}) {
  const src = logoUrl(query, Math.max(24, size));
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src || missing.has(src)) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`co-logo${className ? ` ${className}` : ""}`}
      src={src}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => {
        missing.add(src);
        setFailed(src);
      }}
    />
  );
}
