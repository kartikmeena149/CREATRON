// A line from a creator to get you going: on the welcome screen and in the empty chat. One at a
// time, starting at random and fading to the next every few seconds.
import { useEffect, useState } from "react";

const QUOTES: [quote: string, who: string][] = [
  ["Do what you can't.", "Casey Neistat"],
  ["The most important thing you can do is do a lot of work.", "Ira Glass"],
  ["Document, don't create.", "Gary Vaynerchuk"],
  ["Real artists ship.", "Steve Jobs"],
  ["The best camera is the one that's with you.", "Chase Jarvis"],
  ["Inspiration exists, but it has to find you working.", "Pablo Picasso"],
  ["You can't use up creativity. The more you use, the more you have.", "Maya Angelou"],
  ["Show your work.", "Austin Kleon"],
];

export function CreatorQuote({ every = 8000 }: { every?: number }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setShown(false);
      setTimeout(() => (setI((n) => (n + 1) % QUOTES.length), setShown(true)), 400);
    }, every);
    return () => clearInterval(t);
  }, [every]);
  const [quote, who] = QUOTES[i];
  return (
    <figure className={`quote ${shown ? "" : "out"}`}>
      <blockquote>“{quote}”</blockquote>
      <figcaption>{who}</figcaption>
    </figure>
  );
}
