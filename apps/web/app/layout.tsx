import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "./provider";

const notionSans = Inter({
  variable: "--font-notion-sans",
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
        className={`${notionSans.variable} antialiased`}
      >
        <Providers>
          {children}
        </Providers>      
      </body>
    </html>
  );
}
