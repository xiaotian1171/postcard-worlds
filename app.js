// Postcard Worlds — type a scene, then step into it one picture at a time.
//
// Two ways to run:
//   free preview  legacy image endpoint + an anonymous text model that suggests
//                 the ways onwards. No account, nothing to configure.
//   signed in     gen.pollinations.ai with the visitor's own Pollen (BYOP).
//                 They pick the picture model, a vision model reads the actual
//                 picture to find the spots that are really in it, and their
//                 wallet balance is on screen.
//
// Everything runs in the browser. The key lives in sessionStorage for this tab
// only; no server of ours ever sees it.

const GEN = "https://gen.pollinations.ai";
const LEGACY = "https://image.pollinations.ai";
const ENTER = "https://enter.pollinations.ai";
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, "");
const WIDTH = 1024;
const HEIGHT = 768;
const GRID = 3;
const CELLS = GRID * GRID;
const FREE_VIEWS = 3;

const SS = { token: "pw.token", verifier: "pw.verifier", state: "pw.state" };
const PREF = "pw.prefs";
const APPKEY = "pw.appkey";

const STYLES = [
    { id: "postcard", name: "Vintage postcard", phrase: "vintage travel postcard, linen texture, muted faded colours, printed ink edge" },
    { id: "watercolour", name: "Watercolour wash", phrase: "loose watercolour wash, soft bleeding edges, visible paper grain" },
    { id: "riso", name: "Risograph", phrase: "risograph print, two-colour overprint, visible halftone dots" },
    { id: "film", name: "35mm film", phrase: "35mm film photograph, warm grain, shallow depth of field, natural light" },
    { id: "clay", name: "Claymation", phrase: "stop-motion claymation set, plasticine figures, handcrafted miniature" },
    { id: "ink", name: "Ink and wash", phrase: "sumi-e ink and wash, minimal brush strokes, generous empty space" },
];

const SURPRISES = [
    "a foggy harbour town at dawn, gulls on the mast",
    "a lighthouse keeper's kitchen after a storm",
    "a night market on a bridge over a canal",
    "a greenhouse full of sleeping machinery",
    "a train platform where the clock has stopped",
    "a rooftop garden above a flooded city",
    "a library inside a hollow tree",
    "a desert bus stop with one working lamp",
];

// Used when nothing else can propose ways onwards, so the walk never dead-ends.
// The preview has no key to spend, so its exits come from three generic
// templates. Nothing in the preview calls the network for them: it stays
// instant and costs nobody anything.
const TEMPLATE_SETS = [
    [
        { cell: 2, label: "Through the doorway", next: "the same place seen from just inside, through the open doorway" },
        { cell: 5, label: "Onwards along the path", next: "the same place a little further on, following the path away" },
        { cell: 8, label: "Out of the window", next: "the same place seen from a window above, looking out over it" },
    ],
    [
        { cell: 1, label: "Down the stair", next: "the same place from the bottom of the stair, looking back up" },
        { cell: 6, label: "Past the gate", next: "the same place from beyond the gate, seen from the other side" },
        { cell: 9, label: "Over the bridge", next: "the same place from the middle of the bridge, water below" },
    ],
    [
        { cell: 3, label: "Round the corner", next: "the same place from around the corner, half hidden" },
        { cell: 4, label: "Under the arch", next: "the same place from under the arch, looking through it" },
        { cell: 7, label: "Up the hill", next: "the same place seen from higher up the hill, looking down" },
    ],
];

function templateExits() {
    return TEMPLATE_SETS[Math.floor(Math.random() * TEMPLATE_SETS.length)].map((exit) => ({ ...exit }));
}

