// A caption in the ransom-note look (src/ransom.ts), drawn with HTML: the app's preview, the
// caption presets and the Remotion layer all use it. Sizes are in em of the caption's font size.
import { GAP, GRID_COLOR, TILE, clipPath, ransomWords } from "../src/ransom.ts";

export function RansomText({ text, align = "center" }: { text: string; align?: "center" | "left" | "right" }) {
  return (
    <span
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
        columnGap: `${GAP.word}em`,
        rowGap: `${GAP.line}em`,
        lineHeight: 1,
        textTransform: "none",
      }}
    >
      {ransomWords(text).map((word, w) => (
        <span key={w} style={{ display: "inline-flex", alignItems: "center", gap: `${GAP.letter}em` }}>
          {word.map((t, i) => (
            // The shadow sits on a wrapper: clip-path would cut it off the scrap itself.
            <span key={i} style={{ display: "inline-block", filter: "drop-shadow(0 0.04em 0.05em rgba(0,0,0,0.45))", transform: `translateY(${t.lift}em) rotate(${t.rotate}deg)` }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  height: `${TILE.height}em`,
                  minWidth: `${TILE.minWidth}em`,
                  padding: `0 ${TILE.padX}em`,
                  boxSizing: "border-box",
                  fontSize: `${t.scale}em`,
                  fontFamily: `"${t.font}", Arial, sans-serif`,
                  fontWeight: t.weight,
                  fontStyle: "normal",
                  color: t.ink,
                  background: t.grid
                    ? `linear-gradient(${GRID_COLOR} 1px, transparent 1px) 0 0 / 0.25em 0.25em, linear-gradient(90deg, ${GRID_COLOR} 1px, transparent 1px) 0 0 / 0.25em 0.25em, ${t.paper}`
                    : t.paper,
                  clipPath: clipPath(t.shape),
                }}
              >
                {t.ch}
              </span>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
