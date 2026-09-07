/** @type {import('next').NextConfig} */
const API = process.env.API_URL ?? 'http://localhost:4000';

export default {
  // The browser talks to /api/* on the Next origin; Next forwards to the Express service.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};
