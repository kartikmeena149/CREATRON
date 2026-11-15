// The video player every layer uses. It takes the same props as Remotion's <OffthreadVideo>, but
// decodes inside the page (WebCodecs, the Mac's video hardware) instead of sending every frame
// through one shared decoder process: renders run several times faster. A file it can't read
// falls back to <OffthreadVideo> on its own. objectFit is read from style, as with a <video>.
import React from "react";
import { Video as MediaVideo } from "@remotion/media";

type Props = Omit<React.ComponentProps<typeof MediaVideo>, "objectFit"> & {
  /** Keep the see-through parts (a cut-out speaker): used by the fallback player. */
  transparent?: boolean;
};

export const Video: React.FC<Props> = ({ style, transparent, ...rest }) => {
  const { objectFit, ...css } = style ?? {};
  return (
    <MediaVideo
      {...rest}
      style={css}
      objectFit={(objectFit as "fill" | "contain" | "cover" | "none" | "scale-down" | undefined) ?? "fill"}
      fallbackOffthreadVideoProps={{ transparent }}
    />
  );
};
