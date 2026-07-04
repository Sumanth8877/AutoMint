'use client';

/**
 * MintMachineIllustration — Animated recreation of the hero "mint machine" doodle.
 * ─────────────────────────────────────────────────────────────────────────
 * Same composition as illustrations/hero-mint-machine.jpeg (NFT → funnel →
 * gear box → chute → stream of minted NFTs), but built as inline SVG so the
 * parts can actually move:
 *   - Xiaohei (the bean operator) grips a pump lever and pulls it
 *   - Two cogs inside the box spin in opposite directions
 *   - An NFT tile drops through the funnel on each "auto-fire" cycle
 *   - A colorful stream of tiles fires out of the chute, matching the cycle
 *   - The "< 50 ms" arrow pulses to sell the speed
 *
 * Respects prefers-reduced-motion — everything freezes to a clean static
 * frame instead of looping.
 */

import { motion, useReducedMotion } from '@/components/motion';
import type { Transition } from 'framer-motion';

const CYCLE = 1.8; // seconds per auto-fire cycle
const INK = '#1a1a1a';
const CONFETTI = ['#4F46E5', '#F59E0B', '#10B981', '#1a1a1a'];

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
      <rect x="0" y="0" width="400" height="225" fill="white" />

      {/* ── grounding shadows ── */}
      <ellipse cx="120" cy="178" rx="30" ry="5" fill={INK} opacity="0.08" />
      <ellipse cx="248" cy="172" rx="58" ry="5" fill={INK} opacity="0.07" />

      {/* ── incoming NFT tile dropping into the funnel ── */}
      <motion.g
        animate={reduce ? undefined : { y: [-18, 22, 22], opacity: [1, 1, 0] }}
        transition={loop({ duration: CYCLE, times: [0, 0.55, 0.62], repeatDelay: CYCLE * 0.15 })}
      >
        <rect x="223" y="18" width="26" height="26" rx="5" fill="#EEF2FF" stroke={INK} strokeWidth="2" />
        <text x="236" y="35" textAnchor="middle" fontSize="9" fontWeight="700" fill={INK} fontFamily="ui-monospace, monospace">
          NFT
        </text>
      </motion.g>
      <path d="M236 46 L236 58" stroke={INK} strokeWidth="2" strokeLinecap="round" markerEnd="url(#arrowhead)" />
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={INK} />
        </marker>
        <marker id="arrowhead-gold" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#F59E0B" />
        </marker>
      </defs>

      {/* ── funnel ── */}
      <path
        d="M203 60 L269 60 L249 93 L223 93 Z"
        fill="#F8FAFC"
        stroke={INK}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <text x="236" y="77" textAnchor="middle" fontSize="10" fontWeight="600" fill={INK} fontFamily="ui-monospace, monospace">
        contract
      </text>
      <text x="308" y="55" textAnchor="middle" fontSize="10.5" fontStyle="italic" fontWeight="700" fill="#4F46E5">
        any chain
      </text>

      {/* ── machine box ── */}
      <rect x="196" y="93" width="106" height="74" rx="8" fill="#F8FAFC" stroke={INK} strokeWidth="2.6" />
      <rect x="203" y="100" width="92" height="60" rx="5" fill="none" stroke={INK} strokeWidth="1" opacity="0.15" />

      {/* gears — spin continuously, independent of the fire cycle */}
      <motion.g
        style={{ transformOrigin: '225px 122px' }}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={loop({ duration: 3.2, ease: 'linear' })}
      >
        <Gear cx={225} cy={122} r={14} teeth={9} />
      </motion.g>
      <motion.g
        style={{ transformOrigin: '253px 140px' }}
        animate={reduce ? undefined : { rotate: -360 }}
        transition={loop({ duration: 2.6, ease: 'linear' })}
      >
        <Gear cx={253} cy={140} r={11} teeth={8} />
      </motion.g>

      {/* chute flap — flicks open on each fire cycle */}
      <motion.path
        d="M302 109 L326 100 L326 131 L302 122 Z"
        fill="#F8FAFC"
        stroke={INK}
        strokeWidth="2.2"
        strokeLinejoin="round"
        style={{ transformOrigin: '302px 115.5px' }}
        animate={reduce ? undefined : { rotate: [0, 24, 0] }}
        transition={loop({ duration: CYCLE, times: [0, 0.6, 1] })}
      />

      {/* stream of minted tiles firing out of the chute, in brand colors */}
      {[0, 1, 2, 3, 4].map((i) => {
        const delay = reduce ? 0 : (i / 5) * CYCLE;
        const angle = -18 - i * 6;
        const dist = 72 + i * 7;
        const dx = Math.cos((angle * Math.PI) / 180) * dist;
        const dy = Math.sin((angle * Math.PI) / 180) * dist;
        const color = CONFETTI[i % CONFETTI.length];
        const isDiamond = i % 2 === 1;
        return (
          <motion.g
            key={i}
            initial={{ x: 308, y: 115, opacity: 0, rotate: 0 }}
            animate={
              reduce
                ? undefined
                : {
                    x: [308, 308 + dx],
                    y: [115, 115 + dy],
                    opacity: [0, 1, 1, 0],
                    rotate: [0, isDiamond ? 45 : 140],
                  }
            }
            transition={loop({ duration: CYCLE * 0.7, delay, times: [0, 0.15, 0.7, 1] })}
          >
            {isDiamond ? (
              <rect x={-4.5} y={-4.5} width={9} height={9} rx={1.5} fill={color} opacity={0.85} transform="rotate(45)" />
            ) : (
              <rect x={-4.5} y={-4.5} width={9} height={9} rx={2} fill={color} opacity={0.85} />
            )}
          </motion.g>
        );
      })}

      {/* latency arrow + label */}
      <motion.g
        animate={reduce ? undefined : { x: [0, 6, 0] }}
        transition={loop({ duration: CYCLE, ease: 'easeInOut' })}
      >
        <path d="M300 172 L336 172" stroke="#F59E0B" strokeWidth="2.6" strokeLinecap="round" markerEnd="url(#arrowhead-gold)" />
      </motion.g>
      <text x="344" y="176" fontSize="11" fontWeight="700" fill={INK} fontFamily="ui-monospace, monospace">
        &lt; 50 ms
      </text>

      {/* fixed pump lever mounted on the machine — the operator pulls this */}
      <rect x="184" y="98" width="6" height="52" rx="3" fill={INK} />
      <circle cx="187" cy="96" r="6" fill="#F8FAFC" stroke={INK} strokeWidth="2.4" />

      {/* ── Xiaohei operator (bean creature) pumping the lever ── */}
      <motion.g
        animate={reduce ? undefined : { y: [0, -3, 0] }}
        transition={loop({ duration: CYCLE, ease: 'easeInOut' })}
      >
        {/* legs, gentle idle swing */}
        <motion.g
          style={{ transformOrigin: '110px 158px' }}
          animate={reduce ? undefined : { rotate: [0, 5, 0] }}
          transition={loop({ duration: 2.1, ease: 'easeInOut' })}
        >
          <rect x="107" y="158" width="6" height="16" rx="3" fill={INK} />
          <ellipse cx="110" cy="176" rx="4.6" ry="2.4" fill={INK} />
        </motion.g>
        <motion.g
          style={{ transformOrigin: '132px 158px' }}
          animate={reduce ? undefined : { rotate: [0, -5, 0] }}
          transition={loop({ duration: 2.1, ease: 'easeInOut', delay: 0.25 })}
        >
          <rect x="129" y="158" width="6" height="16" rx="3" fill={INK} />
          <ellipse cx="132" cy="176" rx="4.6" ry="2.4" fill={INK} />
        </motion.g>

        {/* body — soft bean shape */}
        <ellipse cx="120" cy="134" rx="28" ry="27" fill={INK} />

        {/* pumping arm, pivoting at the shoulder to grip the lever */}
        <motion.g
          style={{ transformOrigin: '138px 138px' }}
          animate={reduce ? undefined : { rotate: [16, -20, 16] }}
          transition={loop({ duration: CYCLE, times: [0, 0.45, 1] })}
        >
          <rect x="136" y="135" width="36" height="7" rx="3.5" fill={INK} />
          {/* gripping hand */}
          <ellipse cx="176" cy="138.5" rx="6.5" ry="5.5" fill={INK} />
          <rect x="171" y="132" width="4.5" height="9" rx="2" fill={INK} />
        </motion.g>

        {/* eyes */}
        <ellipse cx="109" cy="129" rx="3.8" ry="5.4" fill="white" />
        <ellipse cx="129" cy="129" rx="3.8" ry="5.4" fill="white" />
        {/* deadpan mouth */}
        <path d="M112 145 Q120 148 128 145" stroke="#555" strokeWidth="1" strokeLinecap="round" fill="none" />
      </motion.g>

      {/* labels */}
      <motion.text
        x="120"
        y="200"
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
      <text x="249" y="200" textAnchor="middle" fontSize="13" fontWeight="800" fill={INK} letterSpacing="0.5">
        MINT MACHINE
      </text>
    </svg>
  );
}

/** Cog/gear shape used for the two spinning gears inside the machine box. */
function Gear({ cx, cy, r, teeth }: { cx: number; cy: number; r: number; teeth: number }) {
  const toothPaths = Array.from({ length: teeth }, (_, i) => {
    const angle = (i / teeth) * 360;
    return (
      <rect
        key={i}
        x={cx - 1.8}
        y={cy - r - 3.4}
        width={3.6}
        height={5.2}
        rx={1.2}
        fill={INK}
        transform={`rotate(${angle} ${cx} ${cy})`}
      />
    );
  });
  return (
    <g>
      {toothPaths}
      <circle cx={cx} cy={cy} r={r} fill="#F8FAFC" stroke={INK} strokeWidth="2.2" />
      <circle cx={cx} cy={cy} r={r * 0.34} fill={INK} />
    </g>
  );
}
