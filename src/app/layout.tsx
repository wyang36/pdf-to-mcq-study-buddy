import type { Metadata } from "next";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";

export const metadata: Metadata = {
  title: "PDF → Interactive Lesson",
  description:
    "An AI learning agent that turns a PDF into a planned, quiz-driven lesson with human-in-the-loop approval.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
