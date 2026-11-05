// Loads Creatron's bundled caption fonts (src/fonts.ts) into the page: the app's preview and the
// Remotion layer both import this, so a caption in Anton is Anton everywhere.
import anton from "./fonts/Anton-Regular.ttf";
import archivoBlack from "./fonts/ArchivoBlack-Regular.ttf";
import bangers from "./fonts/Bangers-Regular.ttf";
import bebas from "./fonts/BebasNeue-Regular.ttf";
import lilita from "./fonts/LilitaOne-Regular.ttf";
import luckiest from "./fonts/LuckiestGuy-Regular.ttf";
import marker from "./fonts/PermanentMarker-Regular.ttf";
import poppinsBlack from "./fonts/Poppins-Black.ttf";
import poppinsBold from "./fonts/Poppins-Bold.ttf";
import poppinsExtraBold from "./fonts/Poppins-ExtraBold.ttf";
import poppins from "./fonts/Poppins-Regular.ttf";

const FILES: [family: string, weight: number, url: string][] = [
  ["Anton", 400, anton], ["Bebas Neue", 400, bebas], ["Archivo Black", 400, archivoBlack], ["Bangers", 400, bangers],
  ["Luckiest Guy", 400, luckiest], ["Lilita One", 400, lilita], ["Permanent Marker", 400, marker],
  ["Poppins", 400, poppins], ["Poppins", 700, poppinsBold], ["Poppins", 800, poppinsExtraBold], ["Poppins", 900, poppinsBlack],
];

let loaded: Promise<void> | undefined;

/** Adds the fonts to the page once; resolves when they're ready to draw with. */
export function loadBundledFonts(): Promise<void> {
  loaded ??= Promise.all(
    FILES.map(async ([family, weight, url]) => {
      const face = new FontFace(family, `url(${url})`, { weight: String(weight) });
      document.fonts.add(await face.load());
    }),
  ).then(() => undefined);
  return loaded;
}
