import type { Metadata } from "next";
import { Geist, Inter, Ojuju } from "next/font/google";
import "./globals.css";
import Providers from "./provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const ojuju = Ojuju({
  variable: "--font-ojuju",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dammie AI",
  description: "Dammie AI financial operations and customer experience.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${geist.variable} ${ojuju.variable} antialiased`}
      >
        <Providers>
          {children}
        </Providers>      
      </body>
    </html>
  );
}