const SPOT_VISION = `You are the spotter for a picture explorer. Look at the picture and choose exactly three places the player could click to step further into the same world: a door, a path, a window, a stair, a gate, a bridge — whatever is really in this picture.

Answer with JSON only, no prose, no code fences:
{"exits":[{"cell":<1-9>,"label":"<2-4 words>","next":"<8-16 word description of the next picture, same world, one step further>"}]}

cell is the position of that spot in the picture on a 3x3 grid: 1 top-left, 2 top-centre, 3 top-right, 4 middle-left, 5 centre, 6 middle-right, 7 bottom-left, 8 bottom-centre, 9 bottom-right. Use three different cells. The label is what the player clicks, the next is what gets painted.`;

const el = {};
const state = {
    mode: "free",
    token: "",
    styleId: STYLES[0].id,
    imageModel: "",
    visionModel: "openai",
    keepLook: true,
    steps: [],
    index: 0,
    busy: false,
    replay: null,
};

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);

function toast(message, ms = 7000) {
    el.toast.textContent = message;
    el.toast.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.add("hidden"), ms);
}

function setLoading(text) {
    if (!text) {
        el.loading.classList.add("hidden");
        return;
    }
    el.loadingText.textContent = text;
    el.loading.classList.remove("hidden");
}

function style() {
    return STYLES.find((s) => s.id === state.styleId) || STYLES[0];
}

function randomSeed() {
    return Math.floor(Math.random() * 1000000);
}

function randomToken(bytes) {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return btoa(String.fromCharCode(...buffer)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function s256(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function authHeaders() {
    return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

function b64url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text) {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function b64ToBlob(base64, type = "image/jpeg") {
    const binary = atob(base64);
    return new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], { type });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the picture back."));
        reader.readAsDataURL(blob);
    });
}

async function apiError(response, what) {
    let detail = "";
    try {
        const data = await response.json();
        const raw = data?.error?.message ?? data?.message ?? data?.error;
        detail = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
    } catch {
        // not JSON; the status is enough
    }
    if (response.status === 401) return `The ${what} call needs a valid Pollinations key. Sign in or paste one.`;
    if (response.status === 402 || response.status === 403) return `The ${what} call was refused${detail ? `: ${detail}` : " — check your Pollen or the key's scope"}.`;
    if (response.status === 429) return "Too many requests just now. Wait a few seconds and click again.";
    return `The ${what} call failed (${response.status})${detail ? `: ${detail}` : ""}.`;
}

/* --------------------------------------------------------------- the picture */

function legacyUrl(step, previous) {
    const params = new URLSearchParams({
        width: String(WIDTH),
        height: String(HEIGHT),
        seed: String(step.seed),
        nologo: "true",
        referrer: "postcardworlds",
    });
    if (state.keepLook && previous?.publicUrl) params.set("image", previous.publicUrl);
    return `${LEGACY}/prompt/${encodeURIComponent(step.prompt)}?${params}`;
}

function genUrl(step, referenceUrl) {
    const params = new URLSearchParams({
        width: String(WIDTH),
        height: String(HEIGHT),
        seed: String(step.seed),
    });
    if (state.imageModel) params.set("model", state.imageModel);
    if (referenceUrl) params.set("image", referenceUrl);
    return `${GEN}/image/${encodeURIComponent(step.prompt)}?${params}`;
}

async function fetchBlob(url, what) {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) throw new Error(await apiError(response, what));
    return await response.blob();
}

async function generateImage(step, previous) {
    if (state.mode === "free") {
        const url = legacyUrl(step, previous);
        const blob = await fetchBlob(url, "picture");
        step.publicUrl = url;
        return blob;
    }
    if (state.keepLook && previous?.publicUrl) return await fetchBlob(genUrl(step, previous.publicUrl), "picture");
    if (state.keepLook && previous?.blob) {
        try {
            return await referenceImage(step, previous.blob);
        } catch {
            // the reference image is a nicety; a plain generation still works
        }
    }
    return await fetchBlob(genUrl(step), "picture");
}

