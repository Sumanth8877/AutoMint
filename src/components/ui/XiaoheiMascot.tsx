"use client";

/**
 * XiaoheiMascot — Animated SVG mascot component
 * ────────────────────────────────────────────────
 * 小黑 (Xiaohei): solid-black bean creature, white dot eyes, thin legs,
 * deadpan expression. Like a low-key system operator doing absurd work.
 *
 * Features:
 *  - Eye tracking (pupils follow cursor via parent ref)
 *  - Periodic blinking (staggered per eye)
 *  - Idle bobbing / breathing
 *  - Hover: sweat drop + jump
 *  - Click: spring squish + particle burst
 *  - Leg swinging (independent timing)
 *  - Sleeping → wake-up shake
 *  - Carrying pose with NFT box
 *  - Reduced motion: all animation disabled
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  motion,
  useReducedMotion,
  AnimatePresence,
} from "framer-motion";
import { springs } from "@/components/motion";

export type MascotPose =
  | "sitting"
  | "peeking"
  | "waving"
  | "sleeping"
  | "carrying";

export type MascotPosition =
  | "top-right"
  | "top-left"
  | "top-center"
  | "left"
  | "right";

/* ━━━ Eye tracking hook ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function useEyeTracking(svgRef: React.RefObject<SVGSVGElement | null>, reduce: boolean | null) {
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (reduce) return;
    let raf: number;
    const track = (e: MouseEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const max = 1.8;
      const fx = dist > 0 ? (dx / dist) * Math.min(max, dist / 80) : 0;
      const fy = dist > 0 ? (dy / dist) * Math.min(max, dist / 80) : 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPupilOffset({ x: fx, y: fy }));
    };
    window.addEventListener("mousemove", track);
    return () => {
      window.removeEventListener("mousemove", track);
      cancelAnimationFrame(raf);
    };
  }, [svgRef, reduce]);

  return pupilOffset;
}

/* ━━━ Blink hook ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function useBlink(reduce: boolean | null) {
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const blink = () => {
      setBlinking(true);
      setTimeout(() => setBlinking(false), 150);
    };
    const interval = setInterval(blink, 3000 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, [reduce]);
  return blinking;
}

/* ━━━ Particle burst ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/** Simple deterministic hash so particle layout looks varied without Math.random(). */
function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const PARTICLE_CHARS = ["✦", "★", "·", "✧", "⚡"];
const PARTICLE_COLORS = ["#4F46E5", "#F59E0B", "#10B981", "#EF4444", "#6366F1"];

/** Pre-computed deterministic particles — pure, no randomness at runtime. */
const PARTICLES = Array.from({ length: 8 }, (_, i) => {
  const r1 = seededRand(i * 3 + 1);
  const r2 = seededRand(i * 3 + 2);
  const r3 = seededRand(i * 3 + 3);
  const r4 = seededRand(i * 3 + 4);
  const angle = (i / 8) * Math.PI * 2 + (r1 - 0.5) * 0.5;
  const dist = 16 + r2 * 12;
  return {
    id: i,
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    char: PARTICLE_CHARS[Math.floor(r3 * 5)],
    color: PARTICLE_COLORS[Math.floor(r4 * 5)],
  };
});

