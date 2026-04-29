import "./globals.css";
import HeaderBar from "./components/HeaderBar";

export const metadata = {
  title: "Warehouse Sensor Node — Operator Console",
  description:
    "Operator-activated warehouse pick assistant. Voice-armed scanner, " +
    "package tag verification, and on-device handling-motion classification."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <HeaderBar />
        {children}
      </body>
    </html>
  );
}
