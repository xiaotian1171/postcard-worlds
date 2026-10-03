// node test.mjs
//
// The parts of this app that are easy to get wrong and hard to see by clicking:
// reading a walk link back, and turning whatever the spotter answers into three
// usable spots. app.js is a plain module with no exports, so it is loaded
// through a temporary copy with the few functions under test exported.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "postcard-worlds-"));
const copy = join(dir, "app.mjs");
writeFileSync(copy, source + "\nexport { b64url, unb64url, walkLink, readReplay, parseExits, spotPosition, templateExits, state };\n");

const loc = { origin: "https://example.test", pathname: "/postcard-worlds/", hash: "", search: "", href: "https://example.test/postcard-worlds/" };
globalThis.location = loc;
globalThis.document = { addEventListener() {}, getElementById: () => null };
globalThis.window = globalThis;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const app = await import(copy);
let pass = 0;
let fail = 0;
const ok = (name, condition, extra = "") => {
    condition ? pass++ : fail++;
    console.log(`${condition ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

// A walk link has to survive the trip through base64url, including the commas,
// spaces and punctuation the prompts are full of.
const payload = JSON.stringify({
    v: 1,
    y: "postcard",
    p: [["vintage travel postcard, linen texture, muted faded colours, printed ink edge, a lighthouse on a stormy cliff, heavy rain", 123456, "Down the stair", "the same place from the bottom of the stair, looking back up", 1]],
});
ok("base64url round trip", app.unb64url(app.b64url(payload)) === payload);
ok("base64url is url safe", !/[+/=]/.test(app.b64url(payload)));

app.state.styleId = "film";
app.state.steps = [
    { prompt: "p one", seed: 111, label: "start", next: "p one", cell: 5 },
    { prompt: "p two", seed: 222, label: "Down the stair", next: "the same place from the bottom", cell: 1 },
];
const link = app.walkLink();
ok("walk link points at the page with a payload", link.startsWith("https://example.test/postcard-worlds/#p="));
loc.hash = "#p=" + link.split("#p=")[1];
const replay = app.readReplay();
ok("readReplay parses a link the app made", !!replay && replay.p.length === 2 && replay.styleId === "film");
ok("readReplay keeps prompt and seed", replay?.p[0][0] === "p one" && replay?.p[1][1] === 222);

loc.hash = "#p=not-base64-at-all!!";
ok("a garbage link gives null, not an exception", app.readReplay() === null);
loc.hash = "#p=" + app.b64url("{}");
ok("an empty payload gives null", app.readReplay() === null);

const good = JSON.stringify({
    exits: [
        { cell: 1, label: "Down the stair", next: "the same place from the bottom of the stair" },
        { cell: 6, label: "Past the gate", next: "the same place from beyond the gate" },
        { cell: 9, label: "Over the bridge", next: "the same place from the middle of the bridge" },
    ],
});
ok("plain JSON", app.parseExits(good).length === 3);
ok("JSON in code fences", app.parseExits("```json\n" + good + "\n```").length === 3);
ok("JSON with prose around it", app.parseExits("Sure! Here you go:\n" + good + "\nHope that helps.").length === 3);
ok("duplicate cells are dropped", app.parseExits(JSON.stringify({
    exits: [
        { cell: 5, label: "a b", next: "somewhere else entirely" },
        { cell: 5, label: "c d", next: "somewhere else entirely" },
        { cell: 7, label: "e f", next: "somewhere else entirely" },
    ],
})).length === 2);
ok("at most three exits", app.parseExits(JSON.stringify({
    exits: [1, 2, 3, 4, 5].map((cell) => ({ cell, label: "a b", next: "somewhere else entirely" })),
})).length === 3);
ok("cells outside 1-9 are ignored", app.parseExits(JSON.stringify({
    exits: [
        { cell: 0, label: "a b", next: "somewhere else entirely" },
        { cell: 10, label: "c d", next: "somewhere else entirely" },
        { cell: 3, label: "e f", next: "somewhere else entirely" },
        { cell: 8, label: "g h", next: "somewhere else entirely" },
    ],
})).length === 2);

let threw = false;
try { app.parseExits(JSON.stringify({ exits: [{ cell: 1, label: "only one", next: "somewhere" }] })); } catch { threw = true; }
ok("fewer than two exits is an error, so the templates take over", threw);
threw = false;
try { app.parseExits("no json here at all"); } catch { threw = true; }
ok("prose with no JSON is an error", threw);

const p1 = app.spotPosition(1);
const p5 = app.spotPosition(5);
const p9 = app.spotPosition(9);
ok("cell 1 top-left, 5 centre, 9 bottom-right", p1.left === "16.67%" && p1.top === "16.67%" && p5.left === "50.00%" && p5.top === "50.00%" && p9.left === "83.33%" && p9.top === "83.33%");

let templatesOk = true;
for (let i = 0; i < 30; i++) {
    const exits = app.templateExits();
    if (exits.length !== 3 || new Set(exits.map((exit) => exit.cell)).size !== 3) templatesOk = false;
    if (exits.some((exit) => exit.cell < 1 || exit.cell > 9 || !exit.label || !exit.next)) templatesOk = false;
}
ok("every template set is three spots on three cells", templatesOk);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
