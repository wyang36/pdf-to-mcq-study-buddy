/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist ships a worker + node canvas stubs; keep it external to the server bundle
  // so the legacy build resolves correctly at runtime.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
