// The Storyboard Creator's mark: four storyboard panels in white pencil, each with a tiny sketch
// (a person, a horizon, halftone dots, a zoom frame), and Creatro's red pencil arrow sweeping across
// them: on a storyboard, red is movement. Animated, the panels draw in one by one and then the arrow
// does, in a slow loop; still, it is the same drawing, replayed on hover.
export function StoryboardMark({ size = 40, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <svg
      className={`sbm ${animated ? "sbm-live" : ""} ${className}`}
      width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden
      strokeLinecap="round" strokeLinejoin="round"
    >
      {/* The four panels. */}
      <g className="sbm-panels" stroke="currentColor" strokeWidth="1.4">
        <rect className="sbm-p p1" x="4.5" y="7" width="14" height="11" rx="1.8" />
        <rect className="sbm-p p2" x="21.5" y="7" width="14" height="11" rx="1.8" />
        <rect className="sbm-p p3" x="4.5" y="22" width="14" height="11" rx="1.8" />
        <rect className="sbm-p p4" x="21.5" y="22" width="14" height="11" rx="1.8" />
      </g>
      {/* What's drawn in them. */}
      <g className="sbm-sketch" stroke="currentColor" strokeWidth="1.05">
        {/* 1: a person, chest up */}
        <g className="s1">
          <circle cx="11.5" cy="11.6" r="1.9" />
          <path d="M7.6 18 C8.2 15.4 9.6 14.6 11.5 14.6 C13.4 14.6 14.8 15.4 15.4 18" />
        </g>
        {/* 2: a horizon and a sun */}
        <g className="s2">
          <circle cx="31.4" cy="10.6" r="1.2" />
          <path d="M22.4 15.4 C24.6 13.4 26.4 13.6 28.2 15 C30 16.4 32.2 16 34.6 14.4" />
        </g>
        {/* 3: halftone dots, the footage traced */}
        <g className="s3" fill="currentColor" stroke="none">
          <circle cx="8.2" cy="26" r="0.75" /><circle cx="11.5" cy="26" r="1.05" /><circle cx="14.8" cy="26" r="0.75" />
          <circle cx="9.85" cy="29.2" r="1.05" /><circle cx="13.15" cy="29.2" r="1.05" />
        </g>
      </g>
      {/* 4: the frame a zoom ends on, in red */}
      <rect className="sbm-zoom" x="24.6" y="24.8" width="7.8" height="5.4" rx="0.8" stroke="var(--accent, #e5231b)" strokeWidth="1.05" strokeDasharray="1.6 1.3" />
      {/* The red pencil: movement, from the first panel to the last. */}
      <path className="sbm-arrow" d="M12.6 16.4 C18.6 19.6 22.6 16.2 26.4 20.6 C28.2 22.6 28.4 24.6 28.4 27" stroke="var(--accent, #e5231b)" strokeWidth="1.9" />
      <path className="sbm-head" d="M25.9 24.9 L28.4 27.4 L30.9 24.9" stroke="var(--accent, #e5231b)" strokeWidth="1.9" />
    </svg>
  );
}
