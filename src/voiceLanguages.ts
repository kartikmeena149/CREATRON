// The Voice Lab's languages, shared by the engine (src/voice.ts) and the page. No Node or browser APIs.

/**
 * The languages Pocket TTS speaks, each its own model (downloaded the first time it's used), with
 * the built-in voice that's native to it and the line a voice preview says in it. Any voice,
 * cloned ones too, can speak any of them.
 */
export const VOICE_LANGUAGES = [
  { id: "english", name: "English", native: "alba", sample: "Hi! This is how I sound. Let's make something people love to watch." },
  { id: "french", name: "French", native: "estelle", sample: "Bonjour ! Voici ma voix. Créons quelque chose que les gens adorent regarder." },
  { id: "german", name: "German", native: "juergen", sample: "Hallo! So klinge ich. Lass uns etwas machen, das die Leute gern ansehen." },
  { id: "spanish", name: "Spanish", native: "lola", sample: "¡Hola! Así suena mi voz. Hagamos algo que a la gente le encante ver." },
  { id: "italian", name: "Italian", native: "giovanni", sample: "Ciao! Ecco come suono. Creiamo qualcosa che la gente ami guardare." },
  { id: "portuguese", name: "Portuguese", native: "rafael", sample: "Olá! É assim que eu soo. Vamos criar algo que as pessoas adorem assistir." },
  { id: "dutch", name: "Dutch", native: "daan", sample: "Hoi! Zo klink ik. Laten we iets maken waar mensen graag naar kijken." },
] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]["id"];
