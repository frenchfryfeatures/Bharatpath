import type { NextConfig } from "next";

/**
 * The public website is a static export: plain HTML/CSS/JS that any web host
 * or CDN can serve. It holds no session and no data of its own -- every
 * sign-in and sign-up is handed to the portal (`NEXT_PUBLIC_PORTAL_URL`).
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