function ParticleBurst({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <g>
      {PARTICLES.map((p) => (
        <motion.text
          key={p.id}
          x="20"
          y="18"
          fill={p.color}
          fontSize="6"
          fontWeight="bold"
          initial={{ opacity: 1, x: 0, y: 0 }}
          animate={{ opacity: 0, x: p.x, y: p.y, scale: 0.3 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {p.char}
        </motion.text>
      ))}
    </g>
  );
}

/* ━━━ Shared eye component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function Eye({
  cx,
  cy,
  pupilOffset,
  blinking,
  hovered,
  rx = 2.5,
  ry = 2.8,
}: {
  cx: number;
  cy: number;
  pupilOffset: { x: number; y: number };
  blinking: boolean;
  hovered: boolean;
  rx?: number;
  ry?: number;
}) {
  const eyeRy = blinking ? 0.3 : hovered ? ry + 0.6 : ry;
  const eyeRx = hovered ? rx + 0.3 : rx;
  return (
    <>
      <motion.ellipse
        cx={cx}
        cy={cy}
        rx={eyeRx}
        animate={{ ry: eyeRy }}
        transition={{ duration: 0.08 }}
        fill="white"
      />
      <circle
        cx={cx + pupilOffset.x}
        cy={cy + pupilOffset.y}
        r={hovered ? 1.4 : 1.2}
        fill="#1a1a1a"
      />
    </>
  );
}

/* ━━━ Sweat drop ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function SweatDrop({ visible, x = 32, y = 6 }: { visible: boolean; x?: number; y?: number }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.path
          d={`M${x} ${y} Q${x + 1} ${y + 4} ${x} ${y + 6} Q${x - 2} ${y + 6} ${x - 1} ${y + 2}Z`}
          fill="#60A5FA"
          opacity={0.7}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 0.7, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.4 }}
        />
      )}
    </AnimatePresence>
  );
}

/* ━━━ Pose: Sitting ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function SittingPose(props: PoseProps) {
  const { hovered, pupilOffset, blinking, reduce } = props;
  return (
    <>
      {/* Legs (swing independently) */}
      <motion.g
        animate={reduce ? undefined : { rotate: hovered ? [0, 10, -10, 0] : [0, 6, 0] }}
        transition={hovered ? { duration: 0.6, repeat: Infinity } : { duration: 2, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: "14px", originY: "30px" }}
      >
        <rect x="11" y="30" width="4.5" height="12" rx="2.2" fill="#1a1a1a" />
        <ellipse cx="13.5" cy="43" rx="3.8" ry="2" fill="#1a1a1a" />
      </motion.g>
      <motion.g
        animate={reduce ? undefined : { rotate: hovered ? [0, -10, 10, 0] : [0, -6, 0] }}
        transition={hovered ? { duration: 0.6, repeat: Infinity, delay: 0.15 } : { duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        style={{ originX: "26px", originY: "30px" }}
      >
        <rect x="24.5" y="30" width="4.5" height="12" rx="2.2" fill="#1a1a1a" />
        <ellipse cx="26.5" cy="43" rx="3.8" ry="2" fill="#1a1a1a" />
      </motion.g>
      {/* Body */}
      <ellipse cx="20" cy="18" rx="14.5" ry="14" fill="#1a1a1a" />
      {/* Arms (appear on hover) */}
      <AnimatePresence>
        {hovered && (
          <>
            <motion.ellipse cx="4" cy="20" rx="3" ry="1.8" fill="#1a1a1a"
              initial={{ x: 3, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 3, opacity: 0 }} />
            <motion.ellipse cx="36" cy="20" rx="3" ry="1.8" fill="#1a1a1a"
              initial={{ x: -3, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -3, opacity: 0 }} />
          </>
        )}
      </AnimatePresence>
      {/* Eyes */}
      <Eye cx={14} cy={16} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} />
      <Eye cx={26} cy={16} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} />
      {/* Mouth */}
      <path d={hovered ? "M16 23 Q20 26 24 23" : "M17 23 Q20 24.5 23 23"} stroke="#444" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      <SweatDrop visible={hovered} />
    </>
  );
}

/* ━━━ Pose: Peeking ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function PeekingPose(props: PoseProps) {
  const { hovered, pupilOffset, blinking, reduce } = props;
  return (
    <>
      <ellipse cx="18" cy="16" rx="14" ry="13" fill="#1a1a1a" />
      <Eye cx={12} cy={13} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} rx={2.2} ry={2.6} />
      <Eye cx={24} cy={13} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} rx={2.2} ry={2.6} />
      {/* Gripping hands */}
      <motion.g animate={reduce ? undefined : hovered ? { y: -2 } : { y: [0, 1, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}>
        <ellipse cx="5" cy="27" rx="3.5" ry="2.5" fill="#1a1a1a" />
        <rect x="3.5" y="24" width="2.5" height="4" rx="1.2" fill="#1a1a1a" />
      </motion.g>
      <motion.g animate={reduce ? undefined : hovered ? { y: -2 } : { y: [0, 1, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}>
        <ellipse cx="31" cy="27" rx="3.5" ry="2.5" fill="#1a1a1a" />
        <rect x="30.5" y="24" width="2.5" height="4" rx="1.2" fill="#1a1a1a" />
      </motion.g>
      <SweatDrop visible={hovered} x={30} y={4} />
    </>
  );
}

/* ━━━ Pose: Waving ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function WavingPose(props: PoseProps) {
  const { hovered, pupilOffset, blinking, reduce } = props;
  return (
    <>
      {/* Legs */}
      <motion.g animate={reduce ? undefined : { rotate: [0, 5, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: "16px", originY: "32px" }}>
        <rect x="14" y="32" width="4" height="10" rx="2" fill="#1a1a1a" />
        <ellipse cx="16" cy="43" rx="3.5" ry="2" fill="#1a1a1a" />
      </motion.g>
      <motion.g animate={reduce ? undefined : { rotate: [0, -5, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        style={{ originX: "28px", originY: "32px" }}>
        <rect x="26" y="32" width="4" height="10" rx="2" fill="#1a1a1a" />
        <ellipse cx="28" cy="43" rx="3.5" ry="2" fill="#1a1a1a" />
      </motion.g>
      {/* Body */}
      <ellipse cx="22" cy="20" rx="14" ry="14" fill="#1a1a1a" />
      {/* Left arm (still) */}
      <ellipse cx="6" cy="24" rx="3" ry="2" fill="#1a1a1a" />
      {/* Right arm (waving) */}
      <motion.g
        animate={reduce ? undefined : hovered ? { rotate: [-15, 20, -15] } : { rotate: [-5, 15, -5] }}
        transition={hovered ? { duration: 0.4, repeat: Infinity } : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: "36px", originY: "22px" }}>
        <rect x="35" y="6" width="3.5" height="14" rx="1.75" fill="#1a1a1a" />
        <circle cx="36.75" cy="5" r="3" fill="#1a1a1a" />
      </motion.g>
      {/* Eyes */}
      <Eye cx={16} cy={17} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} />
      <Eye cx={28} cy={17} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} />
      {/* Happy mouth */}
      <path d={hovered ? "M17 26 Q22 30 27 26" : "M18 25 Q22 27 26 25"} stroke="#444" strokeWidth="0.8" strokeLinecap="round" fill={hovered ? "#444" : "none"} />
      <SweatDrop visible={hovered} x={36} y={8} />
    </>
  );
}

