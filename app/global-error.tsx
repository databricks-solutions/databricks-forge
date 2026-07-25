"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @media (prefers-color-scheme: dark) {
                body { background: #0f1c21; color: #e2e8f0; }
                .ge-message { color: #94a3b8; }
                .ge-code { color: #94a3b8; background: #1a2930; }
                .ge-digest { color: #64748b; }
                .ge-btn-primary { background: #2e8b9a; }
                .ge-btn-primary:hover { background: #379aab; }
                .ge-btn-secondary { color: #94a3b8; border-color: #334155; }
                .ge-btn-secondary:hover { background: #1a2930; }
              }
            `,
          }}
        />
      </head>
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: 0,
          background: "#ffffff",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
        >
          <div style={{ maxWidth: "480px", textAlign: "center" }}>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                marginBottom: "0.5rem",
              }}
            >
              Application Error
            </h1>
            <p className="ge-message" style={{ color: "#666", marginBottom: "1.5rem" }}>
              A critical error occurred. Please try refreshing the page.
            </p>
            <p
              className="ge-code"
              style={{
                fontFamily: "monospace",
                fontSize: "0.875rem",
                color: "#999",
                background: "#f5f5f5",
                padding: "0.75rem",
                borderRadius: "6px",
                marginBottom: "1.5rem",
              }}
            >
              {error.message || "Unknown error"}
              {error.digest && (
                <span
                  className="ge-digest"
                  style={{
                    display: "block",
                    marginTop: "0.25rem",
                    fontSize: "0.75rem",
                  }}
                >
                  Error ID: {error.digest}
                </span>
              )}
            </p>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                justifyContent: "center",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error replaces the root layout so next/link router context is unavailable */}
              <a
                href="/"
                className="ge-btn-secondary"
                style={{
                  padding: "0.625rem 1.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color: "#666",
                  border: "1px solid #e2e8f0",
                  background: "transparent",
                  borderRadius: "6px",
                  cursor: "pointer",
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                Go to Dashboard
              </a>
              <button
                onClick={() => reset()}
                className="ge-btn-primary"
                style={{
                  padding: "0.625rem 1.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  background: "#1b3a4b",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
