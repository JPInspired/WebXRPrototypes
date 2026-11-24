# WebXR Prototypes

Lessons being tried out before they join the WebXR Library. They run in the browser: no install and no build step.

| Lesson | Subject | Path |
| --- | --- | --- |
| **The Impact of Tourism** | Spanish (virtual reality) | [`lessons/tourism-vr/`](lessons/tourism-vr/) |

## The Impact of Tourism

Inspired's own ENGAGE lesson "Inspired - Spanish - The Impact of Tourism", rebuilt as a full-size virtual reality lesson.

### What is the same

- **All 109 objects of the original are read from its file.** Positions, directions and times are kept, with the exceptions below.
- **The clock:** pressing a button jumps the lesson to a time, and objects come and go, as in ENGAGE. The four blue buttons lead to the bad tourist, damage, traffic and mass tourism; the white buttons lead to the Knowledge Check and the quiz.
- **The words:** every English and Spanish text, with spelling corrected (below).
- **The Knowledge Check:** letters A to D are picked up and taken to their Spanish sentence, and a star appears.
- **The whiteboard activity:** phrases are taken from the basket to the board.

### What is different

- **Scenery and models are new**, all made in code. The town's shape was worked out from where the lesson's objects stood; it is not a copy of the "Inspired - French Town" scene. People, cars, animals and the rest are stand-ins at life size.
- **Pictures:** they were on ENGAGE's servers. Placeholders hang where they were. To put one back, save it in `lessons/tourism-vr/pictures/` and name it in `PICTURES` in `src/data/place.js`.
- **The whiteboard's sentences:** their picture was lost. Six of the eight Spanish phrases were recovered from the snapshot "SpanishTourismQuizShared"; the names of the other two were cut short. **The English was written again and needs a teacher's check.** In the newer of the two lesson files found, the picture appeared late; here the sentences are there from the start.
- **The quiz** ("Alojamiento y casas") was on ENGAGE's servers. In its place, the same six phrases are sorted into *ventaja* and *problema*. **The answers were added and need a teacher's check.**
- **Sounds** (crowd, city) are made in code.
- **Not carried over:** invisible barriers (the walls do that), and the recordings.
- **Moved a little:** the boards stand straight, one crowd stands clear of the text beside it, and the stars are above the letters so that they do not cover the words. The sizes of signs are estimates.
- **In a class, only the teacher's buttons work**, so the town changes for everyone at once. In ENGAGE anyone could press them.

### Spelling corrected

faulys → faults · visitng → visiting · superdesarollo → superdesarrollo · Effects of Turism → Effects of Tourism · Quizz → Quiz

### Moving and pressing

| | Headset | Screen |
| --- | --- | --- |
| Go somewhere | Point at the ground and pull the trigger, or left thumbstick | Click the ground, or W A S D |
| Turn | Right thumbstick | Drag, or the arrow keys |
| Press and pick up | Point and trigger | Click and drag |
| Menu ("Take me to") | B or Y | M |

### Tested

On a computer screen: all the stages, the first button, the letters with the mouse (right and wrong), the phrases, opening the quiz, and a class session in two browser tabs on one computer (clock, Bring Everyone, avatars). **Not yet tested:** a headset, sound, a class over a real network, and every quiz answer.

## Where things are

- `lessons/tourism-vr/src/data/effects.js`: the original lesson as data, made by `tools/convert-engage-lesson.mjs`.
- `lessons/tourism-vr/src/data/place.js`: the areas of the town, the menu's places, the phrases and the pictures.
- `lessons/tourism-vr/src/`: `main.js` (the lesson), `Town.js`, `models.js`, `Walk.js`, `Noise.js`.
- `shared/`: copied from the WebXR Library (`JPInspired/WebXRProjects`, commit `b67595a`). Changes here: class sessions use their own names, so the two sites never mix; wording on the start screen; and `dragPoint` in `ui/Interaction.js`.

Outside services: three.js from cdn.jsdelivr.net, and for class sessions the relays and STUN servers in `shared/net/config.js`.
