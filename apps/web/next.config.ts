import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared packages ship TypeScript source.
  transpilePackages: ["@kite/client", "@kite/games", "@kite/movie"],
  // Compression would buffer the brain's event stream.
  compress: false,
  output: "standalone",
};

export default config;
