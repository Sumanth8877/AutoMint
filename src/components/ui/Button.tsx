"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { springs } from "@/components/motion";
import XiaoheiMascot, { type MascotPose, type MascotPosition } from "./XiaoheiMascot";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onAnimationStart" | "onAnimationEnd" | "onDragStart" | "onDragEnd" | "onDrag"
>;

interface ButtonProps extends NativeButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success" | "neon" | "gold";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  glow?: boolean;
  /** Show a 小黑 mascot on the button. Pass a pose name or true for default. */
  mascot?: MascotPose | boolean;
  /** Where the mascot sits relative to the button. */
  mascotPosition?: MascotPosition;
  children: ReactNode;
}

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  glow = false,
  mascot,
  mascotPosition = "top-right",
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const base =
    "inline-flex shrink-0 items-center justify-center font-semibold rounded-lg transition-all duration-200 " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-background tracking-tight will-change-transform";

  const variants: Record<string, string> = {
    primary:
      "bg-primary text-white shadow-sm shadow-primary/20 " +
      "hover:bg-primary-hover hover:shadow-md hover:shadow-primary/25",
    secondary:
      "bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-hover shadow-sm",
    ghost: "bg-transparent text-secondary hover:text-text hover:bg-surface-hover",
    danger:
      "bg-danger text-white shadow-sm shadow-danger/20 hover:bg-red-600 hover:shadow-md",
    success:
      "bg-success text-white shadow-sm shadow-success/20 hover:bg-emerald-600 hover:shadow-md",
    neon:
      "bg-primary-soft text-primary border border-primary/20 hover:bg-indigo-50 hover:border-primary/30 " +
      "shadow-sm",
    gold:
      "bg-gold-soft text-gold border border-gold/20 hover:bg-amber-50 hover:border-gold/40 " +
      "shadow-sm",
  };

  const sizes: Record<string, string> = {
    xs: "h-7 px-2.5 text-xs gap-1",
    sm: "h-8 px-3 text-xs gap-1.5",
    md: "h-10 px-4 text-sm gap-2",
    lg: "h-11 px-5 text-sm gap-2.5",
    xl: "h-13 px-7 text-base gap-3",
  };

  // 小黑 sits on every normal button by default. Dense/icon-only buttons
  // (xs, sm — typically repeated table row actions) stay clean unless a
  // mascot is explicitly requested via the `mascot` prop.
  const defaultMascotEnabled: Record<string, boolean> = {
    xs: false,
    sm: false,
    md: true,
    lg: true,
    xl: true,
  };
  const mascotScaleBySize: Record<string, number> = {
    xs: 0.6,
    sm: 0.7,
    md: 0.85,
    lg: 1,
    xl: 1.15,
  };

  const glowStyle = glow && variant === "neon"
    ? { boxShadow: "0 0 0 1px rgba(79,70,229,0.15), 0 2px 12px rgba(79,70,229,0.15)" }
    : glow && variant === "primary"
    ? { boxShadow: "0 0 0 1px rgba(79,70,229,0.20), 0 2px 12px rgba(79,70,229,0.20)" }
    : undefined;

  const isDisabled = disabled || loading;
  const mascotPose: MascotPose | null =
    mascot === false
      ? null
      : mascot === true
      ? "sitting"
      : typeof mascot === "string"
      ? mascot
      : defaultMascotEnabled[size]
      ? "sitting"
      : null;
  const showMascot = mascotPose && !isDisabled;

  const button = (
    <motion.button
      className={`${base} ${variants[variant]} ${sizes[size]} ${
        isDisabled ? "cursor-not-allowed opacity-50" : ""
      } ${className}`}
      style={glowStyle}
      disabled={isDisabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      whileHover={reduce || isDisabled ? undefined : { scale: 1.02 }}
      whileTap={reduce || isDisabled ? undefined : { scale: 0.97 }}
      transition={springs.snappy}
      {...props}
    >
      {loading && (
        <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </motion.button>
  );

  if (!showMascot) return button;

  return (
    <div className="relative inline-flex">
      <XiaoheiMascot
        pose={mascotPose}
        position={mascotPosition}
        hovered={hovered}
        pressed={pressed}
        scale={mascotScaleBySize[size]}
      />
      {button}
    </div>
  );
}