async function referenceImage(step, referenceBlob) {
    const body = {
        prompt: step.prompt,
        n: 1,
        size: `${WIDTH}x${HEIGHT}`,
        response_format: "b64_json",
        image: await blobToDataUrl(referenceBlob),
    };
    if (state.imageModel) body.model = state.imageModel;
    const response = await fetch(`${GEN}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await apiError(response, "picture"));
    const data = await response.json();
    const base64 = data?.data?.[0]?.b64_json;
    if (!base64) throw new Error("The picture came back empty.");
    return b64ToBlob(base64);
}

/* ----------------------------------------------------------------- the exits */

async function chat(model, content) {
    const response = await fetch(`${GEN}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 500 }),
    });
    if (!response.ok) throw new Error(await apiError(response, "spotter"));
    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? "";
}

function parseExits(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The spotter did not answer with JSON.");
    const data = JSON.parse(text.slice(start, end + 1));
    const exits = [];
    const used = new Set();
    for (const item of Array.isArray(data?.exits) ? data.exits : []) {
        const cell = Number.parseInt(item?.cell, 10);
        const label = String(item?.label ?? "").trim().slice(0, 40);
        const next = String(item?.next ?? "").trim().slice(0, 180);
        if (!Number.isInteger(cell) || cell < 1 || cell > CELLS || used.has(cell)) continue;
        if (!label || !next) continue;
        used.add(cell);
        exits.push({ cell, label, next });
        if (exits.length === 3) break;
    }
    if (exits.length < 2) throw new Error("The spotter found fewer than two ways onwards.");
    return exits;
}

async function findExits(step) {
    if (state.mode === "free") return templateExits();
    try {
        const dataUrl = await blobToDataUrl(step.blob);
        const content = [
            { type: "text", text: SPOT_VISION },
            { type: "image_url", image_url: { url: dataUrl } },
        ];
        return parseExits(await chat(state.visionModel || "openai", content));
    } catch {
        return templateExits();
    }
}

function spotPosition(cell) {
    const index = cell - 1;
    return {
        left: `${((((index % GRID) + 0.5) / GRID) * 100).toFixed(2)}%`,
        top: `${(((Math.floor(index / GRID) + 0.5) / GRID) * 100).toFixed(2)}%`,
    };
}

/* ------------------------------------------------------------------ painting */

function current() {
    return state.steps[state.index] ?? null;
}

async function paint(step, previous) {
    const blob = await generateImage(step, previous);
    step.blob = blob;
    step.objectUrl = URL.createObjectURL(blob);
}

function replayStep(depth) {
    const recorded = state.replay?.p?.[depth];
    if (!recorded) return null;
    const [prompt, seed, label, next, cell] = recorded;
    return { prompt, seed, label, next, cell };
}

async function startWorld(scene) {
    const text = (scene ?? el.scene.value).trim();
    if (!text) {
        toast("Describe a scene first — a few words is plenty.");
        el.scene.focus();
        return;
    }
    if (state.busy) return;
    state.busy = true;
    state.steps = [];
    state.index = 0;
    el.start.classList.add("hidden");
    el.explore.classList.remove("hidden");
    el.replayNote.classList.toggle("hidden", !state.replay);
    if (state.replay) {
        el.replayNote.textContent = `Replaying a recorded walk of ${state.replay.p.length} view${state.replay.p.length === 1 ? "" : "s"}. The spot you see is the one the original walker clicked; each picture is repainted from the recorded prompt and seed.`;
    }
    savePrefs();

    try {
        setLoading("Painting the first postcard…");
        const first = replayStep(0) ?? { prompt: `${style().phrase}, ${text}`, seed: randomSeed() };
        const step = {
            prompt: first.prompt,
            seed: first.seed,
            label: first.label || text.slice(0, 60),
            next: first.next || text,
            cell: first.cell || 5,
            exits: null,
            blob: null,
            objectUrl: "",
            publicUrl: "",
        };
        state.steps.push(step);
        await paint(step, null);
        render();
        await loadExits(step);
    } catch (error) {
        toast(error.message);
        state.steps = [];
        el.explore.classList.add("hidden");
        el.start.classList.remove("hidden");
    } finally {
        state.busy = false;
        setLoading(null);
    }
}

