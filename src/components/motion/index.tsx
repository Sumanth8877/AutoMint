'use client';

/**
 * AutoMint motion system
 * ───────────────────────
 * A single, cohesive set of motion primitives so animation is consistent across
 * every screen instead of hand-rolled per component. Built on framer-motion.
 *
 * Design intent (balanced): refined entrances + snappy spring micro-interactions
 * that fit the cyberpunk-dark theme, never gratuitous. Everything honours the
 * user's `prefers-reduced-motion` setting via framer's `useReducedMotion`.
 *
 * Usage:
 *   <Stagger className="grid gap-4">
 *     <StaggerItem><Card>…</Card></StaggerItem>
 *   </Stagger>
 *
 *   <Reveal><section>…</section></Reveal>          // reveal on scroll into view
 *   <HoverLift><Card tone="interactive">…</Card></HoverLift>
 *   <AnimatedNumber value={1234} />                 // count-up metric
 */

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  animate,
  type Variants,
  type Transition,
  type HTMLMotionProps,
} from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// ─── Shared easings / springs ──────────────────────────────────────────────
// easeOutExpo — the "premium" deceleration curve used by Linear/Vercel.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const springs = {
  /** Snappy, for taps/toggles. */
  snappy: { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 } as Transition,
  /** Gentle, for entrances/layout. */
  gentle: { type: 'spring', stiffness: 260, damping: 30 } as Transition,
  /** Soft, for modals/overlays. */
  soft: { type: 'spring', stiffness: 300, damping: 26 } as Transition,
};

// ─── Variants ────────────────────────────────────────────────────────────────
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4, ease: EASE_OUT } },
};

export const staggerContainer = (stagger = 0.06, delayChildren = 0.04): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren } },
});

// ─── Reduced-motion helper ───────────────────────────────────────────────────
/** Returns variants with movement stripped out when reduced-motion is on. */
function useSafe(variants: Variants): Variants {
  const reduce = useReducedMotion();
  if (!reduce) return variants;
  return {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.2 } },
  };
}

// ─── Components ───────────────────────────────────────────────────────────────

/** Fade + rise on mount. */
export function FadeIn({
  children,
  delay = 0,
  className,
  ...props
}: { children: ReactNode; delay?: number } & HTMLMotionProps<'div'>) {
  const variants = useSafe(fadeInUp);
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={variants}
      transition={{ delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Reveal when scrolled into view (once). */
export function Reveal({
  children,
  className,
  amount = 0.2,
  ...props
}: { children: ReactNode; amount?: number } & HTMLMotionProps<'div'>) {
  const variants = useSafe(fadeInUp);
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      variants={variants}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Container that staggers its <StaggerItem> children in. */
export function Stagger({
  children,
  className,
  stagger = 0.06,
  once = true,
  inView = false,
  ...props
}: {
  children: ReactNode;
  stagger?: number;
  once?: boolean;
  inView?: boolean;
} & HTMLMotionProps<'div'>) {
  const trigger = inView
    ? { whileInView: 'show', viewport: { once, amount: 0.15 } as const }
    : { animate: 'show' };
  return (
    <motion.div
      initial="hidden"
      variants={staggerContainer(stagger)}
      className={className}
      {...trigger}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Item inside a <Stagger>. */
export function StaggerItem({
  children,
  className,
  ...props
}: { children: ReactNode } & HTMLMotionProps<'div'>) {
  const variants = useSafe(fadeInUp);
  return (
    <motion.div variants={variants} className={className} {...props}>
      {children}
    </motion.div>
  );
}

/** Hover lift + press interaction. Wrap any card/tile. */
export function HoverLift({
  children,
  className,
  lift = -4,
  scaleTap = 0.98,
  ...props
}: {
  children: ReactNode;
  lift?: number;
  scaleTap?: number;
} & HTMLMotionProps<'div'>) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { y: lift }}
      whileTap={reduce ? undefined : { scale: scaleTap }}
      transition={springs.snappy}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Pop-in entrance (fade + scale + slight rotation settle). Good for icon
 * badges. Only ever receives already-rendered `children` and serializable
 * style props, so it's safe to use from Server Component parents (e.g.
 * PageHeader, MetricCard) — never pass a raw component reference (like a
 * Lucide icon) as a prop into a Client Component; render it to an element
 * first and pass it as `children` instead.
 */
export function PopIn({
  children,
  className,
  rotate = 0,
  ...props
}: { children: ReactNode; rotate?: number } & HTMLMotionProps<'div'>) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -rotate }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={springs.gentle}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Page/route transition wrapper (used by RouteTransition). */
export function PageTransition({ children }: { children: ReactNode }) {
  const variants = useSafe({
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
  });
  return (
    <motion.div initial="hidden" animate="show" variants={variants}>
      {children}
    </motion.div>
  );
}

/** Count-up animated number. Falls back to the final value with reduced-motion. */
export function AnimatedNumber({
  value,
  duration = 1.1,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const ref = useRef(value);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(ref.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    ref.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);

  const formatted = `${prefix}${display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;

  return <span className={className}>{formatted}</span>;
}

export { AnimatePresence, motion, useReducedMotion };
