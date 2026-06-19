/** @type {import('next').NextConfig} */
const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./i18n.ts");

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "joqktmejdxkqrzncvxin.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

module.exports = withNextIntl(nextConfig);

