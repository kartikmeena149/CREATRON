// Fonts that ship with Creatron (free Google Fonts, in motion/fonts, SIL Open Font License or
// Apache 2.0), so captions look the same in the preview, the animated layer and the export on any
// Mac. The app and Remotion load the files (motion/fonts.ts); the export registers them from
// motion/fonts by path. No Node or browser APIs here: both sides import this list.

export const BUNDLED_FONTS = [
  { family: "Anton", weight: 400, file: "Anton-Regular.ttf" },
  { family: "Bebas Neue", weight: 400, file: "BebasNeue-Regular.ttf" },
  { family: "Archivo Black", weight: 400, file: "ArchivoBlack-Regular.ttf" },
  { family: "Bangers", weight: 400, file: "Bangers-Regular.ttf" },
  { family: "Luckiest Guy", weight: 400, file: "LuckiestGuy-Regular.ttf" },
  { family: "Lilita One", weight: 400, file: "LilitaOne-Regular.ttf" },
  { family: "Permanent Marker", weight: 400, file: "PermanentMarker-Regular.ttf" },
  { family: "Poppins", weight: 400, file: "Poppins-Regular.ttf" },
  { family: "Poppins", weight: 700, file: "Poppins-Bold.ttf" },
  { family: "Poppins", weight: 800, file: "Poppins-ExtraBold.ttf" },
  { family: "Poppins", weight: 900, file: "Poppins-Black.ttf" },
] as const;
