/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the headless-Chrome packages out of the bundler so the chromium binary
  // ships intact to the serverless PDF route (/api/payroll/pdf).
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
}

export default nextConfig
