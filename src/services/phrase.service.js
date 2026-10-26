const PHRASES = [
  "La oscuridad ya conoce tu nombre.",
  "Esta noche, las sombras te han elegido.",
  "No mires detrás de ti.",
  "Tu destino acaba de despertar.",
  "Alguien susurra tu nombre en la oscuridad.",
  "La sangre recuerda lo que los vivos olvidan.",
  "Has cruzado una puerta que no debías abrir.",
  "Esta historia apenas acaba de comenzar.",
  "El silencio sabe algo que tú ignoras.",
  "No todas las almas encuentran el camino de regreso."
];

function selectPhrase(previousPhrase) {
  const candidates = PHRASES.filter(p => p !== previousPhrase);
  const phrasePool = candidates.length ? candidates : PHRASES;
  const phrase = phrasePool[Math.floor(Math.random() * phrasePool.length)];
  return phrase;
}

function getPhrases() {
  return PHRASES.slice();
}

module.exports = {
  selectPhrase,
  getPhrases,
  PHRASES
};