async function stepInto(exit) {
    if (state.busy) return;
    if (state.mode === "free" && state.steps.length >= FREE_VIEWS) {
        toast(`The free preview stops after ${FREE_VIEWS} views. Sign in and the next step is yours to take — on your own Pollen.`);
        el.signinBox.open = true;
        el.signinBox.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }
    const previous = current();
    if (!previous) return;
    state.busy = true;
    setLoading("Walking onwards…");
    try {
        // While replaying a recorded walk the prompt and seed come from the
        // recording, so the same pictures come back.
        const recorded = state.replay ? replayStep(state.steps.length) : null;
        const step = {
            prompt: recorded?.prompt ?? `${style().phrase}, ${exit.next}`,
            seed: recorded?.seed ?? randomSeed(),
            label: recorded?.label ?? exit.label,
            next: recorded?.next ?? exit.next,
            cell: recorded?.cell ?? exit.cell,
            exits: null,
            blob: null,
            objectUrl: "",
            publicUrl: "",
        };
        state.steps.push(step);
        await paint(step, previous);
        state.index = state.steps.length - 1;
        render();
        await loadExits(step);
    } catch (error) {
        toast(error.message);
        state.steps.pop();
    } finally {
        state.busy = false;
        setLoading(null);
    }
}

async function loadExits(step) {
    const recorded = state.replay ? replayStep(state.steps.length) : null;
    if (recorded) {
        step.exits = [{ cell: recorded.cell || 5, label: recorded.label, next: recorded.next }];
        renderSpots(step);
        return;
    }
    setLoading("Looking for ways onwards…");
    try {
        step.exits = await findExits(step);
        renderSpots(step);
    } finally {
        setLoading(null);
    }
}

/* ------------------------------------------------------------------ rendering */

function render() {
    const step = current();
    if (!step) return;
    el.view.src = step.objectUrl;
    el.stepLabel.textContent = step.label || "Your world";
    el.stepPrompt.textContent = step.prompt;
    renderSpots(step);
    renderCrumbs();
}

function renderSpots(step) {
    el.spots.innerHTML = "";
    if (!step?.exits) return;
    step.exits.forEach((exit, index) => {
        const button = document.createElement("button");
        button.className = "spot";
        button.type = "button";
        button.textContent = exit.label;
        const position = spotPosition(exit.cell);
        button.style.left = position.left;
        button.style.top = position.top;
        button.style.animationDelay = `${index * 90}ms`;
        button.addEventListener("click", () => stepInto(exit));
        el.spots.append(button);
    });
}

function renderCrumbs() {
    el.crumbs.innerHTML = "";
    state.steps.forEach((step, index) => {
        const button = document.createElement("button");
        button.className = "crumb";
        button.type = "button";
        button.title = step.prompt;
        button.setAttribute("aria-current", String(index === state.index));
        if (step.objectUrl) button.style.backgroundImage = `url("${step.objectUrl}")`;
        const label = document.createElement("span");
        label.textContent = step.label || "start";
        button.append(label);
        button.addEventListener("click", () => {
            state.index = index;
            render();
        });
        el.crumbs.append(button);
    });
    const active = el.crumbs.children[state.index];
    if (active) el.crumbs.scrollLeft = Math.max(0, active.offsetLeft - 24);
}

/* -------------------------------------------------------------------- sign in */

function useKey(token, scope) {
    state.token = token;
    state.mode = "key";
    sessionStorage.setItem(SS.token, token);
    el.mode.textContent = scope?.includes("usage") ? "your own pollen" : "your own key";
    el.mode.classList.add("on");
    el.signin.classList.add("hidden");
    el.signout.classList.remove("hidden");
    el.signinBox.open = false;
    el.startNote.textContent = "Signed in. Pictures come from gen.pollinations.ai and are billed to your own Pollen.";
    syncMode();
    refreshWallet();
    loadModels();
    savePrefs();
}

