import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata = {
  title: "Inovix | Export document verification",
  description: "Cross-check export shipment documents before cargo leaves.",
};

export default function RootLayout({ children }) {
  return <html lang="en" className={geist.variable}><body>{children}</body></html>;
}
