// Vite hands an SVG file over as text when it's imported with ?raw (app/logos.tsx).
declare module "*.svg?raw" {
  const text: string;
  export default text;
}
