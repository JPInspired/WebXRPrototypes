// The places of the lesson, in ENGAGE's metres (x right, z forward = north), worked out from where the original
// lesson put its objects. The walls and houses grow along the edges of these areas (Town.js), so every object keeps
// its place. [x0, x1, z0, z1, ground]

export const AREAS = [
  [-4.5, 9, 21, 113, 'road'], // the street north
  [-9, 8.1, -98, -13, 'road'], // the street south
  [-60, 34, -14, 9.1, 'gravel'], // the square and the way west: the bad tourist, the quiz, the whiteboard
  [-22.7, 34, 9, 21.8, 'gravel'], // before the church: the damage
  [-42, -8.9, -24, -13.9, 'gravel'], // the playground
  [-19.6, -9, -29.6, -14, 'gravel'], // the knowledge check
  [-26, -9, -36, -29, 'gravel'],
  [8.9, 15, 21, 27, 'gravel'],
  [8.9, 29, 48, 69, 'paving'], // the crowded yard
  [-16, 54, 113, 134, 'park'],
  [8, 15, -98, -94.4, 'paving'],
];

// Lawns on the ground (only to look at: you can walk on them)
export const LAWNS = [
  [-60, -22.8, 5.6, 9], [-22.6, -10, 9, 21.7], [-10, -4.6, 14, 21.7], [-60, -20, -13.9, -7], [-41.9, -20, -23.9, -14], [15, 33.9, 12.5, 21.7],
];

export const START = { at: [-23.5, -1.5], look: [-10.7, -0.4] };

// Where the menu can take you: [name, stand at, look at]
export const PLACES = [
  ['Start', [-23.5, -1.5], [-10.7, -0.4]],
  ['1. Bad Tourist', [-33.6, -3.2], [-33.6, 1]],
  ['2. Damage', [-18.4, 13.6], [-19.6, 20]],
  ['3. Traffic', [1.2, 63.4], [4.5, 63.4]],
  ['4. Mass Tourism', [-1.3, -21.6], [-1.3, -18.4]],
  ['Knowledge Check', [-16.8, -25.4], [-16.8, -29]],
  ['Whiteboard', [27.9, -1.2], [30.9, -0.2]],
  ['Baskets', [25.2, 5.6], [30, 5.6]],
  ['Quiz', [-39.6, -2], [-39.6, 1.6]],
  ['Square', [-6, -7], [0, 0]],
  ['Park', [14, 114.5], [22, 124]],
];

// The whiteboard activity (the 'tourism' picture on the whiteboard was on ENGAGE's servers). The Spanish is from
// the snapshot "SpanishTourismQuizShared"; the English was written again for this version: please check it. Two
// more cards had names cut short and are left out: "Un vecino se queja de que su ciudad…" and "Un país está
// sufriendo problemas…".
export const PHRASES = [
  { es: 'Impulsar la economía local y generar empleo', en: 'To boost the local economy and create jobs', benefit: true },
  { es: 'El turismo puede hacer una contribución significativa en la reducción de la pobreza en un país', en: 'Tourism can make a significant contribution to reducing poverty in a country', benefit: true },
  { es: 'El turismo aporta capital extranjero que beneficia a toda la economía local', en: 'Tourism brings in foreign money that benefits the whole local economy', benefit: true },
  { es: 'Cada vez más casas se están convirtiendo en alquileres de temporada', en: 'More and more homes are being turned into seasonal rentals', benefit: false },
  { es: 'Alquilar o comprar una casa se está volviendo inaccesible para la población local', en: 'Renting or buying a home is becoming unaffordable for local people', benefit: false },
  { es: 'Recuperar regiones despobladas', en: 'To bring life back to regions that have lost their people', benefit: true },
];

// Pictures to put back: save the file in ../../pictures and write its name here, for example 'picture-1': 'rent.jpg'
export const PICTURES = {
  'effects-of-tourism': null,
  'picture-1': null,
  'picture-2': null,
  'picture-3': null,
};

// The baskets (the last activity of the lesson plan): sort the cards into four. The plan's own snapshot was not found.
// src 'recovered' means the Spanish comes from the original lesson or snapshot; 'added' was written for this version.
// Every answer here was added: please check them all.
export const BASKETS = [['nature', 'Naturaleza', 'Nature', '#4f9a52'], ['city', 'Ciudad', 'City', '#5b7fb5'], ['positive', 'Impactos positivos', 'Positive Impacts', '#d9a520'], ['negative', 'Impactos negativos', 'Negative Impacts', '#c0504d']];
export const VOCABULARY = [
  { es: 'la flora y la fauna', basket: 'nature', src: 'recovered' },
  { es: 'el bosque', basket: 'nature', src: 'added' },
  { es: 'los animales salvajes', basket: 'nature', src: 'added' },
  { es: 'la plaza', basket: 'city', src: 'added' },
  { es: 'los edificios', basket: 'city', src: 'added' },
  { es: 'el transporte público', basket: 'city', src: 'added' },
  { es: 'impulsar la economía local', basket: 'positive', src: 'recovered' },
  { es: 'generar empleo', basket: 'positive', src: 'recovered' },
  { es: 'recuperar regiones despobladas', basket: 'positive', src: 'recovered' },
  { es: 'la contaminación acústica', basket: 'negative', src: 'recovered' },
  { es: 'los embotellamientos', basket: 'negative', src: 'recovered' },
  { es: 'el turismo masivo', basket: 'negative', src: 'recovered' },
];

// The lesson plan, step by step, for the Teacher menu: [name, what everyone's card says, stage of the clock, where to stand]
export const PLAN = [
  ['Starter: Vocabulary', 'Vocabulary Recall', 'Brainstorm Spanish words for tourism, nature and cities. Then predict: what good and bad effects might tourism have on a place?', 0, 'Start'],
  ['Main 1: Explore', 'Explore the City', 'Move through the city and press the Effects of Tourism buttons. Each one shows a different example of the impact of tourism.', 0, 'Start'],
  ['Main 2: Match', 'Match the Expressions', 'Take each letter to the Spanish that means the same. Every correct match earns a star.', 4501, 'Knowledge Check'],
  ['Main 3: Baskets', 'Sort the Vocabulary', 'In pairs, put each card in its basket: nature, city, positive impacts or negative impacts.', null, 'Baskets'],
  ['Plenary: Share', 'Share What You Saw', 'Tell the class one positive and one negative impact of tourism that you saw.', null, 'Square'],
  ['Plenary: Speak', 'Speak', '¿Crees que el turismo es más beneficioso o más perjudicial? ¿Por qué?', null, 'Square'],
];
