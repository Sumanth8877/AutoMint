'use client';

/**
 * WorkflowIllustration — Animated Xiaohei-style explainer for the AutoMint flow.
 * ─────────────────────────────────────────────────────────────────────────
 * Built in the "小黑 / Xiaohei" hand-drawn style (see ian-xiaohei-illustrations
 * style DNA): pure white background, thin wobbly black line-art, generous
 * whitespace, sparse red / orange / blue notes, and Xiaohei as the active
 * subject — not decoration.
 *
 * Story: Xiaohei shoves one mint into the pipe (set it once). The orange token
 * then auto-flows through four stations —
 *   vault (import) → analyze → queue → auto-fire —
 * and lands as a confirmed mint in under 50 ms.
 *
 * A subtle displacement filter gives the line-art an organic hand-drawn wobble.
 * Respects prefers-reduced-motion (freezes to a clean static frame).
 */

import { motion, useReducedMotion } from '@/components/motion';
import type { Transition } from 'framer-motion';

const CYCLE = 5; // seconds for one mint to travel the pipe
const INK = '#1a1a1a';
const FLOW = '#F59E0B'; // orange — flow / path / the mint token
const NOTE = '#4F46E5'; // blue — supplementary labels
const HOT = '#EF4444'; // red — result / confirmation

// x-centres of the four stations along the pipe
const S1 = 150;
const S2 = 245;
const S3 = 340;
const S4 = 428;
const BASE_Y = 130;

