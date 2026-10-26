import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Eigenes Build-Verzeichnis für den Dev-Server der GUI-Tests (playwright.config.ts), damit er neben dem
  // normalen Dev-Server desselben Verzeichnisses laufen kann.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  // AGENTS.md wird vom Projekt gepflegt; `next dev` soll dort keinen eigenen Block einfügen.
  agentRules: false,
  // Treiber für PostgreSQL und PGlite nicht bundeln.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
