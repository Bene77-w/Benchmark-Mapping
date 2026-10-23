import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
