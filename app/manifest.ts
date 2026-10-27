import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Expenses — Dr. Jason Latsky Medical Professional Corporation",
    short_name: "Expenses",
    description: "Receipt and expense tracker for the practice.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f3ef",
    theme_color: "#16303b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
