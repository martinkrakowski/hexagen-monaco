"use client";

import { motion } from "framer-motion";
import { Cpu } from "lucide-react";

interface WakingUpCardProps {
  onCancel: () => void;
}

/**
 * Shown when the model is auto-loading from IndexedDB cache on mount.
 * An animated conic-gradient border pulses around the card to signal
 * background activity without a noisy download progress bar.
 */
export function WakingUpCard({ onCancel }: WakingUpCardProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      {/* Animated border wrapper */}
      <div className="relative rounded-xl p-[2px] w-full max-w-[280px]">
        {/* Rotating conic-gradient border layer */}
        <motion.div
          className="absolute inset-0 rounded-xl"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 60%, hsl(var(--primary) / 0.8) 80%, transparent 100%)",
          }}
          animate={{ rotate: 360 }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear",
          }}
        />
        {/* Soft glow layer */}
        <motion.div
          className="absolute inset-0 rounded-xl blur-sm"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 60%, hsl(var(--primary) / 0.4) 80%, transparent 100%)",
          }}
          animate={{ rotate: 360 }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear",
          }}
        />
        {/* Card content */}
        <div className="relative rounded-[10px] bg-card px-5 py-6 flex flex-col items-center gap-4">
          {/* Pulsing icon */}
          <motion.div
            className="flex items-center justify-center w-11 h-11 rounded-full bg-primary/10"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Cpu className="h-5 w-5 text-primary" />
          </motion.div>

          {/* Text */}
          <div className="text-center space-y-1.5">
            <p className="text-sm font-semibold text-foreground">
              Waking up Local AI
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Resuming from browser cache&hellip;
            </p>
          </div>

          {/* Indeterminate dots */}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="block w-1.5 h-1.5 rounded-full bg-primary/60"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.2,
                }}
              />
            ))}
          </div>

          {/* Cancel */}
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground underline hover:no-underline transition-colors mt-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
