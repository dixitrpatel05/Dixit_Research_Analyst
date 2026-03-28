"use client";

import { motion } from "framer-motion";
import clsx from "clsx";

interface ConfidenceGaugeProps {
  score?: number | null;
  size?: number;
  className?: string;
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function scoreColor(score: number): string {
  if (score > 70) return "#10B981";
  if (score >= 40) return "#F59E0B";
  return "#EF4444";
}

export default function ConfidenceGauge({ score, size = 80, className }: ConfidenceGaugeProps) {
  const value = clampScore(Number(score ?? 0));

  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressLength = (value / 100) * circumference;
  const dashOffset = circumference - progressLength;

  const center = size / 2;

  return (
    <div className={clsx("inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Confidence ${value}`}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={strokeWidth}
        />

        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={scoreColor(value)}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />

        <text
          x={center}
          y={center - 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#FFFFFF"
          fontSize="16"
          fontWeight="700"
          style={{ letterSpacing: "-0.01em" }}
        >
          {Math.round(value)}
        </text>

        <text
          x={center}
          y={center + 14}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#9CA3AF"
          fontSize="10"
          fontWeight="500"
          style={{ letterSpacing: "-0.01em" }}
        >
          conf.
        </text>
      </svg>
    </div>
  );
}
