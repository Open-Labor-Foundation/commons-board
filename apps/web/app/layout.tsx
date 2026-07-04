import type { Metadata } from "next";
import "./globals.css";
import NavShell from "../components/nav-shell";

export const metadata: Metadata = {
  title: "commons-board",
  description: "Autonomous governance platform",
};

// Runs before React hydrates — reads localStorage and sets data-theme on <html>
// so there's no flash of wrong theme on load.
const themeScript = `(function(){try{var t=localStorage.getItem('cb-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <NavShell>{children}</NavShell>
      </body>
    </html>
  );
}
