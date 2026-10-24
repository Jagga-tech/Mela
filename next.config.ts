import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config, { dev }) {
    // browser-automation logs land in the repo root; watching them makes dev rebuild in a loop
    if (dev) config.watchOptions = { ...config.watchOptions, ignored: ["**/node_modules/**", "**/.git/**", "**/.playwright-mcp/**", "**/docs/screenshots/**", "**/data/store.json"] };
    return config;
  },
};

export default nextConfig;