function signOut() {
    state.token = "";
    state.mode = "free";
    sessionStorage.removeItem(SS.token);
    el.mode.textContent = "free preview";
    el.mode.classList.remove("on");
    el.signin.classList.remove("hidden");
    el.signout.classList.add("hidden");
    el.wallet.classList.add("hidden");
    el.startNote.textContent = "Free preview: three views on the shared endpoint. Sign in to keep walking, choose models, and let a vision model find the spots — on your own Pollen.";
    syncMode();
}

async function startAuth() {
    const appkey = el.appkey.value.trim();
    if (appkey) localStorage.setItem(APPKEY, appkey);
    else localStorage.removeItem(APPKEY);
    savePrefs();
    const verifier = randomToken(32);
    const nonce = randomToken(16);
    sessionStorage.setItem(SS.verifier, verifier);
    sessionStorage.setItem(SS.state, nonce);
    const params = new URLSearchParams({
        response_type: "code",
        redirect_uri: APP_URL,
        client_id: appkey || location.hostname,
        scope: "profile usage",
        state: nonce,
        code_challenge: await s256(verifier),
        code_challenge_method: "S256",
        expiry: "30",
        budget: "25",
    });
    location.href = `${ENTER}/authorize?${params}`;
}

async function finishAuth(code, returnedState) {
    const verifier = sessionStorage.getItem(SS.verifier);
    const expected = sessionStorage.getItem(SS.state);
    sessionStorage.removeItem(SS.verifier);
    sessionStorage.removeItem(SS.state);
    if (!verifier) throw new Error("That sign-in attempt expired. Press sign in again.");
    if (expected && returnedState && expected !== returnedState) throw new Error("The sign-in state did not match. Press sign in again.");
    const appkey = localStorage.getItem(APPKEY);
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: APP_URL,
        code_verifier: verifier,
        client_id: appkey || location.hostname,
    });
    const response = await fetch(`${ENTER}/api/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!response.ok) throw new Error(await apiError(response, "sign-in"));
    const data = await response.json();
    if (!data?.access_token) throw new Error("No key came back from sign-in.");
    useKey(data.access_token, data.scope || "");
}

async function refreshWallet() {
    if (!state.token) {
        el.wallet.classList.add("hidden");
        return;
    }
    try {
        const response = await fetch(`${GEN}/account/balance`, { headers: authHeaders() });
        if (!response.ok) return;
        const value = findNumber(await response.json());
        if (value === null) return;
        el.wallet.textContent = `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} pollen`;
        el.wallet.title = "Your Pollinations balance";
        el.wallet.classList.remove("hidden");
    } catch {
        // the balance chip is a nicety, never a blocker
    }
}

function findNumber(data, depth = 0) {
    if (depth > 2 || !data || typeof data !== "object") return null;
    for (const key of ["pollen", "balance", "available", "remaining", "total", "amount"]) {
        if (typeof data[key] === "number") return data[key];
    }
    for (const value of Object.values(data)) {
        const found = findNumber(value, depth + 1);
        if (found !== null) return found;
    }
    return null;
}

/* --------------------------------------------------------------------- models */

async function listModels(kind) {
    const response = await fetch(`${GEN}/${kind}/models`);
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data) ? data : data?.data ?? [];
    return list.filter((model) => model && typeof model === "object");
}

// The spotter has to read the picture, so only models that take an image in are
// offered. Community entries stay out: this picker is for people paying their
// own Pollen, and the catalog is long enough without them.
function spotterModels(models) {
    return models
        .filter((model) => !model.community && Array.isArray(model.input_modalities) && model.input_modalities.includes("image"))
        .map((model) => model.name)
        .filter(Boolean);
}

async function loadModels() {
    if (state.mode !== "key") return;
    try {
        const [images, texts] = await Promise.all([listModels("image"), listModels("text")]);
        fillSelect(
            el.imageModel,
            images.map((model) => ({ value: model.name, label: model.name })).filter((item) => item.value),
            state.imageModel,
            "Server default",
        );
        fillSelect(el.visionModel, spotterModels(texts).map((name) => ({ value: name, label: name })), state.visionModel, null);
    } catch {
        // keep whatever is already in the selects
    }
}

function fillSelect(select, items, selected, placeholder) {
    select.innerHTML = "";
    if (placeholder) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = placeholder;
        select.append(option);
    }
    for (const item of items) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        select.append(option);
    }
    if (selected) {
        if (![...select.options].some((option) => option.value === selected)) {
            const option = document.createElement("option");
            option.value = selected;
            option.textContent = selected;
            select.prepend(option);
        }
        select.value = selected;
    }
    if (!select.value && select.options.length) select.selectedIndex = 0;
}

function syncMode() {
    const free = state.mode === "free";
    el.imageModel.disabled = free;
    el.visionModel.disabled = free;
    el.imageModel.title = free ? "Sign in to choose a picture model" : "";
    el.visionModel.title = free ? "Sign in to choose a spotter model" : "";
}

/* ---------------------------------------------------------------- walk links */

function walkLink() {
    const payload = {
        v: 1,
        y: state.styleId,
        p: state.steps.map((step) => [step.prompt, step.seed, step.label, step.next || "", step.cell || 5]),
    };
    return `${APP_URL}#p=${b64url(JSON.stringify(payload))}`;
}

