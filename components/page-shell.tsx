"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { pageVariants } from "@/lib/motion";

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
  /** Skip the max-width constraint (for full-bleed layouts) */
  fluid?: boolean;
  /** Disable entrance animation */
  noAnimation?: boolean;
}

export function PageShell({ children, className, fluid, noAnimation }: PageShellProps) {
  const content = (
    <div className={cn("space-y-8", !fluid && "mx-auto max-w-[1400px]", className)}>{children}</div>
  );

  if (noAnimation) return content;

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className={cn("space-y-8", !fluid && "mx-auto max-w-[1400px]", className)}
    >
      {children}
    </motion.div>
  );
}
