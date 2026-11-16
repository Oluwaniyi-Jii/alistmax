import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "amctheatres.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.amctheatres.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "amc-theatres-res.cloudinary.com",
        pathname: "/image/upload/**",
      },
    ],
  },
};

export default nextConfig;
