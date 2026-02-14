import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: "./empty-module.ts",
    },
  },
  webpack: (config) => {
    // pdfjs-dist has an optional canvas dependency for Node; stub it out
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
