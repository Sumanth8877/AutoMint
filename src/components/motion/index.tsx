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
  useMotionValue,
  useSpring,
  useTransform,
  useInView,
  animate,
  type Variants,
  type Transition,
  type HTMLMotionProps,
} from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';

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

/**
 * Count-up animated number. Falls back to the final value with
 * reduced-motion. Pass `startOnView` (default true) to only start counting
 * once the element scrolls into the viewport — the pattern big marketing
 * sites use for stat sections, instead of counting up invisibly on mount.
 */
export function AnimatedNumber({
  value,
  duration = 1.4,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
  startOnView = true,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  startOnView?: boolean;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const ref = useRef(value);
  const elRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(elRef, { once: true, amount: 0.6 });
  const shouldStart = !startOnView || inView;

  useEffect(() => {
    if (reduce || !shouldStart) {
      if (reduce) {
        // Defer to avoid synchronous setState in effect body
        const frame = requestAnimationFrame(() => setDisplay(value));
        return () => cancelAnimationFrame(frame);
      }
      return;
    }
    const controls = animate(ref.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    ref.current = value;
    return () => controls.stop();
  }, [value, duration, reduce, shouldStart]);

  const formatted = `${prefix}${display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;

  return <span ref={elRef} className={className}>{formatted}</span>;
}

// ─── 3D pointer-tilt card ─────────────────────────────────────────────────
/**
 * Wraps children in a card that tilts in 3D toward the cursor (rotateX/
 * rotateY driven by pointer position, spring-smoothed) with an optional
 * moving "sheen" highlight — the tactile depth effect used on Linear/
 * Stripe/Framer marketing sites. Only ever receives already-rendered
 * `children`, so it's safe to call from Server Component parents.
 */
export function TiltCard({
  children,
  className,
  max = 10,
  sheen = true,
  scaleOnHover = 1.01,
}: {
  children: ReactNode;
  className?: string;
  /** Max rotation in degrees. */
  max?: number;
  sheen?: boolean;
  scaleOnHover?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rotateX = useSpring(0, { stiffness: 220, damping: 22, mass: 0.6 });
  const rotateY = useSpring(0, { stiffness: 220, damping: 22, mass: 0.6 });
  const sheenX = useMotionValue(50);
  const sheenY = useMotionValue(50);
  const sheenBackground = useTransform(
    [sheenX, sheenY],
    ([x, y]) => `radial-gradient(circle at ${x}% ${y}%, rgba(79,70,229,0.06), transparent 55%)`,
  );
  const [hovering, setHovering] = useState(false);

  function handleMove(e: ReactMouseEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    rotateY.set((px - 0.5) * max * 2);
    rotateX.set(-(py - 0.5) * max * 2);
    sheenX.set(px * 100);
    sheenY.set(py * 100);
  }

  function handleLeave() {
    rotateX.set(0);
    rotateY.set(0);
    setHovering(false);
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ perspective: 1000 }}
      onMouseMove={handleMove}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={handleLeave}
    >
      <motion.div
        style={{
          rotateX: reduce ? 0 : rotateX,
          rotateY: reduce ? 0 : rotateY,
          transformStyle: 'preserve-3d',
          position: 'relative',
        }}
        animate={{ scale: hovering && !reduce ? scaleOnHover : 1 }}
        transition={springs.gentle}
        className="h-full"
      >
        {children}
        {sheen && !reduce && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{
              background: sheenBackground,
              opacity: hovering ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
          />
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Magnetic button ────────────────────────────────────────────────────
/**
 * Wraps a button/link so it subtly follows the cursor within a small
 * radius, then springs back on leave — the "magnetic CTA" micro-
 * interaction common on premium product sites. `children` should be the
 * already-rendered button/link element.
 */
export function Magnetic({
  children,
  className,
  strength = 0.35,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 300, damping: 20, mass: 0.5 });
  const y = useSpring(0, { stiffness: 300, damping: 20, mass: 0.5 });

  function handleMove(e: ReactMouseEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((e.clientX - rect.left - rect.width / 2) * strength);
    y.set((e.clientY - rect.top - rect.height / 2) * strength);
  }

  function handleLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ x: reduce ? 0 : x, y: reduce ? 0 : y, display: 'inline-block' }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {children}
    </motion.div>
  );
}

// ─── Cursor spotlight ────────────────────────────────────────────────────
/**
 * Full-bleed radial-gradient glow that tracks the pointer within its
 * parent — drop into a `relative` hero/section as an absolutely
 * positioned background layer. Purely decorative (pointer-events-none).
 */
export function Spotlight({
  className,
  color = 'rgba(79,70,229,0.05)',
  size = 700,
}: {
  className?: string;
  color?: string;
  size?: number;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const bg = useTransform(
    [x, y],
    ([px, py]) => `radial-gradient(${size}px circle at ${(px as number) * 100}% ${(py as number) * 100}%, ${color}, transparent 70%)`,
  );

  function handleMove(e: ReactMouseEvent<HTMLDivElement>) {
    if (reduce) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width);
    y.set((e.clientY - rect.top) / rect.height);
  }

  return (
    <motion.div
      aria-hidden="true"
      onMouseMove={handleMove}
      className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
      style={{ background: reduce ? undefined : bg }}
    />
  );
}

// ─── Drifting gradient orb ───────────────────────────────────────────────
/** Slow, looping blurred-orb drift — ambient depth for hero backgrounds. */
export function FloatingOrb({
  className,
  size = 480,
  color = 'rgba(79,70,229,0.08)',
  duration = 14,
  range = 40,
}: {
  className?: string;
  size?: number;
  color?: string;
  duration?: number;
  range?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-full blur-3xl ${className ?? ''}`}
      style={{ width: size, height: size, background: color }}
      animate={
        reduce
          ? undefined
          : { x: [0, range, -range * 0.6, 0], y: [0, -range * 0.8, range * 0.5, 0] }
      }
      transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

// ─── Infinite marquee ────────────────────────────────────────────────────
/** Seamless infinite horizontal scroll — duplicate `children` once for the loop. */
export function Marquee({
  children,
  className,
  duration = 28,
  reverse = false,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
  reverse?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={`flex overflow-hidden ${className ?? ''}`}>
      <motion.div
        className="flex shrink-0 items-center gap-12 pr-12"
        animate={reduce ? undefined : { x: reverse ? ['-100%', '0%'] : ['0%', '-100%'] }}
        transition={reduce ? undefined : { duration, repeat: Infinity, ease: 'linear' }}
      >
        {children}
        {children}
      </motion.div>
    </div>
  );
}

export { AnimatePresence, motion, useReducedMotion, useMotionValue, useSpring, useTransform };
