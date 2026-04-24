import "./globals.css";

export const metadata = {
  title: "IoT Demo Dashboard",
  description: "Live dashboard for the Nano 33 BLE voice, colour, and movement demo."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

