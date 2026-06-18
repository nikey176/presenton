const nextConfig = {
  reactStrictMode: false,
  distDir: ".next-build",
  output: "standalone",
  ...(process.env.NODE_ENV !== "production"
    ? {
        // Allow opening the dev server from another host on the LAN.
        // Additional hosts can be passed via ALLOWED_DEV_ORIGINS (comma-separated).
        // Example: ALLOWED_DEV_ORIGINS="192.168.1.15,http://192.168.1.15:5000"
        ...(process.env.ALLOWED_DEV_ORIGINS
          ? {
              allowedDevOrigins: [
                "http://127.0.0.1:40001",
                "http://localhost:40001",
                "127.0.0.1",
                "localhost",
                "192.168.1.15",
                "http://192.168.1.15:5000",
                ...process.env.ALLOWED_DEV_ORIGINS
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              ],
            }
          : {
              allowedDevOrigins: [
                "http://127.0.0.1:40001",
                "http://localhost:40001",
                "127.0.0.1",
                "localhost",
                "192.168.1.15",
                "http://192.168.1.15:5000",
              ],
            }),
      }
    : {}),

  // Rewrites for development - proxy font requests to FastAPI backend
  async rewrites() {
    return [
      {
        source: '/app_data/fonts/:path*',
        destination: 'http://localhost:5000/app_data/fonts/:path*',
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-7c765f3726084c52bcd5d180d51f1255.r2.dev",
      },
      {
        protocol: "https",
        hostname: "pptgen-public.ap-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "pptgen-public.s3.ap-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "img.icons8.com",
      },
      {
        protocol: "https",
        hostname: "present-for-me.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "yefhrkuqbjcblofdcpnr.supabase.co",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "unsplash.com",
      },
    ],
  },
  
};

export default nextConfig;
