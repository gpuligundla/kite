import type { MetadataRoute } from "next";

/**
 * Kite on the phone: pair it once with /setup?…&to=handheld in Chrome, then Add to Home screen, and the handheld
 * launcher opens full screen from its own icon (it draws its own status bar). Chrome installs only over HTTPS or
 * on localhost, and the mic and camera need the same.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/os?device=handheld",
    name: "Kite",
    short_name: "Kite",
    description: "A learning companion that grows up with your kid.",
    start_url: "/os?device=handheld",
    scope: "/",
    display: "fullscreen",
    orientation: "portrait",
    background_color: "#0b1036",
    theme_color: "#0b1036",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
