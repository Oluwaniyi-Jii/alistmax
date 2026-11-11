import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alistmax | Plan a movie night",
  description: "Plan a movie night from nearby AMC showtimes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
