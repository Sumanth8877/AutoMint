'use client';

/**
 * MintMachineIllustration — Animated recreation of the hero "mint machine" doodle.
 * ─────────────────────────────────────────────────────────────────────────
 * Same composition as illustrations/hero-mint-machine.jpeg (NFT → funnel →
 * gear box → chute → stream of minted NFTs), but built as inline SVG so the
 * parts can actually move:
 *   - Xiaohei (the bean operator) pumps the lever in a steady loop
 *   - Two gears inside the box spin in opposite directions
 *   - An NFT tile drops through the funnel on each "auto-fire" cycle
 *   - A stream of small tiles fires out of the chute, matching the cycle
 *   - The "< 50 ms" arrow pulses to sell the speed
 *
 * Respects prefers-reduced-motion — everything freezes to a clean static
 * frame instead of looping.
 */

import { motion, useReducedMotion } from '@/components/motion';
import type { Transition } from 'framer-motion';

const CYCLE = 1.8; // seconds per auto-fire cycle

export function MintMachineIllustration({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  const loop = (transition: Transition): Transition =>
    reduce ? { duration: 0 } : { repeat: Infinity, ease: 'easeInOut', ...transition };

  return (
    <svg
      viewBox="0 0 400 225"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Illustration of a small character firing NFTs through a mint machine in under 50 milliseconds"
    >
      {/* ── background ── */}
      <rect x="0" y="0" width="400" height="225" fill="white" />

      {/* ── incoming NFT tile dropping into the funnel ── */}
      <motion.g
        animate={reduce ? undefined : { y: [-18, 22, 22], opacity: [1, 1, 0] }}
        transition={loop({ duration: CYCLE, times: [0, 0.55, 0.62], repeatDelay: CYCLE * 0.15 })}
      >
        <rect x="223" y="18" width="26" height="26" rx="4" fill="white" stroke="#1a1a1a" strokeWidth="2" />
        <text x="236" y="35" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1a1a1a" fontFamily="ui-monospace, monospace">
          NFT
        </text>
      </motion.g>
      <path d="M236 46 L236 58" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" markerEnd="url(#arrowhead)" />
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#1a1a1a" />
        </marker>
      </defs>

      {/* ── funnel ── */}
      <path d="M205 60 L267 60 L248 92 L224 92 Z" fill="white" stroke="#1a1a1a" strokeWidth="2.2" strokeLinejoin="round" />
      <text x="236" y="76" textAnchor="middle" fontSize="10" fontWeight="600" fill="#1a1a1a" fontFamily="ui-monospace, monospace">
        contract
      </text>
      <text x="304" y="55" textAnchor="middle" fontSize="10.5" fontStyle="italic" fontWeight="600" fill="#4F46E5">
        any chain
      </text>

      {/* ── machine box ── */}
      <rect x="196" y="92" width="104" height="72" rx="6" fill="white" stroke="#1a1a1a" strokeWidth="2.4" />

      {/* gears (spin opposite directions, continuously — independent of fire cycle) */}
      <motion.g
        style={{ transformOrigin: '224px 122px' }}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={loop({ duration: 3.2, ease: 'linear' })}
      >
        <Gear cx={224} cy={122} r={13} teeth={8} />
      </motion.g>
      <motion.g
        style={{ transformOrigin: '252px 138px' }}
        animate={reduce ? undefined : { rotate: -360 }}
        transition={loop({ duration: 2.6, ease: 'linear' })}
      >
        <Gear cx={252} cy={138} r={10} teeth={7} />
      </motion.g>

      {/* chute flap — flicks open on each fire cycle */}
      <motion.path
        d="M300 108 L322 100 L322 128 L300 120 Z"
        fill="white"
        stroke="#1a1a1a"
        strokeWidth="2"
        strokeLinejoin="round"
        style={{ transformOrigin: '300px 114px' }}
        animate={reduce ? undefined : { rotate: [0, 22, 0] }}
        transition={loop({ duration: CYCLE, times: [0, 0.6, 1] })}
      />

      {/* stream of minted tiles firing out of the chute */}
      {[0, 1, 2, 3, 4].map((i) => {
        const delay = reduce ? 0 : (i / 5) * CYCLE;
        const angle = -18 - i * 6;
        const dist = 70 + i * 6;
        const dx = Math.cos((angle * Math.PI) / 180) * dist;
        const dy = Math.sin((angle * Math.PI) / 180) * dist;
        return (
          <motion.rect
            key={i}
            x={-4}
            y={-4}
            width={8}
            height={8}
            rx={2}
            fill="white"
            stroke="#1a1a1a"
            strokeWidth="1.6"
            initial={{ x: 306, y: 114, opacity: 0 }}
            animate={
              reduce
                ? undefined
                : {
                    x: [306, 306 + dx],
                    y: [114, 114 + dy],
                    opacity: [0, 1, 1, 0],
                    rotate: [0, 140],
                  }
            }
            transition={loop({ duration: CYCLE * 0.7, delay, times: [0, 0.15, 0.7, 1] })}
          />
        );
      })}

      {/* latency arrow + label */}
      <motion.g
        animate={reduce ? undefined : { x: [0, 6, 0] }}
        transition={loop({ duration: CYCLE, ease: 'easeInOut' })}
      >
        <path d="M300 168 L336 168" stroke="#F59E0B" strokeWidth="2.4" strokeLinecap="round" markerEnd="url(#arrowhead-gold)" />
        <defs>
          <marker id="arrowhead-gold" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#F59E0B" />
          </marker>
        </defs>
      </motion.g>
      <text x="344" y="172" fontSize="11" fontWeight="700" fill="#1a1a1a" fontFamily="ui-monospace, monospace">
        &lt; 50 ms
      </text>

      {/* fixed lever mounted on the machine — robot's arm pumps this */}
      <rect x="186" y="100" width="6" height="50" rx="3" fill="#1a1a1a" />
      <circle cx="189" cy="98" r="5.5" fill="white" stroke="#1a1a1a" strokeWidth="2" />

      {/* ── Xiaohei operator (bean creature) pumping the lever ── */}
      <motion.g
        animate={reduce ? undefined : { y: [0, -3, 0] }}
        transition={loop({ duration: CYCLE, ease: 'easeInOut' })}
      >
        {/* body */}
        <ellipse cx="120" cy="132" rx="26" ry="27" fill="#1a1a1a" />
        {/* legs */}
        <rect x="106" y="154" width="6" height="18" rx="3" fill="#1a1a1a" />
        <rect x="128" y="154" width="6" height="18" rx="3" fill="#1a1a1a" />
        {/* eyes */}
        <ellipse cx="110" cy="128" rx="3.6" ry="5.2" fill="white" />
        <ellipse cx="130" cy="128" rx="3.6" ry="5.2" fill="white" />

        {/* pumping arm, pivoting at the shoulder to reach the fixed lever */}
        <motion.g
          style={{ transformOrigin: '140px 140px' }}
          animate={reduce ? undefined : { rotate: [18, -22, 18] }}
          transition={loop({ duration: CYCLE, times: [0, 0.45, 1] })}
        >
          <rect x="138" y="137" width="34" height="7" rx="3.5" fill="#1a1a1a" />
          <circle cx="174" cy="140.5" r="5" fill="#1a1a1a" />
        </motion.g>
      </motion.g>

      {/* labels */}
      <motion.text
        x="120"
        y="196"
        textAnchor="middle"
        fontSize="12"
        fontWeight="800"
        fill="#EF4444"
        fontFamily="ui-monospace, monospace"
        animate={reduce ? undefined : { opacity: [0.55, 1, 0.55] }}
        transition={loop({ duration: CYCLE, ease: 'easeInOut' })}
      >
        auto-fire
      </motion.text>
      <text x="248" y="196" textAnchor="middle" fontSize="13" fontWeight="800" fill="#1a1a1a" letterSpacing="0.5">
        MINT MACHINE
      </text>
    </svg>
  );
}

/** Simple cog/gear shape used for the two spinning gears inside the machine box. */
function Gear({ cx, cy, r, teeth }: { cx: number; cy: number; r: number; teeth: number }) {
  const toothPaths = Array.from({ length: teeth }, (_, i) => {
    const angle = (i / teeth) * 360;
    return (
      <rect
        key={i}
        x={cx - 1.6}
        y={cy - r - 3.2}
        width={3.2}
        height={5}
        rx={0.8}
        fill="#1a1a1a"
        transform={`rotate(${angle} ${cx} ${cy})`}
      />
    );
  });
  return (
    <g>
      {toothPaths}
      <circle cx={cx} cy={cy} r={r} fill="white" stroke="#1a1a1a" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={r * 0.32} fill="#1a1a1a" />
    </g>
  );
}
