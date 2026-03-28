"use client";

import { motion } from "framer-motion";
import clsx from "clsx";

export type CatalystType =
  | "INSTITUTIONAL_BUYING"
  | "ORDER_WIN"
  | "CAPEX"
  | "RESULTS_BEAT"
  | "BONUS_SPLIT"
  | "SECTOR_TAILWIND"
  | "INSIDER_BUY"
  | "REGULATORY_BENEFIT"
  | "MANAGEMENT_UPGRADE"
  | "MULTIPLE"
  | "OTHER";

interface CatalystBadgeProps {
  type?: string;
  confidence?: number | null;
  className?: string;
}

interface BadgeTheme {
  text: string;
  bg: string;
  border: string;
  glow?: string;
  gradient?: string;
}

const CATALYST_THEME: Record<CatalystType, BadgeTheme> = {
  INSTITUTIONAL_BUYING: {
    text: "#C4B5FD",
    bg: "rgba(124,58,237,0.16)",
    border: "rgba(124,58,237,0.5)",
    glow: "0 0 20px rgba(124,58,237,0.35)",
  },
  ORDER_WIN: {
    text: "#FDBA74",
    bg: "rgba(249,115,22,0.16)",
    border: "rgba(249,115,22,0.48)",
  },
  CAPEX: {
    text: "#FDE047",
    bg: "rgba(234,179,8,0.15)",
    border: "rgba(234,179,8,0.45)",
  },
  RESULTS_BEAT: {
    text: "#93C5FD",
    bg: "rgba(59,130,246,0.15)",
    border: "rgba(59,130,246,0.46)",
  },
  BONUS_SPLIT: {
    text: "#F9A8D4",
    bg: "rgba(236,72,153,0.16)",
    border: "rgba(236,72,153,0.5)",
  },
  SECTOR_TAILWIND: {
    text: "#5EEAD4",
    bg: "rgba(20,184,166,0.16)",
    border: "rgba(20,184,166,0.45)",
  },
  INSIDER_BUY: {
    text: "#6EE7B7",
    bg: "rgba(16,185,129,0.16)",
    border: "rgba(16,185,129,0.45)",
  },
  REGULATORY_BENEFIT: {
    text: "#A5B4FC",
    bg: "rgba(99,102,241,0.16)",
    border: "rgba(99,102,241,0.45)",
  },
  MANAGEMENT_UPGRADE: {
    text: "#67E8F9",
    bg: "rgba(6,182,212,0.16)",
    border: "rgba(6,182,212,0.45)",
  },
  MULTIPLE: {
    text: "#E9D5FF",
    bg: "rgba(99,102,241,0.14)",
    border: "rgba(139,92,246,0.5)",
    gradient: "linear-gradient(90deg, rgba(59,130,246,0.25), rgba(124,58,237,0.25))",
  },
  OTHER: {
    text: "#D1D5DB",
    bg: "rgba(107,114,128,0.14)",
    border: "rgba(107,114,128,0.45)",
  },
};

function normalizeType(type?: string): CatalystType {
  const key = String(type || "OTHER").toUpperCase();
  if (key in CATALYST_THEME) {
    return key as CatalystType;
  }
  return "OTHER";
}

function formatLabel(type: CatalystType): string {
  return type
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export default function CatalystBadge({ type, confidence, className }: CatalystBadgeProps) {
  const catalystType = normalizeType(type);
  const theme = CATALYST_THEME[catalystType];

  const shouldPulse = catalystType === "INSTITUTIONAL_BUYING" && Number(confidence || 0) > 80;
  const motionAnimate = shouldPulse
    ? {
        opacity: 1,
        y: 0,
        boxShadow: [
          "0 0 0 rgba(124,58,237,0.0)",
          theme.glow || "0 0 18px rgba(124,58,237,0.3)",
          "0 0 0 rgba(124,58,237,0.0)",
        ],
      }
    : { opacity: 1, y: 0 };
  const motionTransition = shouldPulse
    ? {
        opacity: { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const },
        y: { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const },
        boxShadow: {
          duration: 1.8,
          repeat: Infinity,
          ease: "easeInOut" as const,
        },
      }
    : { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const };

  return (
    <motion.span
      initial={{ opacity: 0, y: 4 }}
      animate={motionAnimate}
      transition={motionTransition}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[-0.01em]",
        className,
      )}
      style={{
        color: theme.text,
        borderColor: theme.border,
        background: theme.gradient || theme.bg,
        boxShadow: shouldPulse ? theme.glow : "none",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: theme.text,
          opacity: 0.95,
        }}
      />
      <span>{formatLabel(catalystType)}</span>
    </motion.span>
  );
}
