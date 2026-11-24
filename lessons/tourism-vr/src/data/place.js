// The places of the lesson, in ENGAGE's metres (x right, z forward = north), worked out from where the original
// lesson put its objects. The walls and houses grow along the edges of these areas (Town.js), so every object keeps
// its place. [x0, x1, z0, z1, ground]

export const AREAS = [
  [-9, 8.1, -98, 113, 'road'], // the long street
  [-15, 16, -14, 14.5, 'plaza'],
  [-50, -15, -6, 9.1, 'paving'], // west: the bad tourist, and the quiz
  [-50, -42, -18, -6, 'paving'],
  [-19.6, -9, -29.6, -14, 'paving'], // the knowledge check
  [-26, -9, -36, -29, 'paving'],
  [-22.7, -9, 14.5, 35.6, 'paving'], // the damaged yard
  [8.1, 14, 20, 29, 'grass'],
  [16, 34, -8, 11.4, 'paving'], // match the phrases
  [8.1, 29, 48, 69, 'paving'], // the crowded yard
  [-16, 54, 113, 134, 'park'],
  [8.1, 15, -98, -94.4, 'paving'],
];

export const START = { at: [-23.5, -1.5], look: [-28.7, 4.6] };

// Where the hand menu can take you: [name, stand at, look at]
export const PLACES = [
  ['Start', [-23.5, -1.5], [-28.7, 4.6]],
  ['1. Bad Tourist', [-33.6, -3.2], [-33.6, 1]],
  ['2. Damage', [-19.6, 16.4], [-19.4, 20]],
  ['3. Traffic', [1.2, 63.4], [4.5, 63.4]],
  ['4. Mass Tourism', [-1.3, -21.6], [-1.3, -18.4]],
  ['Knowledge Check', [-16.8, -25.4], [-16.8, -29]],
  ['Match the Phrases', [27.9, -1.2], [30.9, -0.2]],
  ['Quiz', [-39.6, -2], [-39.6, 1.6]],
  ['Plaza', [-6, -7], [0, 0]],
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
