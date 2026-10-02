import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Massefelt",
  description: "Construction-site 3D scanning, point clouds, terrain analysis and AI-assisted workflows",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
