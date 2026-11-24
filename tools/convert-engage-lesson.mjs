// Turns one of Inspired's own ENGAGE lessons (.engage, unzipped) into the data a WebXR VR lesson plays.
//   node tools/convert-engage-lesson.mjs <folder with script.bin> <output .js>
// Positions stay in ENGAGE's metres (x right, y up, z forward); src/main.js turns z round for three.js.
// Server ids are left out: the files behind them are not part of this project.
import fs from 'node:fs';

const [, , dir, out] = process.argv;
const j = JSON.parse(fs.readFileSync(`${dir}/script.bin`, 'utf8').replace(/^\uFEFF/, ''));
const n = (v) => +(+v).toFixed(3);
const KINDS = [
  [/^IFXTrigger_UI2_.*_W_P|^IFXTrigger_UI2_TextButton_W/, 'button-white'], [/^IFXTrigger_UI2/, 'button-blue'], [/^AutoFit_Text_Panel/, 'text'],
  [/^LessonControl_SkipToTime/, 'skip'], [/^Quiz_/, 'quiz'], [/^UserFileManagerDownload_Image/, 'picture'], [/^UserFileManagerDownload_Audio/, 'crowd-noise'],
  [/^Audio-CityScape/, 'city-noise'], [/^Skybox-Eerie/, 'eerie-sky'], [/^InvisibleCollider/, 'collider'], [/^InteractiveObjectTrigger/, 'letter-trigger'],
  [/Christmas_Star/, 'star'], [/Whiteboard2_IFX_Blackboard/, 'blackboard'], [/Whiteboard2_IFX_Whiteboard/, 'whiteboard'], [/Wicker_Basket/, 'basket'],
  [/Small_Forest/, 'forest'], [/Rabbit/, 'rabbit'], [/Stag/, 'stag'], [/Fox/, 'fox'], [/Wolf/, 'wolf'], [/bush/, 'bush'], [/sidewalk/, 'pavement'],
  [/Cybertruck/, 'truck'], [/PickupTruck/, 'pickup'], [/Male_Workout/, 'man'], [/string-ball/, 'ball'],
];
// uploaded models are known only by the names the teachers gave them
const UPLOADS = [
  [/^Capital Letter - ([A-D])/, 'letter'], [/tower_of_london/, 'tower-model'], [/^trash/, 'trash'], [/^Graffiti$/, 'graffiti'], [/graffiti/, 'graffiti-tall'],
  [/fiat_500l/, 'car-white'], [/fiat_punto/, 'car-red'], [/tourist_bus/, 'coach'], [/rp_posed/, 'woman'], [/just_people/, 'people'], [/vending/, 'vending'],
  [/restaurant_street/, 'restaurant'], [/man_sitting/, 'man-sitting'], [/photographer/, 'photographer'], [/^garbage_bin/, 'bin'], [/garbage_bags/, 'bags'],
  [/street_garbage/, 'bin-full'], [/turistar/, 'signpost'], [/deer/, 'deer'], [/squirrel/, 'squirrel'], [/^plaza$/, 'plaza'],
];
// spelling, corrected from the original
const FIX = [['faulys', 'faults'], ['visitng', 'visiting'], ['superdesarollo', 'superdesarrollo'], ['Effects of Turism', 'Effects of Tourism'], ['Quizz', 'Quiz'], ['contaminador ', 'contaminador']];
const fix = (t) => FIX.reduce((s, [a, b]) => s.replaceAll(a, b), t).trim();

const unknown = [];
const effects = j.Effects.map((e) => {
  const own = e.CustomName || e.PrettyName || '';
  const hit = KINDS.find(([re]) => re.test(e.Name)) ?? UPLOADS.find(([re]) => re.test(own));
  if (!hit) unknown.push(`${e.Id} ${e.Name} ${own}`);
  const k = e.MasterKeyFrame;
  const o = { id: e.Id, kind: hit?.[1] ?? 'unknown', start: n(e.StartTime), end: n(e.EndTime), p: [n(k.position.x), n(k.position.y), n(k.position.z)], e: [n(k.euler.x), n(k.euler.y), n(k.euler.z)], s: n(k.scale.x) };
  if (e.StartType === 1) { o.after = e.LinkedId; o.start = null; } // appears only when that trigger fires, for `end` seconds
  const opt = Object.assign({}, ...(e.EffectOptions ?? []));
  const all = (key) => (e.EffectOptions ?? []).flatMap((x) => x[key] ?? []);
  void opt;
  const text = all('ui_text')[0]?.text;
  if (text) o.text = fix(text);
  const skip = all('float_value')[0]?.value;
  if (o.kind === 'skip') o.to = skip;
  if (o.kind === 'letter') o.letter = own.slice(-1);
  if (o.kind === 'letter-trigger') { o.letter = text.slice(-1); delete o.text; }
  if (o.kind === 'picture') o.name = /^Screenshot/.test(own) ? `picture-${{ '09.03': 1, '08.53': 2, '09.09': 3 }[own.match(/at (\d\d\.\d\d)/)[1]]}` : own.toLowerCase().replaceAll(' ', '-');
  return o;
}).sort((a, b) => a.id - b.id);
fs.writeFileSync(out, `// Made by tools/convert-engage-lesson.mjs from Inspired's own ENGAGE lesson. Do not edit by hand.\n// Positions and angles as in the original; spelling corrected.\nexport const EFFECTS = [\n${effects.map((e) => `  ${JSON.stringify(e)},`).join('\n')}\n];\n`);
console.log(effects.length, 'effects;', unknown.length ? `unknown: ${unknown.join('; ')}` : 'all recognised');
