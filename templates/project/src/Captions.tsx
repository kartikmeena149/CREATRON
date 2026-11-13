// Captions: live text from timeline.json, one page at a time. Restyle here; change words and
// times in timeline.json.
import React from "react";
import { useCurrentFrame } from "remotion";
import { captionStyle, captions, colors, fps } from "./creatron/timeline";

export const Captions: React.FC = () => {
  const t = useCurrentFrame() / fps;
  const page = captions.find((c) => t >= c.start && t < c.end);
  if (!page) return null;
  const words = (captionStyle.uppercase ? page.text.toUpperCase() : page.text).split(" ");
  const accent = page.accent ? (captionStyle.uppercase ? page.accent.toUpperCase() : page.accent) : undefined;
  return (
    <div
      style={{
        position: "absolute", left: "8%", width: "84%", bottom: captionStyle.bottom, textAlign: "center",
        fontFamily: captionStyle.font, fontWeight: 800, fontSize: captionStyle.size, lineHeight: 1.1,
        color: colors.caption, WebkitTextStroke: `${captionStyle.outline}px ${colors.captionOutline}`, paintOrder: "stroke fill",
      }}
    >
      {words.map((w, i) => (
        <span key={i} style={{ color: accent && w.replace(/[^\w']/g, "") === accent.replace(/[^\w']/g, "") ? colors.accent : undefined }}>
          {w}{i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
};
