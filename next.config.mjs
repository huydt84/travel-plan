import { withWorkflow } from "workflow/next";
const nextConfig = {};

if (process.env.NEXT_DIST_DIR) {
  nextConfig.distDir = process.env.NEXT_DIST_DIR;
}

export default withWorkflow(nextConfig);