export function WorkflowIllustration({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  const loop = (transition: Transition): Transition =>
    reduce ? { duration: 0 } : { repeat: Infinity, ease: 'easeInOut', ...transition };

  return (
    <svg
      viewBox="0 50 480 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Hand-drawn diagram: a small character sends one mint through a pipe that imports the wallet, analyzes the contract, queues the strategy, and auto-fires it — confirmed in under 50 milliseconds."
    >
      <rect x="0" y="40" width="480" height="180" fill="white" />

      <defs>
        {/* organic hand-drawn wobble for the line-art */}
        <filter id="wf-wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <marker id="wf-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill={FLOW} />
        </marker>
      </defs>

      {/* ═══ hand-drawn line-art (wobble-filtered) ═══ */}
      <g filter="url(#wf-wobble)" stroke={INK} strokeLinecap="round" strokeLinejoin="round">
        {/* the pipe / baseline */}
        <path d={`M96 ${BASE_Y} L452 ${BASE_Y}`} strokeWidth="2" fill="none" />

        {/* Station 1 — vault (import the signing wallet) */}
        <g fill="white" strokeWidth="1.9">
          <rect x={S1 - 20} y={92} width={40} height={38} rx={4} />
          <circle cx={S1} cy={111} r={7} />
          <path d={`M${S1} 111 L${S1 + 5} 116`} strokeWidth="1.6" />
          <path d={`M${S1 - 20} 122 L${S1 + 20} 122`} strokeWidth="1.2" opacity="0.4" />
          {/* key sliding into the vault */}
          <g fill="none">
            <circle cx={S1 - 34} cy={107} r={3.2} strokeWidth="1.6" />
            <path d={`M${S1 - 31} 107 L${S1 - 22} 107 M${S1 - 25} 107 L${S1 - 25} 110 M${S1 - 21} 107 L${S1 - 21} 110`} strokeWidth="1.6" />
          </g>
        </g>

        {/* Station 2 — analyze (paste, risk-check the contract) */}
        <g fill="white" strokeWidth="1.9">
          <rect x={S2 - 18} y={90} width={30} height={38} rx={3} />
          <g strokeWidth="1.2" opacity="0.55">
            <path d={`M${S2 - 12} 99 L${S2 + 6} 99`} />
            <path d={`M${S2 - 12} 106 L${S2 + 6} 106`} />
            <path d={`M${S2 - 12} 113 L${S2 - 2} 113`} />
          </g>
          {/* magnifier */}
          <circle cx={S2 + 8} cy={116} r={9} strokeWidth="2" />
          <path d={`M${S2 + 15} 123 L${S2 + 21} 129`} strokeWidth="2.4" />
        </g>

        {/* Station 3 — queue (task ticket + scheduled time) */}
        <g fill="white" strokeWidth="1.9">
          <rect x={S3 - 20} y={95} width={40} height={30} rx={3} />
          <circle cx={S3 - 20} cy={110} r={2.4} fill={INK} />
          <circle cx={S3 + 20} cy={110} r={2.4} fill={INK} />
          <path d={`M${S3 + 2} 100 L${S3 + 2} 120`} strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
          {/* clock */}
          <circle cx={S3 - 6} cy={110} r={7} strokeWidth="1.6" />
          <path d={`M${S3 - 6} 110 L${S3 - 6} 106 M${S3 - 6} 110 L${S3 - 2} 112`} strokeWidth="1.4" />
        </g>

        {/* Station 4 — auto-fire (the mint machine) */}
        <g fill="white" strokeWidth="1.9">
          <rect x={S4 - 18} y={94} width={36} height={34} rx={4} />
          <path d={`M${S4 - 8} 104 A6 6 0 1 1 ${S4 + 4} 104`} fill="none" strokeWidth="1.6" />
          <path d={`M${S4 + 18} 100 L${S4 + 28} 96 L${S4 + 28} 116 L${S4 + 18} 112 Z`} strokeWidth="1.7" />
        </g>
      </g>

      {/* ═══ orange flow arrows along the pipe (animated) ═══ */}
      <motion.path
        d={`M104 ${BASE_Y} L444 ${BASE_Y}`}
        stroke={FLOW}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray="2 20"
        fill="none"
        markerEnd="url(#wf-arrow)"
        animate={reduce ? undefined : { strokeDashoffset: [0, -44] }}
        transition={loop({ duration: 1.4, ease: 'linear' })}
      />

      {/* ═══ the mint token auto-flowing through the pipe ═══ */}
      <motion.g
        animate={
          reduce
            ? undefined
            : {
                x: [96, S1, S2, S3, S4, 452],
                opacity: [0, 1, 1, 1, 1, 0],
              }
        }
        transition={loop({ duration: CYCLE, times: [0, 0.16, 0.42, 0.66, 0.9, 1], ease: 'easeInOut' })}
      >
        <rect x={-6} y={BASE_Y - 6} width={12} height={12} rx={2.5} fill={FLOW} />
      </motion.g>

      {/* ═══ Xiaohei — shoves the mint into the pipe (set it once) ═══ */}
      <motion.g
        style={{ transformOrigin: '66px 128px' }}
        animate={reduce ? undefined : { x: [0, 10, 0], rotate: [0, 6, 0] }}
        transition={loop({ duration: CYCLE, times: [0, 0.12, 0.24], ease: 'easeOut' })}
      >
        {/* legs */}
        <rect x="58" y="140" width="5" height="13" rx="2.5" fill={INK} />
        <rect x="69" y="140" width="5" height="13" rx="2.5" fill={INK} />
        {/* body */}
        <ellipse cx="66" cy="126" rx="18" ry="18" fill={INK} />
        {/* pushing arm */}
        <rect x="80" y="123" width="18" height="5.5" rx="2.75" fill={INK} />
        <circle cx="98" cy="125.5" r="4.2" fill={INK} />
        {/* eyes */}
        <ellipse cx="60" cy="122" rx="2.6" ry="3.7" fill="white" />
        <ellipse cx="72" cy="122" rx="2.6" ry="3.7" fill="white" />
      </motion.g>

      {/* ═══ confirmed burst at the end (synced to arrival) ═══ */}
      <motion.g
        animate={reduce ? undefined : { opacity: [0, 0, 1, 1, 0], scale: [0.6, 0.6, 1, 1, 0.6] }}
        transition={loop({ duration: CYCLE, times: [0, 0.88, 0.93, 0.98, 1], ease: 'easeOut' })}
        style={{ transformOrigin: '452px 110px' }}
      >
        <path d="M446 110 L450 115 L459 104" stroke={HOT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </motion.g>
      {[0, 1, 2].map((i) => {
        const ang = -30 - i * 22;
        const dx = Math.cos((ang * Math.PI) / 180) * 20;
        const dy = Math.sin((ang * Math.PI) / 180) * 20;
        return (
          <motion.rect
            key={i}
            x={450}
            y={BASE_Y - 3}
            width={5}
            height={5}
            rx={1.2}
            fill={FLOW}
            animate={reduce ? undefined : { x: [450, 450 + dx], y: [BASE_Y - 3, BASE_Y - 3 + dy], opacity: [0, 1, 0] }}
            transition={loop({ duration: CYCLE, times: [0, 0.9, 0.98], delay: i * 0.04 })}
          />
        );
      })}

      {/* ═══ sparse handwritten-style notes ═══ */}
      <g fontFamily="ui-sans-serif, system-ui" fontStyle="italic">
        <text x={S1} y={150} textAnchor="middle" fontSize="10" fontWeight="600" fill={NOTE}>import</text>
        <text x={S2} y={150} textAnchor="middle" fontSize="10" fontWeight="600" fill={NOTE}>analyze</text>
        <text x={S3} y={150} textAnchor="middle" fontSize="10" fontWeight="600" fill={NOTE}>queue</text>
        <text x={S4} y={150} textAnchor="middle" fontSize="10" fontWeight="700" fill={HOT}>fire</text>
      </g>
      <text x="66" y="166" textAnchor="middle" fontSize="9" fontStyle="italic" fill={INK} opacity="0.65" fontFamily="ui-sans-serif, system-ui">
        set it once
      </text>
      <motion.text
        x="452"
        y="168"
        textAnchor="end"
        fontSize="10.5"
        fontWeight="700"
        fill={HOT}
        fontFamily="ui-monospace, monospace"
        animate={reduce ? undefined : { opacity: [0.5, 1, 0.5] }}
        transition={loop({ duration: 2, ease: 'easeInOut' })}
      >
        confirmed &lt; 50 ms
      </motion.text>
    </svg>
  );
}
