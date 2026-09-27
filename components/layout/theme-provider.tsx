"use client";

import React, { useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    try {
      window.localStorage.removeItem("reposcan_theme_v1");
    } catch {
      // ignore storage errors
    }
  }, []);

  return <>{children}</>;
}