/* ━━━ Pose: Sleeping ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function SleepingPose(props: PoseProps) {
  const { hovered, pupilOffset, blinking, reduce } = props;
  return (
    <>
      <ellipse cx="22" cy="20" rx="17" ry="12" fill="#1a1a1a" />
      {/* Closed eyes */}
      <AnimatePresence mode="wait">
        {!hovered ? (
          <motion.g key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <path d="M12 17 Q15 15 18 17" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            <path d="M26 17 Q29 15 32 17" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </motion.g>
        ) : (
          <motion.g key="awake" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <Eye cx={15} cy={17} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} rx={2.5} ry={3} />
            <Eye cx={29} cy={17} pupilOffset={pupilOffset} blinking={blinking} hovered={hovered} rx={2.5} ry={3} />
          </motion.g>
        )}
      </AnimatePresence>
      {/* Blush */}
      <circle cx="9" cy="22" r="2" fill="#555" opacity={0.15} />
      <circle cx="35" cy="22" r="2" fill="#555" opacity={0.15} />
      {/* Z's (disappear on hover) */}
      <AnimatePresence>
        {!hovered && !reduce && (
          <motion.g exit={{ opacity: 0 }}>
            <motion.text x="37" y="8" fill="#94A3B8" fontSize="9" fontWeight="bold" fontFamily="sans-serif"
              animate={{ opacity: [0, 1, 0], x: [0, 4, 8], y: [0, -6, -12] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut" }}>z</motion.text>
            <motion.text x="40" y="3" fill="#94A3B8" fontSize="7" fontWeight="bold" fontFamily="sans-serif"
              animate={{ opacity: [0, 1, 0], x: [0, 5, 10], y: [0, -8, -16] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut", delay: 0.8 }}>z</motion.text>
          </motion.g>
        )}
      </AnimatePresence>
      {/* Mouth */}
      <path d={hovered ? "M19 25 Q22 28 25 25" : "M19 24 Q22 25.5 25 24"} stroke="#444" strokeWidth="0.7" strokeLinecap="round" fill="none" />
    </>
  );
}

/* ━━━ Pose: Carrying ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function CarryingPose(props: PoseProps) {
  const { hovered, pupilOffset, blinking, reduce } = props;
  return (
    <>
      {/* Legs */}
      <motion.g animate={reduce ? undefined : { rotate: [0, 4, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: "14px", originY: "30px" }}>
        <rect x="12" y="30" width="4" height="11" rx="2" fill="#1a1a1a" />
        <ellipse cx="14" cy="42" rx="3.5" ry="2" fill="#1a1a1a" />
      </motion.g>
      <motion.g animate={reduce ? undefined : { rotate: [0, -4, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.25 }}
        style={{ originX: "26px", originY: "30px" }}>
        <rect x="24" y="30" width="4" height="11" rx="2" fill="#1a1a1a" />
        <ellipse cx="26" cy="42" rx="3.5" ry="2" fill="#1a1a1a" />
      </motion.g>
      {/* Body */}
      <ellipse cx="20" cy="18" rx="14" ry="14" fill="#1a1a1a" />
      {/* Arms holding up */}
      <rect x="6" y="8" width="3" height="9" rx="1.5" fill="#1a1a1a" />
      <rect x="31" y="8" width="3" height="9" rx="1.5" fill="#1a1a1a" />
      {/* Box on head */}
      <motion.g animate={reduce ? undefined : { rotate: hovered ? [-2, 2, -2] : [0, 1, 0] }}
        transition={{ duration: hovered ? 0.3 : 2, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: "20px", originY: "8px" }}>
        <rect x="7" y="-6" width="26" height="14" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5" strokeDasharray="3 2" />
        <text x="12" y="5" fill="#1a1a1a" fontSize="5.5" fontFamily="sans-serif" fontWeight="700">NFT</text>
      </motion.g>
      {/* Eyes (strained, looking up) */}
      <Eye cx={14} cy={17} pupilOffset={{ x: pupilOffset.x, y: Math.min(pupilOffset.y, -0.5) }} blinking={blinking} hovered={hovered} rx={2.2} ry={2.4} />
      <Eye cx={26} cy={17} pupilOffset={{ x: pupilOffset.x, y: Math.min(pupilOffset.y, -0.5) }} blinking={blinking} hovered={hovered} rx={2.2} ry={2.4} />
      {/* Strained mouth */}
      <line x1="16" y1="24" x2="24" y2="24" stroke="#444" strokeWidth="0.8" strokeLinecap="round" />
      {/* Permanent sweat */}
      <path d="M33 8 Q34 11 33 13 Q31 13 32 9Z" fill="#60A5FA" opacity={0.5} />
      <SweatDrop visible={hovered} x={35} y={12} />
    </>
  );
}

/* ━━━ Pose props type ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
interface PoseProps {
  hovered: boolean;
  pupilOffset: { x: number; y: number };
  blinking: boolean;
  reduce: boolean | null;
}

/* ━━━ Position styles ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const positionStyles: Record<MascotPosition, CSSProperties> = {
  "top-right":  { position: "absolute", top: "-36px", right: "-6px" },
  "top-left":   { position: "absolute", top: "-36px", left: "-6px" },
  "top-center": { position: "absolute", top: "-36px", left: "50%", transform: "translateX(-50%)" },
  "left":       { position: "absolute", top: "50%", left: "-32px", transform: "translateY(-50%)" },
  "right":      { position: "absolute", top: "50%", right: "-32px", transform: "translateY(-50%)" },
};

const viewBoxMap: Record<MascotPose, string> = {
  sitting:  "0 -2 40 48",
  peeking:  "0 0 36 32",
  waving:   "0 -2 44 48",
  sleeping: "0 -2 44 36",
  carrying: "0 -10 40 56",
};

/* ━━━ Main component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function XiaoheiMascot({
  pose = "sitting",
  position = "top-right",
  hovered = false,
  pressed = false,
}: {
  pose?: MascotPose;
  position?: MascotPosition;
  hovered?: boolean;
  pressed?: boolean;
}) {
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const pupilOffset = useEyeTracking(svgRef, reduce);
  const blinking = useBlink(reduce);
  const [showParticles, setShowParticles] = useState(false);

  useEffect(() => {
    if (pressed) {
      // Defer setState to avoid synchronous state update in effect body
      const frame = requestAnimationFrame(() => setShowParticles(true));
      const t = setTimeout(() => setShowParticles(false), 500);
      return () => { cancelAnimationFrame(frame); clearTimeout(t); };
    }
  }, [pressed]);

  const poseProps: PoseProps = { hovered, pupilOffset, blinking, reduce };

  const PoseComponent = {
    sitting: SittingPose,
    peeking: PeekingPose,
    waving: WavingPose,
    sleeping: SleepingPose,
    carrying: CarryingPose,
  }[pose];

  return (
    <motion.div
      style={{ ...positionStyles[position], pointerEvents: "none", zIndex: 10 }}
      aria-hidden="true"
      animate={
        reduce ? undefined
        : pressed ? { scale: 0.85, y: 4 }
        : hovered ? { y: -6 }
        : { y: [0, -2, 0] }
      }
      transition={
        pressed ? springs.snappy
        : hovered ? { duration: 0.3 }
        : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
      }
    >
      <motion.svg
        ref={svgRef}
        viewBox={viewBoxMap[pose]}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: 48, height: "auto", overflow: "visible" }}
        animate={
          reduce ? undefined
          : pressed ? { scaleY: 0.8, scaleX: 1.15 }
          : { scaleY: 1, scaleX: 1 }
        }
        transition={pressed ? { type: "spring", stiffness: 500, damping: 15 } : springs.snappy}
      >
        <PoseComponent {...poseProps} />
        <ParticleBurst active={showParticles} />
      </motion.svg>
    </motion.div>
  );
}
