/* Sleeve Press: Suno style view (was style-forge.html). Style prompts built from toggles, so every track on a release
   has the same shape. Lock fields, shuffle the rest by seed, trim to the model's limit. Reads and writes SP.get().style and tracks. */
(function () {
"use strict";

/* ---------- the banks ---------- */
const L = (s) => s.split(",").map(x => x.trim()).filter(Boolean);
const G = (id, fam, bpm, sub, inst, mood, prod, vocals) => ({ id, fam, bpm, sub: L(sub), inst: L(inst), mood: L(mood), prod: L(prod), vocals: L(vocals) });
const GENRES = [
  G("drum and bass", "Bass music", [170, 176], "liquid, neurofunk, jump up, atmospheric, minimal, techstep, rollers", "reese bass, amen breaks, sub bass, rhodes, pads, filtered stabs, strings", "rolling, dark, euphoric, melancholic, hypnotic, driving", "tight punchy drums, deep sub, wide pads, sidechained, clean mix", "instrumental, female vocals, male vocals, soulful"),
  G("jungle", "Bass music", [160, 172], "old school, ragga jungle, atmospheric, dark, rolling", "chopped amen breaks, sub bass, pads, stabs, dub siren, vinyl hiss", "dark, raw, smoky, nostalgic, driving", "dusty, vinyl crackle, raw, analog warmth", "instrumental, chanted vocals, male vocals"),
  G("dubstep", "Bass music", [138, 142], "deep dubstep, melodic, half-time, sparse, 140", "sub bass, wobble bass, half-time drums, sparse percussion, pads, dub chords", "dark, spacious, tense, hypnotic, brooding", "deep sub, wide stereo, heavy low end, reverb tails", "instrumental, whispered, female vocals"),
  G("drumstep", "Bass music", [168, 176], "melodic, hybrid, heavy, festival", "half-time drop, sub bass, supersaws, snare rolls, big pads, riser", "euphoric, uplifting, energetic, epic", "big drop, sidechained, wide stereo, polished", "instrumental, female vocals, male vocals"),
  G("riddim", "Bass music", [138, 142], "minimal riddim, heavy, tearout", "growl bass, sparse drums, sub, rimshots, vocal chops", "aggressive, menacing, tense", "heavy low end, tight drums, loud master", "instrumental, chopped vocals"),
  G("reggae", "Reggae family", [70, 90], "roots, one drop, rocksteady, steppers, modern roots", "one drop drums, offbeat guitar skank, bubbling organ, deep bass, horns, rimshot", "warm, laid-back, soulful, spiritual, sunlit", "analog warmth, tape saturation, spring reverb, live band feel", "male vocals, female vocals, harmonies, instrumental, melodic chant"),
  G("lovers rock", "Reggae family", [64, 80], "UK lovers rock, soul reggae, smooth", "warm bass, rhodes, offbeat guitar, soft strings, brushed drums, sax", "romantic, tender, smooth, late-night, dreamy", "analog warmth, soft reverb, warm tape", "female vocals, male vocals, harmonies, falsetto"),
  G("dub", "Reggae family", [64, 82], "roots dub, dub techno, steppers dub, echo chamber", "echo delay, spring reverb, deep bass, sparse drums, melodica, mixing desk effects, skank", "spacious, hypnotic, smoky, meditative", "heavy echo, tape delay, deep low end, analog desk", "instrumental, vocal fragments"),
  G("dancehall", "Reggae family", [90, 105], "modern dancehall, digital, 90s dancehall", "digital riddim, punchy kick, synth stabs, sub bass, claps", "energetic, bouncy, confident, sunlit", "clean mix, punchy drums, loud master", "male vocals, female vocals, toasting, chanted vocals"),
  G("future bass", "Electronic", [128, 160], "melodic, kawaii, chill, festival", "supersaws, pitched vocal chops, sidechained chords, claps, pluck lead", "euphoric, uplifting, dreamy, bright, emotional", "wide stereo, sidechain pump, polished, shimmering", "female vocals, chopped vocals, instrumental"),
  G("UK garage", "Electronic", [128, 134], "2-step, speed garage, dark garage, bassline", "skippy drums, swung hats, sub bass, chopped vocals, organ stabs, pads", "late-night, groovy, moody, smooth", "crisp mix, swing, warm sub, lo-fi texture", "female vocals, chopped vocals, instrumental, male vocals"),
  G("house", "Electronic", [120, 128], "deep house, soulful house, piano house, afro house, tech house", "four-on-the-floor kick, offbeat hats, piano chords, bassline, pads, claps", "groovy, warm, uplifting, sunlit, hypnotic", "clean mix, warm low end, sidechained, analog warmth", "female vocals, soulful, instrumental, chanted vocals"),
  G("techno", "Electronic", [124, 140], "dub techno, minimal, melodic, industrial, peak time", "driving kick, rumble bass, hi-hat loops, modular synth, metallic percussion, pads", "hypnotic, dark, tense, relentless, cold", "raw, saturated, wide reverb, analog", "instrumental"),
  G("trap", "Hip hop", [130, 150], "dark trap, melodic trap, cloud rap, drill", "808 bass, rolling hi-hats, snare, dark pads, bells, vocal ad-libs", "dark, moody, menacing, melodic, cold", "heavy 808, crisp hats, loud master", "rap, male vocals, ad-libs, autotune"),
  G("boom bap", "Hip hop", [84, 96], "jazzy, 90s, underground, soul sample feel", "dusty drums, upright bass, rhodes, vinyl scratches, horn stabs, piano loop", "gritty, nostalgic, laid-back, smoky", "vinyl crackle, dusty, MPC swing, lo-fi texture", "rap, male vocals, instrumental"),
  G("lo-fi hip hop", "Hip hop", [68, 90], "chillhop, jazzy, study beats, rainy", "mellow keys, dusty drums, warm bass, vinyl noise, soft guitar, tape wobble", "cozy, hazy, mellow, nostalgic, sleepy", "tape saturation, vinyl crackle, lo-fi texture, warm", "instrumental, vocal samples"),
  G("ambient", "Textural", [50, 90], "dark ambient, drone, cinematic, new age, field recordings", "evolving pads, drones, granular textures, piano, field recordings, soft bells", "spacious, meditative, ethereal, calm, vast", "long reverb, wide stereo, soft dynamics, analog warmth", "instrumental, wordless vocals, whispered"),
  G("synthwave", "Retro", [96, 120], "outrun, darksynth, dreamwave, retrowave", "analog synths, gated reverb drums, arpeggios, bass pulse, lead synth", "nostalgic, neon, driving, cinematic, dreamy", "gated reverb, chorus, 80s, wide stereo", "instrumental, female vocals, male vocals"),
  G("indie rock", "Band", [108, 140], "jangly, post-punk, garage, dream pop, shoegaze", "clean electric guitar, driving bass, live drums, reverb guitar, organ", "restless, wistful, energetic, hazy, earnest", "live band feel, analog warmth, raw, room reverb", "male vocals, female vocals, harmonies, instrumental"),
  G("folk", "Band", [72, 120], "acoustic, folk-pop, stomp and holler, fingerstyle, pastoral", "acoustic guitar, upright bass, fiddle, soft percussion, banjo, harmonium", "warm, wistful, earthy, intimate, pastoral", "close mic, room sound, warm, natural dynamics", "male vocals, female vocals, harmonies, choir"),
  G("soul", "Band", [64, 110], "neo soul, 70s soul, southern soul, northern soul", "rhodes, warm bass, live drums, horns, strings, clean guitar", "soulful, warm, smooth, heartfelt, groovy", "analog warmth, tape saturation, live band feel", "female vocals, male vocals, harmonies, falsetto"),
  G("funk", "Band", [95, 118], "p-funk, disco funk, boogie, jazz funk", "slap bass, wah guitar, clavinet, tight drums, horn section, congas", "groovy, playful, sunlit, confident", "tight pocket, dry drums, analog warmth, live band feel", "male vocals, female vocals, chanted vocals, instrumental"),
  G("pop", "Pop", [96, 126], "synth-pop, electropop, dance-pop, indie pop", "punchy drums, bright synths, bass, claps, plucks, vocal stacks", "uplifting, catchy, bright, emotional, sunlit", "polished, wide stereo, crisp mix, loud master", "female vocals, male vocals, harmonies, duet"),
  G("breakbeat", "Electronic", [125, 140], "nu skool, big beat, rave, broken beat", "chopped breakbeats, acid bassline, rave stabs, hoover synth, vocal samples", "energetic, gritty, euphoric, nostalgic", "punchy drums, distortion, analog warmth", "instrumental, chopped vocals, rap"),
  G("grime", "Hip hop", [138, 142], "eskibeat, sinogrime, modern grime, war dub", "square wave bass, sparse drums, eski clicks, string stabs, sub bass", "aggressive, cold, tense, raw", "dry mix, loud, raw", "rap, male vocals, ad-libs, instrumental"),
  G("phonk", "Hip hop", [130, 160], "drift phonk, Memphis, house phonk", "cowbell melody, distorted 808, Memphis vocal chops, hi-hat rolls", "dark, aggressive, hypnotic, menacing", "heavy distortion, saturated, loud master", "chopped vocals, rap, instrumental"),
  G("trip hop", "Textural", [70, 95], "Bristol, cinematic, downtempo, dark", "dusty breakbeat, deep bass, vinyl crackle, strings, Rhodes, scratches", "moody, smoky, melancholic, noir", "lo-fi texture, tape saturation, spacious reverb", "female vocals, whispered, instrumental"),
  G("afrobeats", "Global", [98, 112], "afro-pop, afro-fusion, alté", "log drums, shakers, guitar licks, warm bass, synth pads, percussion", "sunlit, groovy, romantic, joyful", "clean mix, warm low end, bright", "male vocals, female vocals, harmonies"),
  G("amapiano", "Global", [110, 115], "private school, deep, soulful", "log drum bass, piano chords, shakers, pads, sparse kick, whistles", "hypnotic, warm, late-night, groovy", "deep low end, wide pads, clean", "instrumental, female vocals, chanted vocals"),
  G("reggaeton", "Global", [88, 100], "perreo, romantic, old school", "dembow rhythm, 808 bass, synth plucks, reggaeton snare", "sensual, energetic, confident", "loud master, punchy drums, polished", "male vocals, female vocals, rap"),
  G("bossa nova", "Global", [100, 140], "classic, jazz bossa, lounge", "nylon guitar, brushed drums, upright bass, flute, soft piano", "breezy, intimate, warm, sunlit", "close mic, natural dynamics, warm", "female vocals, male vocals, whispered, instrumental"),
  G("jazz", "Band", [70, 180], "cool jazz, hard bop, modal, spiritual jazz, nu jazz", "upright bass, ride cymbal, piano trio, tenor sax, trumpet, brushes", "smoky, late-night, contemplative, spiritual", "live room, natural dynamics, warm", "instrumental, female vocals, scat"),
  G("shoegaze", "Band", [90, 140], "dream pop, blackgaze, nu-gaze", "walls of fuzz guitar, reverse reverb, buried vocals, driving drums, synth pads", "dreamy, hazy, melancholic, euphoric", "wall of sound, heavy reverb, wide stereo", "female vocals, male vocals, wordless vocals"),
  G("post-rock", "Band", [80, 140], "cinematic, crescendo, math rock", "delay guitars, tremolo picking, swelling drums, bowed bass, glockenspiel", "epic, wistful, vast, building", "big dynamics, room sound, long reverb", "instrumental"),
  G("hyperpop", "Pop", [140, 170], "glitchcore, digicore, bubblegum bass", "pitched vocals, distorted 808, glitch fx, bright synths, chiptune leads", "chaotic, euphoric, bright, emotional", "hyper-compressed, bitcrushed, loud master", "female vocals, autotune, pitched vocals"),
  G("country", "Band", [80, 120], "outlaw, alt-country, americana, honky tonk", "pedal steel, acoustic guitar, fiddle, upright bass, brushed snare", "earnest, wistful, warm, rowdy", "live band feel, warm, natural", "male vocals, female vocals, harmonies"),
  G("metal", "Band", [100, 200], "doom, sludge, thrash, post-metal, metalcore", "downtuned guitars, double kick drums, distorted bass, blast beats", "heavy, aggressive, dark, crushing", "wall of guitars, tight drums, loud", "screamed vocals, male vocals, instrumental"),
  G("cinematic", "Textural", [60, 130], "orchestral, trailer, epic, scoring, hybrid", "strings, brass, taiko drums, piano, choir, braams, sub drops", "epic, tense, emotional, vast, heroic", "wide stage, big dynamics, long reverb, polished", "instrumental, choir, wordless vocals"),
];
const GBY = Object.fromEntries(GENRES.map(g => [g.id, g]));
const FAMILIES = [...new Set(GENRES.map(g => g.fam))];
const ERAS = L("70s, 80s, 90s, early 2000s, 2010s, modern");
const MOODS = L("warm, dark, hypnotic, euphoric, melancholic, spiritual, nostalgic, aggressive, dreamy, laid-back, tense, uplifting, moody, smoky, hazy, sunlit, spacious, romantic, gritty, cinematic");
const PRODS = L("analog warmth, tape saturation, crisp mix, lo-fi texture, wide stereo, deep sub, vinyl crackle, spring reverb, punchy drums, clean master, dusty, raw");
const VOCALS = L("instrumental, male vocals, female vocals, duet, harmonies, choir, rap, spoken word, whispered, soulful, raspy, chanted vocals, chopped vocals, falsetto, ad-libs, toasting, wordless vocals");
const EXCLUDES = L("vocals, autotune, guitar, piano, drums, trap hi-hats, EDM drop, pop, country, metal, screaming, rap, choir, orchestra, 808, distortion");
const KEYS = []; ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].forEach(n => { KEYS.push(n + " minor"); KEYS.push(n + " major"); });
const STRUCT = {
  club: "[Instrumental]\n[Intro: sparse drums and pads]\n[Build]\n[Drop]\n[Breakdown: pads only]\n[Build]\n[Drop 2: heavier]\n[Outro: stripped drums, fade]",
  song: "[Intro]\n[Verse 1]\n[Pre-Chorus]\n[Chorus]\n[Verse 2]\n[Pre-Chorus]\n[Chorus]\n[Bridge]\n[Final Chorus]\n[Outro]",
  dub: "[Instrumental]\n[Intro: drum and bass only]\n[Version: echo on the drums]\n[Drop out: bass and echo]\n[Return: full rhythm]\n[Outro: slow fade into echo]",
  loop: "[Instrumental]\n[Intro: 4 bars]\n[Main loop]\n[Outro: 4 bars, clean end]",
};

/* ---------- state ---------- */
const DEF = {
  genre: "drum and bass", sub: ["liquid"], bpmOn: true, bpm: 174, key: "", era: "", mood: ["rolling", "warm"],
  inst: ["reese bass", "amen breaks", "pads"], vocals: ["instrumental"], prod: ["tight punchy drums", "deep sub"], extra: "",
  exclude: ["vocals"], exText: "", energy: "", variety: "0", limit: 200, trim: true, order: "genre", structure: "club", family: "any", seed: 1,
  locks: { genre: false, sub: false, bpm: false, era: false, mood: false, inst: false, vocals: false, prod: false },
};
let F = { ...DEF, locks: { ...DEF.locks } };

/* ---------- composition ---------- */
function keyTag(k) {
  if (!k) return "";
  const m = /^([A-G])([#♯b♭]?)\s*(m|min|minor|maj|major)?$/i.exec(k.trim());
  if (!m) return k;
  const acc = m[2] === "#" ? "♯" : m[2] === "b" ? "♭" : m[2];
  return `${m[1].toUpperCase()}${acc} ${/^m(in|inor)?$/i.test(m[3] || "") && m[3] ? "minor" : "major"}`.replace("♯", "#").replace("♭", "b");
}
function blocks(f, over = {}) {
  const bpm = over.bpm || f.bpm, key = over.key || f.key;
  const B = {
    genre: [{ t: f.genre, p: 0 }],
    sub: f.sub.map(t => ({ t: `${t}`, p: 1 })),
    mood: [...f.mood, ...(f.energy ? [f.energy] : [])].map(t => ({ t, p: 5 })),
    tempo: f.bpmOn ? [{ t: `${bpm} bpm`, p: 3 }] : [],
    key: key ? [{ t: `${keyTag(key)}`, p: 7 }] : [],
    inst: f.inst.map(t => ({ t, p: 4 })),
    vocals: f.vocals.map(t => ({ t, p: 2 })),
    era: f.era ? [{ t: f.era, p: 6 }] : [],
    prod: f.prod.map(t => ({ t, p: 8 })),
    extra: L(f.extra).map(t => ({ t, p: 9 })),
  };
  const orders = {
    genre: ["genre", "sub", "mood", "tempo", "key", "inst", "vocals", "era", "prod", "extra"],
    mood: ["mood", "genre", "sub", "tempo", "key", "inst", "vocals", "era", "prod", "extra"],
    inst: ["genre", "sub", "inst", "tempo", "key", "mood", "vocals", "era", "prod", "extra"],
  };
  return orders[f.order].flatMap(k => B[k]);
}
function compose(f, over) {
  let tags = blocks(f, over), dropped = 0;
  const join = (a) => a.map(x => x.t).join(", ");
  if (f.trim) {
    while (join(tags).length > f.limit && tags.some(x => x.p > 0)) {
      const worst = Math.max(...tags.map(x => x.p)); const idx = tags.map(x => x.p).lastIndexOf(worst);
      tags.splice(idx, 1); dropped++;
    }
  }
  return { text: join(tags), dropped };
}
function exclusion(f) { return [...f.exclude, ...L(f.exText)].join(", "); }

/* ---------- shuffle ---------- */
function shuffled(f, seed) {
  const rnd = SP.mulberry32(seed * 2654435761 >>> 0), pick = (a) => a[Math.floor(rnd() * a.length)];
  const many = (a, lo, hi) => { const n = lo + Math.floor(rnd() * (hi - lo + 1)); const c = [...a], out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
  const o = { ...f, locks: f.locks, sub: [...f.sub], mood: [...f.mood], inst: [...f.inst], vocals: [...f.vocals], prod: [...f.prod], seed };
  if (!f.locks.genre) { const pool = GENRES.filter(g => f.family === "any" || g.fam === f.family); o.genre = pick(pool).id; }
  const g = GBY[o.genre];
  if (!f.locks.genre || !f.locks.sub) { /* sub follows the genre unless locked */ }
  if (!f.locks.sub) o.sub = many(g.sub, 1, 2);
  if (!f.locks.bpm) o.bpm = g.bpm[0] + Math.floor(rnd() * (g.bpm[1] - g.bpm[0] + 1));
  if (!f.locks.era) o.era = rnd() < 0.45 ? pick(ERAS) : "";
  if (!f.locks.mood) o.mood = many([...g.mood, ...many(MOODS, 2, 3)].filter((v, i, a) => a.indexOf(v) === i), 2, 3);
  if (!f.locks.inst) o.inst = many(g.inst, 3, 4);
  if (!f.locks.vocals) o.vocals = [pick(g.vocals)];
  if (!f.locks.prod) o.prod = many([...g.prod, ...many(PRODS, 1, 2)].filter((v, i, a) => a.indexOf(v) === i), 1, 2);
  return o;
}

/* Per-track form: the same sound, nudged per track so an album hangs together without every prompt matching. */
function trackForm(i) {
  if (F.variety === "2") return { ...shuffled({ ...F, locks: { ...F.locks, genre: true } }, F.seed * 1000 + i + 1), locks: F.locks };
  if (F.variety !== "1") return F;
  const g = GBY[F.genre], r = SP.mulberry32(F.seed * 977 + i * 131 + 5), pick = (a) => a[Math.floor(r() * a.length)];
  const f = { ...F, mood: [...F.mood], inst: [...F.inst] };
  if (!F.locks.mood && f.mood.length) f.mood[Math.floor(r() * f.mood.length)] = pick([...g.mood, ...MOODS].filter(m => !f.mood.includes(m)));
  if (!F.locks.inst && f.inst.length) f.inst[Math.floor(r() * f.inst.length)] = pick(g.inst.filter(m => !f.inst.includes(m))) || f.inst[0];
  return f;
}

/* ---------- view ---------- */
let el = null, visible = false, dirty = true, writing = false;
const q = (id) => el.querySelector("#sf-" + id);
const bank = () => SP.get().style.bank || [];
const structure = () => STRUCT[F.structure] || STRUCT.club;

function write(section, value, how = "patch") {
  writing = true;
  try { how === "set" ? SP.set(section, value) : SP.patch(section, value); } finally { writing = false; }
}
function save(extra) {
  const cur = SP.get().style, next = { ...cur, form: F, ...extra };
  if (JSON.stringify(next) === JSON.stringify(cur)) return;
  write("style", { form: F, ...extra });
}
function loadForm(db) { const f = db.style.form || {}; return { ...DEF, ...f, locks: { ...DEF.locks, ...(f.locks || {}) } }; }

function chipset(host, items, get, set, cls) {
  host.textContent = "";
  [...new Set([...items, ...get()])].forEach(t => host.append(App.h("button", {
    type: "button", class: "chip-b" + (cls ? " " + cls : ""), "aria-pressed": String(get().includes(t)),
    onclick: () => { const cur = get(); set(cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]); update(); },
  }, t)));
}
function single(host, items, get, set) {
  host.textContent = "";
  items.forEach(t => host.append(App.h("button", { type: "button", class: "chip-b", "aria-pressed": String(get() === t), onclick: () => { set(get() === t ? "" : t); update(); } }, t)));
}
const sum = (a, n = 3) => !a.length ? "none" : a.slice(0, n).join(", ") + (a.length > n ? ` +${a.length - n}` : "");
const pad = (n) => String(n).padStart(2, "0");

function renderBank() {
  const host = q("bank"); host.textContent = "";
  q("bankN").textContent = bank().length ? String(bank().length) : "";
  if (!bank().length) { host.append(App.h("p", { class: "hint" }, "Saved prompts keep every toggle, so Load brings the whole setup back.")); return; }
  bank().forEach((b, i) => host.append(App.h("div", { class: "it" },
    App.h("b", {}, b.name), App.h("div", { class: "p" }, b.prompt),
    App.h("div", { class: "a" },
      App.h("button", { type: "button", class: "btn small", onclick: () => { F = { ...DEF, ...b.form, locks: { ...DEF.locks, ...(b.form.locks || {}) } }; update(); SP.toast(`Loaded “${b.name}”`); } }, "Load"),
      App.h("button", { type: "button", class: "btn small", onclick: () => SP.copy(b.prompt, "style") }, "Copy"),
      App.h("button", { type: "button", class: "btn small", onclick: () => { write("style", { bank: bank().filter((_, k) => k !== i) }); renderBank(); } }, "Delete")))));
}
function batchList() {
  return SP.get().tracks.map((t, i) => ({ n: i + 1, title: t.title + (t.feat ? ` (feat. ${t.feat})` : ""), prompt: compose(trackForm(i), { bpm: t.bpm, key: t.key }).text }));
}
function syncTracksBox() {
  const ta = q("tracks"), tracks = SP.get().tracks;
  if (document.activeElement !== ta && JSON.stringify(SP.parseTracks(ta.value)) !== JSON.stringify(tracks)) ta.value = SP.tracksToText(tracks);
  q("tracksSum").textContent = tracks.length ? `${tracks.length} track${tracks.length === 1 ? "" : "s"}` : "none yet";
}

let segs = {};
function update() {
  const g = GBY[F.genre] || GENRES[0];
  q("genre").value = F.genre; q("family").value = F.family; q("key").value = F.key;
  q("limit").value = String(F.limit);
  if (!q("limit").value) { q("limit").add(new Option(String(F.limit), String(F.limit))); q("limit").value = String(F.limit); }
  q("bpm").value = F.bpm; q("bpmOut").textContent = F.bpm; q("bpmOn").checked = F.bpmOn; q("trim").checked = F.trim;
  if (document.activeElement !== q("extra")) q("extra").value = F.extra;
  if (document.activeElement !== q("exText")) q("exText").value = F.exText;
  chipset(q("subChips"), g.sub, () => F.sub, v => F.sub = v);
  chipset(q("moodChips"), [...g.mood, ...MOODS], () => F.mood, v => F.mood = v);
  chipset(q("instChips"), g.inst, () => F.inst, v => F.inst = v);
  chipset(q("vocalChips"), VOCALS, () => F.vocals, v => F.vocals = v);
  chipset(q("prodChips"), [...g.prod, ...PRODS], () => F.prod, v => F.prod = v);
  chipset(q("exChips"), EXCLUDES, () => F.exclude, v => F.exclude = v, "neg");
  single(q("eraChips"), ERAS, () => F.era, v => F.era = v);
  el.querySelectorAll("[data-lock]").forEach(b => { const on = !!F.locks[b.dataset.lock]; b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "locked" : "lock"; });
  Object.values(segs).forEach(fn => fn());

  // section summaries, so closed sections still say what's in them
  q("genreSum").textContent = [F.genre, ...F.sub].join(" · ");
  q("tempoSum").textContent = [F.bpmOn ? `${F.bpm} bpm` : "", F.key, F.era].filter(Boolean).join(" · ") || "unset";
  q("moodSum").textContent = sum([...F.mood, ...(F.energy ? [F.energy] : [])]);
  q("instSum").textContent = sum(F.inst);
  q("vocalSum").textContent = sum(F.vocals);
  q("prodSum").textContent = sum([...F.prod, ...L(F.extra)]);
  q("exSum").textContent = sum([...F.exclude, ...L(F.exText)], 2);
  q("limitSum").textContent = `${F.limit} · ${F.order} first`;

  // outputs
  const c = compose(F);
  q("styleOut").textContent = c.text || "—";
  q("lenOut").textContent = `${c.text.length} / ${F.limit}`;
  q("lenOut").classList.toggle("over", c.text.length > F.limit);
  q("trimNote").textContent = c.dropped ? `Trimmed ${c.dropped} low-priority tag${c.dropped === 1 ? "" : "s"} to fit ${F.limit} characters.` : (c.text.length > F.limit ? "Over the limit. Turn on trimming under Limit, or remove a few tags." : "");
  q("trimNote").hidden = !q("trimNote").textContent;
  q("seed").textContent = F.seed;
  const ex = exclusion(F); q("excludeOut").textContent = ex || "—"; q("exLen").textContent = `${ex.length} chars`;
  q("structOut").textContent = structure();

  // variations: same locks, other seeds; nothing changes until one is chosen
  const vh = q("variants"); vh.textContent = "";
  for (let i = 1; i <= 6; i++) {
    const s = F.seed + i, v = shuffled(F, s), vc = compose(v);
    vh.append(App.h("div", { class: "var" }, App.h("div", { class: "p" }, vc.text),
      App.h("div", { class: "a" },
        App.h("button", { type: "button", class: "btn small", onclick: () => { F = { ...v, locks: F.locks, family: F.family }; update(); } }, "Use"),
        App.h("button", { type: "button", class: "btn small", onclick: () => SP.copy(vc.text, "style") }, "Copy"),
        App.h("span", {}, `seed ${s} · ${vc.text.length}`))));
  }

  // per-track prompts
  const batch = batchList(), bh = q("batch"); bh.textContent = "";
  q("batchCount").textContent = batch.length ? `${batch.length} tracks` : "";
  q("copyBatch").disabled = !batch.length;
  if (!batch.length) bh.append(App.h("p", { class: "hint" }, "Add tracks above and each gets its own prompt, with its own tempo and key."));
  for (const b of batch) bh.append(App.h("div", { class: "it" },
    App.h("b", {}, `${pad(b.n)}  ${b.title}`), App.h("div", { class: "p" }, b.prompt),
    App.h("div", { class: "a" }, App.h("button", { type: "button", class: "btn small", onclick: () => SP.copy(b.prompt, "style") }, "Copy"))));
  syncTracksBox();
  renderBank();
  save({ prompt: c.text, exclude: ex, structure: structure(), batch, genre: F.genre });
}

const section = (key, title, body, open) => `
  <details${open ? " open" : ""}>
    <summary><span>${title}</span><small id="sf-${key}Sum"></small></summary>
    <div class="fields">${body}</div>
  </details>`;
const lockHead = (legend, lock) => `<div class="fh"><span class="legend">${legend}</span><button type="button" class="lockbtn" data-lock="${lock}" aria-pressed="false" title="Keep this when shuffling">lock</button></div>`;

function mount(root) {
  el = root;
  el.innerHTML = `
  <div class="view-head">
    <div><h1>Suno style</h1><p>Style prompts from toggles, so a whole release sounds related. Lock what you like, shuffle the rest.</p></div>
  </div>
  <div class="studio words">
    <div class="main">
      <section class="panel" aria-label="Style prompt">
        <h2>Style prompt <small class="counter" id="sf-lenOut"></small></h2>
        <div class="out big" id="sf-styleOut" aria-live="polite"></div>
        <p class="hint" id="sf-trimNote" hidden></p>
        <div class="btn-row">
          <button type="button" class="btn primary" id="sf-copyStyle">Copy style</button>
          <button type="button" class="btn" id="sf-prevSeed" aria-label="Previous seed">←</button>
          <span class="seed">seed <b id="sf-seed"></b></span>
          <button type="button" class="btn" id="sf-nextSeed" title="Shuffle everything that isn't locked">Shuffle →</button>
          <span class="sp"></span>
          <button type="button" class="btn small" id="sf-lockAll">Lock all</button>
          <button type="button" class="btn small" id="sf-unlockAll">Unlock all</button>
        </div>
      </section>

      <section class="panel" aria-label="Variations">
        <h2>Variations <small>same locks, next seeds</small></h2>
        <div class="variants" id="sf-variants"></div>
      </section>

      <section class="panel" aria-label="Per-track prompts">
        <h2>Per-track prompts <small id="sf-batchCount"></small></h2>
        <details class="inner" id="sf-tracksBox">
          <summary><span>Tracks</span><small id="sf-tracksSum"></small></summary>
          <div class="fields">
            <textarea class="mono" id="sf-tracks" rows="6" spellcheck="false" placeholder="Title | 140 | Am | 3:45&#10;Another one | 72 | Dm"></textarea>
            <p class="hint">One per line: title, then BPM, key and length in any order, split by |. A line of -- starts side B. <button type="button" class="linkish" id="sf-demo">Load demo tracks</button></p>
          </div>
        </details>
        <div class="seg" id="sf-variety" role="group" aria-label="Track variety">
          <button type="button" data-v="0">Same sound</button>
          <button type="button" data-v="1">Some variety</button>
          <button type="button" data-v="2">A lot</button>
        </div>
        <div class="batch" id="sf-batch"></div>
        <div class="btn-row"><button type="button" class="btn" id="sf-copyBatch">Copy all prompts</button></div>
      </section>

      <details class="out-sec">
        <summary><span>Exclude styles</span><small id="sf-exLen"></small></summary>
        <div class="fields">
          <div class="out" id="sf-excludeOut"></div>
          <div class="btn-row"><button type="button" class="btn small" id="sf-copyEx">Copy exclude</button></div>
        </div>
      </details>
      <details class="out-sec">
        <summary><span>Lyrics-box structure</span><small>meta tags</small></summary>
        <div class="fields">
          <div class="seg" id="sf-structure" role="group" aria-label="Structure template">
            <button type="button" data-v="club">Club</button>
            <button type="button" data-v="song">Song</button>
            <button type="button" data-v="dub">Dub</button>
            <button type="button" data-v="loop">Loop</button>
          </div>
          <div class="out" id="sf-structOut"></div>
          <div class="btn-row"><button type="button" class="btn small" id="sf-copyStruct">Copy structure</button></div>
        </div>
      </details>
      <details class="out-sec">
        <summary><span>Prompt bank</span><small id="sf-bankN"></small></summary>
        <div class="fields">
          <div class="btn-row nowrap">
            <input type="text" id="sf-bankName" placeholder="Name this prompt" aria-label="Prompt name">
            <button type="button" class="btn small" id="sf-bankSave">Save current</button>
          </div>
          <div class="batch" id="sf-bank"></div>
        </div>
      </details>
    </div>

    <aside class="ticket" aria-label="Style settings">
      ${section("genre", "Genre", `
        <div class="row">
          <label class="f"><span>Genre <button type="button" class="lockbtn" data-lock="genre" aria-pressed="false" title="Keep this when shuffling">lock</button></span><select id="sf-genre"></select></label>
          <label class="f"><span>Shuffle within</span><select id="sf-family"><option value="any">Everything</option></select></label>
        </div>
        ${lockHead("Sub-genre", "sub")}
        <div class="chips" id="sf-subChips"></div>`, true)}
      ${section("tempo", "Tempo, key, era", `
        <div class="fh"><span class="legend">Tempo <output id="sf-bpmOut"></output></span><label class="check"><input type="checkbox" id="sf-bpmOn"> in prompt</label><button type="button" class="lockbtn" data-lock="bpm" aria-pressed="false" title="Keep this when shuffling">lock</button></div>
        <input type="range" id="sf-bpm" min="60" max="190" step="1" aria-label="BPM">
        <label class="f"><span>Key <output>a track's own key wins</output></span><select id="sf-key"><option value="">None</option></select></label>
        ${lockHead("Era", "era")}
        <div class="chips" id="sf-eraChips"></div>`, true)}
      ${section("mood", "Mood", `
        ${lockHead("Pick any", "mood")}
        <div class="chips" id="sf-moodChips"></div>
        <div class="seg" id="sf-energy" role="group" aria-label="Energy">
          <button type="button" data-v="">Any</button>
          <button type="button" data-v="low energy">Low</button>
          <button type="button" data-v="steady groove">Steady</button>
          <button type="button" data-v="driving">Driving</button>
          <button type="button" data-v="high energy">Peak</button>
        </div>`)}
      ${section("inst", "Instruments", `${lockHead("Pick any", "inst")}<div class="chips" id="sf-instChips"></div>`)}
      ${section("vocal", "Vocals", `${lockHead("Voice", "vocals")}<div class="chips" id="sf-vocalChips"></div>`)}
      ${section("prod", "Production", `
        ${lockHead("Pick any", "prod")}
        <div class="chips" id="sf-prodChips"></div>
        <label class="f"><span>Your own tags <output>always kept</output></span><input type="text" id="sf-extra" placeholder="1am, rain on the window"></label>`)}
      ${section("ex", "Exclude", `
        <div class="chips" id="sf-exChips"></div>
        <label class="f"><span>More</span><input type="text" id="sf-exText" placeholder="whistling, kazoo"></label>`)}
      ${section("limit", "Limit and order", `
        <label class="f"><span>Style character limit</span>
          <select id="sf-limit"><option value="120">120 (older models)</option><option value="200">200</option><option value="1000">1000</option><option value="3000">3000</option></select></label>
        <label class="check"><input type="checkbox" id="sf-trim"> Trim low-priority tags to fit</label>
        <div class="seg" id="sf-order" role="group" aria-label="Tag order">
          <button type="button" data-v="genre">Genre first</button>
          <button type="button" data-v="mood">Mood first</button>
          <button type="button" data-v="inst">Instruments</button>
        </div>
        <p class="hint">Check your Suno model's limit. Trimming drops production first and never the genre.</p>`)}
    </aside>
  </div>`;

  GENRES.forEach(x => q("genre").add(new Option(x.id, x.id)));
  FAMILIES.forEach(x => q("family").add(new Option(x, x)));
  KEYS.forEach(k => q("key").add(new Option(k, k)));
  segs = {
    order: SP.bindSeg(q("order"), () => F.order, v => { F.order = v; update(); }),
    structure: SP.bindSeg(q("structure"), () => F.structure, v => { F.structure = v; update(); }),
    variety: SP.bindSeg(q("variety"), () => F.variety, v => { F.variety = v; update(); }),
    energy: SP.bindSeg(q("energy"), () => F.energy, v => { F.energy = v; update(); }),
  };

  q("genre").addEventListener("change", e => {
    F.genre = e.target.value; const g = GBY[F.genre];
    F.sub = g.sub.slice(0, 1); F.mood = g.mood.slice(0, 2); F.inst = g.inst.slice(0, 3); F.vocals = [g.vocals[0]]; F.prod = g.prod.slice(0, 2);
    F.bpm = Math.round((g.bpm[0] + g.bpm[1]) / 2); update();
  });
  q("family").addEventListener("change", e => { F.family = e.target.value; update(); });
  q("bpm").addEventListener("input", e => { F.bpm = +e.target.value; update(); });
  q("bpmOn").addEventListener("change", e => { F.bpmOn = e.target.checked; update(); });
  q("trim").addEventListener("change", e => { F.trim = e.target.checked; update(); });
  q("key").addEventListener("change", e => { F.key = e.target.value; update(); });
  q("limit").addEventListener("change", e => { F.limit = +e.target.value; update(); });
  q("extra").addEventListener("input", e => { F.extra = e.target.value; update(); });
  q("exText").addEventListener("input", e => { F.exText = e.target.value; update(); });
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-lock]"); if (!b) return;
    e.preventDefault();   // the genre lock sits inside a <label>
    F.locks[b.dataset.lock] = !F.locks[b.dataset.lock]; update();
  });
  q("bankSave").addEventListener("click", () => {
    const name = q("bankName").value.trim() || `${F.genre} #${bank().length + 1}`;
    write("style", { bank: [...bank(), { name, prompt: compose(F).text, form: JSON.parse(JSON.stringify(F)) }] });
    q("bankName").value = ""; renderBank(); SP.toast(`Saved “${name}”`);
  });
  q("lockAll").addEventListener("click", () => { Object.keys(F.locks).forEach(k => F.locks[k] = true); update(); });
  q("unlockAll").addEventListener("click", () => { Object.keys(F.locks).forEach(k => F.locks[k] = false); update(); });
  q("nextSeed").addEventListener("click", () => { F = shuffled(F, F.seed + 1); update(); });
  q("prevSeed").addEventListener("click", () => { F = shuffled(F, Math.max(1, F.seed - 1)); update(); });
  q("copyStyle").addEventListener("click", () => SP.copy(compose(F).text, "style prompt"));
  q("copyEx").addEventListener("click", () => SP.copy(exclusion(F), "exclude list"));
  q("copyStruct").addEventListener("click", () => SP.copy(structure(), "structure"));
  q("copyBatch").addEventListener("click", () => {
    const b = batchList(); if (!b.length) return SP.toast("No tracks yet.");
    SP.copy(b.map(x => `${pad(x.n)} ${x.title}\n${x.prompt}`).join("\n\n"), "all prompts");
  });

  // the tracklist lives in the record; this box edits it directly
  const commitTracks = () => {
    const next = SP.parseTracks(q("tracks").value); if (JSON.stringify(next) === JSON.stringify(SP.get().tracks)) return;
    App.checkpoint(); write("tracks", next, "set"); update();
  };
  const typed = SP.debounce(commitTracks, 400);
  q("tracks").addEventListener("input", typed);
  q("tracks").addEventListener("blur", () => { commitTracks(); syncTracksBox(); });
  q("demo").addEventListener("click", () => {
    App.checkpoint(true); q("tracks").value = SP.DEMO_TRACKS; write("tracks", SP.parseTracks(SP.DEMO_TRACKS), "set"); update();
    SP.toast("Loaded the demo tracks. Undo puts yours back.");
  });

  SP.on(() => {
    if (writing) return; dirty = true;
    if (visible) { refresh(); return; }
    // Hidden: still keep the per-track prompts in step with the tracklist, so Export never ships stale ones.
    const d = SP.get(); if (!d.style.prompt) return;
    F = loadForm(d); const batch = batchList();
    if (JSON.stringify(batch) !== JSON.stringify(d.style.batch || [])) write("style", { batch });
  });
}
function refresh() { dirty = false; F = loadForm(SP.get()); update(); }

App.view("forge", {
  label: "Suno style", minor: true, mount,
  show() {
    visible = true;
    if (!SP.get().tracks.length) q("tracksBox").open = true;
    if (dirty) refresh();
  },
  hide() { visible = false; },
});
})();
