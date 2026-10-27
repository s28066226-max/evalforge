import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Github, Logo } from "./_components/icons.tsx";
import { NavLinks } from "./_components/NavLinks.tsx";
import { THEME_SCRIPT, ThemeToggle } from "./_components/ThemeToggle.tsx";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";
const githubUrl = process.env.NEXT_PUBLIC_GITHUB_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "EvalForge: RAG evaluation with statistical rigor", template: "%s · EvalForge" },
  description:
    "Open-source RAG evaluation: claim-level LLM-as-judge scoring, retrieval metrics and paired significance tests, with a live model arena.",
  openGraph: { type: "website", siteName: "EvalForge" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand" aria-label="EvalForge home">
              <Logo />
              <span>
                Eval<b>Forge</b>
              </span>
            </Link>
            <NavLinks />
            <div className="topbar-actions">
              {githubUrl && (
                <a href={githubUrl} className="icon-btn" aria-label="Source code on GitHub" title="GitHub">
                  <Github />
                </a>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="content">{children}</main>
        <footer className="footer">
          <div className="footer-inner">
            <span>
              <b>EvalForge</b> · open-source RAG evaluation
            </span>
            <span className="muted">BM25 retrieval · LLM-as-judge · Wilcoxon + Holm · free-tier models</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
