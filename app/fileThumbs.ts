// The frame strip of a video on an upper track, for its clips' filmstrip: made once per file by
// the main process, asked for once per file here.
import { useEffect, useState } from "react";
import type { Thumbs } from "./store.ts";

const strips = new Map<string, Promise<Thumbs | undefined>>();

/** The file's frame strip once it's ready (undefined until then, or when it can't be made). */
export function useFileThumbs(path: string | undefined): Thumbs | undefined {
  const [thumbs, setThumbs] = useState<Thumbs>();
  useEffect(() => {
    if (!path) return;
    let gone = false;
    let p = strips.get(path);
    if (!p) {
      p = window.creatron.fileThumbs(path).then((r) => (r.ok ? r.value : undefined));
      strips.set(path, p);
    }
    p.then((t) => !gone && setThumbs(t));
    return () => void (gone = true);
  }, [path]);
  return thumbs;
}
