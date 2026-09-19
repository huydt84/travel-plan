import { withWorkflow } from "workflow/next";
const nextConfig = {
  async headers() {
    return [{
      source: "/share/:token",
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }];
  },
  experimental: {
    // Bound production-build and analysis fan-out on developer machines. Four
    // workers preserve useful parallelism without launching one per CPU core.
    cpus: 4,
    // Compile development entries when requested instead of retaining every
    // route from server startup. Long sessions converge as routes are visited.
    preloadEntriesOnStart: false,
    // This project uses custom Workflow loaders. Keeping them in worker threads
    // avoids the per-process runtime duplication of Turbopack's default pool.
    turbopackPluginRuntimeStrategy: "workerThreads",
    // Prefer disk-backed reloads over retaining every compiled module during a
    // long local session. Production behavior is unaffected.
    turbopackMemoryEviction: "full",
  },
};

if (process.env.NEXT_DIST_DIR) {
  nextConfig.distDir = process.env.NEXT_DIST_DIR;
}

export default withWorkflow(nextConfig);
