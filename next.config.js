/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: { '/*': ['./.codex-local/**/*', './data/**/*', './knowledge/**/*', './.git/**/*', './.env*', './scripts/**/*'] },
  transpilePackages: ['lunar-javascript'],
};

module.exports = nextConfig;