function readReplay() {
    const match = location.hash.match(/^#p=(.+)$/);
    if (!match) return null;
    try {
        const payload = JSON.parse(unb64url(match[1]));
        const steps = Array.isArray(payload?.p) ? payload.p.filter((entry) => Array.isArray(entry) && entry.length >= 4) : [];
        if (!steps.length) return null;
        return { styleId: typeof payload.y === "string" ? payload.y : STYLES[0].id, p: steps };
    } catch {
        return null;
    }
}

/* ---------------------------------------------------------------- persistence */

function savePrefs() {
    try {
        localStorage.setItem(PREF, JSON.stringify({
            scene: el.scene.value,
            styleId: state.styleId,
            imageModel: state.imageModel,
            visionModel: state.visionModel,
            keepLook: state.keepLook,
        }));
    } catch {
        // private mode; preferences are optional
    }
}

function loadPrefs() {
    let prefs = {};
    try {
        prefs = JSON.parse(localStorage.getItem(PREF) || "{}");
    } catch {
        prefs = {};
    }
    if (typeof prefs.scene === "string") el.scene.value = prefs.scene;
    if (STYLES.some((s) => s.id === prefs.styleId)) state.styleId = prefs.styleId;
    if (typeof prefs.imageModel === "string") state.imageModel = prefs.imageModel;
    if (typeof prefs.visionModel === "string" && prefs.visionModel) state.visionModel = prefs.visionModel;
    if (typeof prefs.keepLook === "boolean") state.keepLook = prefs.keepLook;
    el.appkey.value = localStorage.getItem(APPKEY) || "";
}

/* --------------------------------------------------------------------- start */

async function handleRedirect() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const failure = params.get("error");
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    const fragmentKey = fragment.get("api_key");
    if (code) {
        try {
            await finishAuth(code, params.get("state"));
            toast("Signed in. Your own Pollen pays for what you paint.");
        } catch (error) {
            toast(error.message);
        }
        history.replaceState(null, "", APP_URL);
        return;
    }
    if (failure) {
        toast(failure === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed: ${failure}.`);
        history.replaceState(null, "", APP_URL);
        return;
    }
    if (fragmentKey) {
        useKey(fragmentKey, "usage");
        history.replaceState(null, "", APP_URL);
    }
}

function wire() {
    el.enter.addEventListener("click", () => startWorld());
    el.surprise.addEventListener("click", () => {
        el.scene.value = SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
        startWorld();
    });
    el.style.addEventListener("change", () => {
        state.styleId = el.style.value;
        savePrefs();
    });
    el.imageModel.addEventListener("change", () => {
        state.imageModel = el.imageModel.value;
        savePrefs();
    });
    el.visionModel.addEventListener("change", () => {
        state.visionModel = el.visionModel.value || "openai";
        savePrefs();
    });
    el.keepLook.addEventListener("change", () => {
        state.keepLook = el.keepLook.checked;
        savePrefs();
    });
    el.scene.addEventListener("input", savePrefs);
    el.oauth.addEventListener("click", () => startAuth().catch((error) => toast(error.message)));
    el.keyhelp.addEventListener("click", () => el.keybox.classList.toggle("hidden"));
    el.usekey.addEventListener("click", () => {
        const key = el.pastekey.value.trim();
        if (!key.startsWith("sk_")) {
            toast("That does not look like a Pollinations key (they start with sk_).");
            return;
        }
        el.pastekey.value = "";
        useKey(key, "usage");
        toast("Key accepted. It stays in this tab and is never stored on disk.");
    });
    el.signin.addEventListener("click", () => {
        el.signinBox.open = true;
        el.signinBox.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    el.signout.addEventListener("click", signOut);
    el.save.addEventListener("click", () => {
        const step = current();
        if (!step?.blob) return;
        const extension = step.blob.type.includes("png") ? "png" : "jpg";
        const link = document.createElement("a");
        link.href = step.objectUrl;
        link.download = `postcard-${state.index + 1}.${extension}`;
        link.click();
    });
    el.link.addEventListener("click", async () => {
        const url = walkLink();
        try {
            await navigator.clipboard.writeText(url);
            toast("Walk link copied. Anyone can replay this walk; in the free preview it repaints without a key.");
        } catch {
            toast(url, 15000);
        }
    });
    el.restart.addEventListener("click", () => {
        state.steps = [];
        state.replay = null;
        el.replayNote.classList.add("hidden");
        el.explore.classList.add("hidden");
        el.start.classList.remove("hidden");
        el.scene.focus();
    });
}

function init() {
    for (const id of ["scene", "style", "image-model", "vision-model", "keep-look", "enter", "surprise", "start-note",
        "signin-box", "oauth", "keyhelp", "keybox", "pastekey", "usekey", "appkey", "auth-note", "signin", "signout",
        "wallet", "mode", "start", "explore", "replay-note", "crumbs", "view", "spots", "loading", "loading-text",
        "step-label", "step-prompt", "save", "link", "restart", "toast"]) {
        el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = $(id);
    }

    fillSelect(el.style, STYLES.map((item) => ({ value: item.id, label: item.name })), state.styleId, null);
    fillSelect(el.imageModel, [], "", "Server default");
    fillSelect(el.visionModel, [{ value: "openai", label: "openai (Pollinations default)" }], "openai", null);

    loadPrefs();
    el.style.value = state.styleId;
    el.keepLook.checked = state.keepLook;
    el.mode.textContent = "free preview";
    el.startNote.textContent = "Free preview: three views on the shared endpoint. Sign in to keep walking, choose models, and let a vision model find the spots — on your own Pollen.";

    wire();

    const saved = sessionStorage.getItem(SS.token);
    if (saved) useKey(saved, "");
    else syncMode();

    state.replay = readReplay();
    if (state.replay) {
        state.styleId = state.replay.styleId;
        el.style.value = state.styleId;
        el.scene.value = state.replay.p[0][0];
        el.replayNote.classList.remove("hidden");
        el.replayNote.textContent = `A recorded walk of ${state.replay.p.length} view${state.replay.p.length === 1 ? "" : "s"} is ready. Press “Step in” to walk it again — each picture is repainted from the recorded prompt and seed.`;
        el.startNote.textContent = "This page was opened from a walk link.";
    }

    handleRedirect().then(loadModels);
}

document.addEventListener("DOMContentLoaded", init);
