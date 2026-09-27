"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const WHATSAPP_CHANNEL_URL =
  "https://whatsapp.com/channel/0029Vb6ukqnHQbS4mKP0j80L";

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center shrink-0",
        className
      )}
      aria-hidden="true"
    >
      <MessageCircle className="h-full w-full text-white stroke-[2]" />
      <Phone className="absolute h-[45%] w-[45%] text-white fill-white stroke-[1.75]" />
    </span>
  );
}

interface NavbarProps {
  sidebarSlot?: React.ReactNode;
}

export function Navbar({ sidebarSlot }: NavbarProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Overview" },
    { href: "/scan", label: "Scanner" },
    { href: "/results", label: "Results" },
  ];

  return (
    <header className="sticky top-0 z-40 h-14 w-full border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur-xs">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-4 sm:px-6">
        {/* Zone 1: Brand Title */}
        <div className="flex items-center gap-3">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open navigation menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] lg:hidden cursor-pointer"
              >
                <Menu className="h-4 w-4" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0">
              <div className="flex h-[60px] items-center justify-between border-b border-[var(--border-subtle)] pl-5 pr-13">
                <Link
                  href="/"
                  onClick={() => setDrawerOpen(false)}
                  className="text-base font-semibold tracking-tight text-[var(--text-primary)] whitespace-nowrap"
                >
                  RepoScan
                </Link>
                <a
                  href={WHATSAPP_CHANNEL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="WhatsApp Channel"
                  title="WhatsApp Channel"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/5 text-white hover:bg-white/10 hover:border-white/25 transition-colors"
                >
                  <WhatsAppIcon className="h-4 w-4" />
                </a>
              </div>
              <nav className="flex flex-col gap-1 p-4 border-b border-[var(--border-subtle)]">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setDrawerOpen(false)}
                      className={cn(
                        "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                <a
                  href={WHATSAPP_CHANNEL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setDrawerOpen(false)}
                  className="mt-1 flex items-center gap-2.5 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  <WhatsAppIcon className="h-4 w-4" />
                  <span>WhatsApp Channel</span>
                </a>
              </nav>
              {sidebarSlot && (
                <div
                  className="flex-1 overflow-y-auto p-4"
                  onClick={() => setDrawerOpen(false)}
                >
                  {sidebarSlot}
                </div>
              )}
            </SheetContent>
          </Sheet>

          <Link
            href="/"
            className="text-base font-semibold tracking-tight text-[var(--text-primary)] whitespace-nowrap"
          >
            RepoScan
          </Link>
        </div>

        {/* Zone 2: Clean Typography Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap transition-colors py-1 border-b-2",
                  isActive
                    ? "border-emerald-600 text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-2.5">
          <a
            href={WHATSAPP_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp Channel"
            title="WhatsApp Channel"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-white hover:bg-white/10 hover:border-white/25 transition-colors whitespace-nowrap"
          >
            <WhatsAppIcon className="h-4 w-4" />
            <span className="hidden sm:inline">WhatsApp Channel</span>
          </a>
          <Button asChild size="sm">
            <Link href="/scan">Scan Repository</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
