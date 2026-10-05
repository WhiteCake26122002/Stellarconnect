export function ConnectLogo({
  size = "md",
  alt = "",
  className = "",
}: {
  size?: "sm" | "md" | "lg" | "hero";
  alt?: string;
  className?: string;
}) {
  return (
    <img
      className={`connect-wordmark ${size}${className ? ` ${className}` : ""}`}
      src="/connect-wordmark.png"
      alt={alt}
      width={651}
      height={142}
      decoding="async"
    />
  );
}
