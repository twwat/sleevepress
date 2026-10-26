/* Sleeve Press: Library view. Save the release you're on, open saved ones, keep flagged looks,
   the record label (name + logo) that carries across releases, a catalogue sheet, and backups. */
(function () {
"use strict";
const h = App.h, SR = SleeveRender;

/* ---------- "unsaved changes": compare the record with what was last saved / opened ---------- */
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = norm(v[k]); return o; }
  return v;
}
function sig(rec) { const r = SP.clone(rec); delete r.looks; delete r.libId; delete r.exported; return JSON.stringify(norm(r)); }
let coverV = 0, baseline = null;   // baseline: { json, coverV, ts }
let baselineSynced = () => {};     // the view repaints its "saved / unsaved" note
SP.cover.on(() => { coverV++; });
function markClean(rec) { baseline = { json: sig(rec || SP.get()), coverV, ts: Date.now() }; }
const isDirty = () => !baseline || baseline.json !== sig(SP.get()) || baseline.coverV !== coverV;
async function syncBaseline() {
  const id = SP.get().libId; if (!id) return;
  const idx = await SP.library.list(), e = idx.find(x => x.id === id);
  if (!e || (baseline && baseline.ts >= e.updated)) return;
  const stored = await SP.vault.get("lib." + id);
  if (stored && stored.record) { markClean(stored.record); baseline.ts = e.updated; baselineSynced(); }
}
SP.library.on(syncBaseline);
syncBaseline();

/* ---------- small helpers ---------- */
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: s > 300 * 86400 ? "numeric" : undefined });
}
const relName = (r) => [r.artist, SP.titleLine(r)].filter(Boolean).join(" — ") || "Untitled";
function inlineRename(nameEl, current, onDone) {
  const inp = h("input", { type: "text", class: "lb-rename", value: current, "aria-label": "New name", maxlength: "120" });
  nameEl.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (keep) => { if (done) return; done = true; const v = inp.value.trim(); inp.replaceWith(nameEl); if (keep && v && v !== current) onDone(v); };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
}
function lookState(look) {
  const st = { ...App.state() };
  for (const k of SR.LOOK_KEYS) if (k in look) st[k] = look[k];
  for (const k of SR.PALETTE_KEYS) if (look[k]) st[k] = look[k];
  return st;
}

App.view("library", {
  label: "Library",
  mount(el) {
    const v = this; v.visible = false;
    const q = App.queue();

    /* ---- file input shared by "Open release.json" and "Restore" ---- */
    const file = h("input", { type: "file", id: "lb-file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files[0]; file.value = ""; if (!f) return;
      const kind = await SP.importFile(f);
      if (kind === "release") { if (SP.get().libId) { baseline = null; await syncBaseline(); } else baseline = null; }
      refreshAll();
    });
    const pick = () => file.click();

    /* ---- head + memory warning ---- */
    const warn = h("div", { class: "lb-warn", id: "lb-warn", role: "alert", hidden: true },
      h("b", {}, "This browser isn't keeping anything for this page."),
      h("p", {}, "Saved releases, flagged looks and your logo only last until you reload or close the tab (private window, or the browser blocks storage for this page). Back up everything before you leave, and open the backup next time."),
      h("button", { type: "button", class: "btn primary small", onclick: () => SP.library.backup() }, "Back up everything now"));
    const showWarn = (s) => { warn.hidden = s !== "memory"; };
    SP.onStatus(showWarn); showWarn(SP.status());

    /* ---- 1. This release ---- */
    const curCanvas = h("canvas", { width: 360, height: 360, id: "lb-cur-thumb" });
    const curName = h("b", { class: "lb-cur-name" }), curMeta = h("span", { class: "lb-cur-meta" }), curState = h("span", { class: "lb-state" });
    const nextHint = h("p", { class: "hint" });
    const btnSave = h("button", { type: "button", class: "btn primary", id: "lb-save", onclick: async () => { await App.saveToLibrary(); } }, "Save");
    const btnCopy = h("button", { type: "button", class: "btn", id: "lb-save-new", onclick: async () => { await App.saveToLibrary(true); } }, "Save as new copy");
    const btnNext = h("button", { type: "button", class: "btn", id: "lb-next", onclick: () => {
      if (isDirty() && !confirm("This release has unsaved changes. Start the next one anyway? (Save first to keep them.)")) return;
      App.nextRelease(); baseline = null; setTimeout(() => { markClean(); refreshCurrent(); }, 150);
    } }, "Next in series");
    const btnBlank = h("button", { type: "button", class: "btn", id: "lb-blank", onclick: async () => {
      if (!confirm(isDirty() ? "Start a blank release? Unsaved changes to this one will be lost." : "Start a blank release?")) return;
      App.checkpoint(true); await SP.reset(); markClean(); refreshAll();
    } }, "Start blank");
    const secCurrent = h("section", { class: "panel lb-current", id: "lb-current" },
      h("h2", {}, "This release", curState),
      h("div", { class: "lb-cur" }, h("div", { class: "lb-cur-art" }, curCanvas), h("div", { class: "lb-cur-txt" }, curName, curMeta)),
      h("div", { class: "btn-row" }, btnSave, btnCopy),
      h("div", { class: "btn-row" }, btnNext, btnBlank),
      nextHint,
      h("div", { class: "btn-row lb-files" },
        h("button", { type: "button", class: "btn small", id: "lb-download", onclick: () => SP.downloadRelease() }, "Download release.json"),
        h("button", { type: "button", class: "btn small", id: "lb-open-file", onclick: pick }, "Open release.json / backup")),
      file);
    const drawCurrent = SP.debounce(() => q(async () => { if (v.visible) await App.thumb(curCanvas); }), 200);
    function refreshCurrent() {
      const d = SP.get(), r = d.release;
      curName.textContent = relName(r);
      curMeta.textContent = [r.catalog, r.format, d.tracks.length ? d.tracks.length + " tracks" : ""].filter(Boolean).join(" · ");
      const dirty = isDirty();
      curState.textContent = !d.libId ? "not in library yet" : dirty ? "unsaved changes" : "saved";
      curState.className = "lb-state " + (!d.libId || dirty ? "warn" : "ok");
      btnSave.textContent = d.libId ? "Save" : "Save to library";
      const m = /^(.*?)(\d+)(\D*)$/.exec(r.catalog || "");
      const nxt = m ? m[1] + String(+m[2] + 1).padStart(m[2].length, "0") + m[3] : "";
      nextHint.textContent = `Next in series starts ${nxt || "a new release"} with this look and label: words, tracks and picture cleared.`;
      drawCurrent();
    }

    /* ---- 2. Saved releases ---- */
    const search = h("input", { type: "search", class: "lb-search", id: "lb-search", placeholder: "Find a release or catalogue number", "aria-label": "Search saved releases", hidden: true });
    const savedGrid = h("div", { class: "tile-grid lb-grid", id: "lb-saved" });
    const savedCount = h("small");
    const secSaved = h("section", { class: "panel lb-saved" }, h("h2", {}, "Saved releases", savedCount), search, savedGrid);
    let entries = [];
    search.addEventListener("input", () => drawSaved());
    async function openEntry(e, then) {
      if (isDirty() && !confirm(`The release you're on has unsaved changes. Open “${e.name}” anyway?`)) return false;
      App.checkpoint(true);
      const ok = await SP.library.open(e.id);
      if (!ok) { SP.toast("Couldn't find that saved release."); return false; }
      markClean(); baseline.ts = e.updated;
      if (then) await then(); else SP.toast(`Opened ${e.name}`);
      refreshAll(); return true;
    }
    function drawSaved() {
      const cur = SP.get().libId, term = search.value.trim().toLowerCase();
      search.hidden = entries.length <= 8;
      savedCount.textContent = entries.length ? `${entries.length} saved` : "";
      const list = entries.filter(e => !term || search.hidden || (e.name + " " + (e.catalog || "")).toLowerCase().includes(term));
      savedGrid.replaceChildren();
      if (!entries.length) {
        savedGrid.append(h("div", { class: "empty lb-empty" }, "Nothing saved yet. Press ", h("b", {}, "Save"), " above (or Ctrl+S anywhere) to keep this release here, with its picture."));
        return;
      }
      if (!list.length) { savedGrid.append(h("div", { class: "empty lb-empty" }, "No saved release matches that.")); return; }
      for (const e of list) {
        const name = h("b", { class: "lb-name", title: e.name }, e.name);
        const tile = h("article", { class: "tile lb-tile" + (e.id === cur ? " is-current" : ""), "data-id": e.id },
          e.thumb ? h("img", { src: e.thumb, alt: "", loading: "lazy" }) : h("div", { class: "lb-nothumb" }, e.catalog || "—"),
          e.id === cur ? h("span", { class: "lb-flag" }, "open now") : null,
          h("div", { class: "lb-cap" }, name, h("span", {}, [e.catalog, ago(e.updated)].filter(Boolean).join(" · "))),
          h("div", { class: "lb-acts" },
            h("button", { type: "button", class: "btn small", "data-act": "open", onclick: () => openEntry(e) }, "Open"),
            h("button", { type: "button", class: "btn small", "data-act": "rename", onclick: () => inlineRename(name, e.name, n => SP.library.rename(e.id, n)) }, "Rename"),
            h("button", { type: "button", class: "btn small", "data-act": "dup", onclick: () => openEntry(e, async () => { const id = await App.saveToLibrary(true); await SP.library.rename(id, e.name + " (copy)"); }) }, "Duplicate"),
            h("button", { type: "button", class: "btn small lb-del", "data-act": "delete", "aria-label": "Delete " + e.name, onclick: async () => {
              if (!confirm(`Delete “${e.name}” from your library? This can't be undone.`)) return;
              await SP.library.remove(e.id);
              if (SP.get().libId === e.id) { const d = SP.clone(SP.get()); delete d.libId; SP.replace(d); baseline = null; }
              SP.toast("Deleted");
            } }, "Delete")));
        savedGrid.append(tile);
      }
    }
    async function refreshSaved() { entries = (await SP.library.list()).slice().sort((a, b) => b.updated - a.updated); drawSaved(); drawSheet(); }

    /* ---- 3. Flagged looks ---- */
    const lookGrid = h("div", { class: "tile-grid lb-grid", id: "lb-looks" });
    const lookCount = h("small");
    const secLooks = h("section", { class: "panel lb-looks" }, h("h2", {}, "Flagged looks", lookCount),
      h("p", { class: "hint" }, "Looks you flagged, shown with this release's words and picture."), lookGrid);
    let lookTiles = new Map(), lazyLooks = null;
    function drawLookTile(tile) {
      const l = tile._look, c = tile.querySelector("canvas"), st = lookState(l.look), key = JSON.stringify(st) + "|" + coverV;
      if (tile._key === key) return; tile._key = key;
      q(async () => { if (tile.isConnected) await App.thumb(c, st); });
    }
    function drawLooks() {
      const looks = App.flagged();
      lookCount.textContent = looks.length ? `${looks.length} flagged` : "";
      if (!looks.length) {
        lookTiles.clear(); lookGrid.replaceChildren(h("div", { class: "empty lb-empty" }, "No flagged looks yet. In ",
          h("a", { href: "#discover" }, "Discover"), ", flag the covers you like and they'll wait here to use on any release."));
        return;
      }
      if (lazyLooks && lazyLooks.stop) lazyLooks.stop();
      lazyLooks = App.lazy(drawLookTile, "300px");
      const next = new Map(); lookGrid.replaceChildren();
      for (const l of looks) {
        let tile = lookTiles.get(l.id);
        if (!tile) {
          const name = h("b", { class: "lb-name" });
          tile = h("article", { class: "tile lb-tile", "data-id": l.id },
            h("canvas", { width: 320, height: 320 }),
            h("div", { class: "lb-cap" }, name, h("span", { class: "lb-pal" })),
            h("div", { class: "lb-acts" },
              h("button", { type: "button", class: "btn small primary", "data-act": "apply", onclick: () => { App.applyLook(tile._look.look); SP.toast(`Applied ${tile._look.name}`); App.go("design"); } }, "Apply to this release"),
              h("button", { type: "button", class: "btn small", "data-act": "rename", onclick: () => inlineRename(name, tile._look.name, n => SP.set("looks", App.flagged().map(x => x.id === l.id ? { ...x, name: n } : x))) }, "Rename"),
              h("button", { type: "button", class: "btn small lb-del", "data-act": "remove", onclick: () => { App.unflag(l.id); SP.toast("Removed from flagged looks"); } }, "Remove")));
        }
        tile._look = l;
        tile.querySelector(".lb-name").textContent = l.name; tile.querySelector(".lb-name").title = l.name;
        const p = tile.querySelector(".lb-pal"); p.replaceChildren(...["bg", "ink", "accent"].map(k => h("i", { style: { background: l.look[k] || "#000" } })), " " + ago(l.ts));
        next.set(l.id, tile); lookGrid.append(tile);
        if (tile._key) drawLookTile(tile); else lazyLooks.watch(tile);
      }
      lookTiles = next;
    }

    /* ---- 4. Record label ---- */
    const labelIn = h("input", { type: "text", id: "lb-label", maxlength: "60", autocomplete: "off" });
    labelIn.addEventListener("input", SP.debounce(() => App.commit({ ...App.state(), label: labelIn.value }), 250));
    const logoFile = h("input", { type: "file", id: "lb-logo-file", accept: "image/*" });
    const dropText = h("span", {}, "Drop your logo here, or tap to choose");
    const drop = h("label", { class: "file-drop lb-drop", id: "lb-logo-drop" }, logoFile, dropText);
    const logoInfo = h("span"), logoMeta = h("div", { class: "img-meta", hidden: true }, logoInfo,
      h("button", { type: "button", id: "lb-logo-clear", onclick: () => { if (confirm("Remove the label logo from every release?")) SP.logo.clear(); } }, "remove"));
    const preview = h("div", { class: "lb-logo-prev", id: "lb-logo-prev" });
    const segMark = h("div", { class: "seg lb-mark", id: "lb-mark", role: "group", "aria-label": "Label mark on the sleeve" },
      ...[["none", "None"], ["text", "Text"], ["box", "Box"], ["stamp", "Stamp"], ["logo", "Logo"]].map(([k, t]) => h("button", { type: "button", "data-v": k }, t)));
    const refreshSeg = SP.bindSeg(segMark, () => App.state().labelMark, (k) => {
      App.commit({ ...App.state(), labelMark: k });
      if (k === "logo" && !SP.logo.meta()) SP.toast("Add a logo below so it shows on the sleeve");
    });
    const markCanvas = h("canvas", { width: 360, height: 360, class: "lb-mark-thumb" });
    const secLabel = h("section", { class: "panel lb-label" }, h("h2", {}, "Record label"),
      h("label", { class: "f" }, h("span", {}, "Label name"), labelIn),
      h("div", { class: "lb-logo-row" },
        h("div", { class: "lb-logo-in" }, h("div", { class: "legend" }, "Label logo"), drop, logoMeta),
        preview),
      h("div", { class: "f" }, h("div", { class: "legend" }, "Show label mark on the sleeve"), segMark),
      h("p", { class: "hint" }, "Your label and logo carry over to every release: the logo is kept once, not per release, and Next in series copies the label name."));
    let logoUrl = null;
    SP.bindDrop(SP.logo, { drop, input: logoFile, onText: async (im, meta) => {
      logoMeta.hidden = !im; dropText.textContent = im ? "Drop a new logo to replace it" : "Drop your logo here, or tap to choose";
      logoInfo.textContent = im && meta ? `${meta.name || "logo"} · ${meta.w}×${meta.h}` : "";
      logoUrl = im ? await SP.logo.data() : null; drawPreview(); drawCurrent();
    } });
    function drawPreview() {
      const d = SP.get();
      preview.style.background = d.palette.bg; preview.style.color = d.palette.ink;
      preview.replaceChildren(logoUrl ? h("img", { src: logoUrl, alt: "Label logo on the cover's ground colour" })
        : h("span", {}, (d.release.label || "No logo yet").toUpperCase()));
    }
    function refreshLabel() {
      if (document.activeElement !== labelIn) labelIn.value = SP.get().release.label || "";
      refreshSeg(); drawPreview();
    }

    /* ---- 5. Catalogue sheet ---- */
    const sheetCanvas = h("canvas", { id: "lb-sheet-canvas", width: 10, height: 10 });
    const secSheet = h("section", { class: "panel lb-sheet", hidden: true }, h("h2", {}, "Catalogue sheet", h("small", {}, "your label's discography at a glance")),
      h("div", { class: "lb-sheet-wrap" }, sheetCanvas),
      h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn small", id: "lb-sheet-dl", onclick: async () => {
        const b = await SP.canvasBlob(sheetCanvas); SP.download(b, `${SP.safeName(SP.get().release.label || "label")}_catalogue.png`, "image/png");
      } }, "Download PNG")));
    const loadImg = (src) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    let sheetJob = 0;
    const drawSheet = SP.debounce(() => q(async () => {
      const job = ++sheetJob;
      const list = entries.slice().sort((a, b) => String(a.catalog || "").localeCompare(String(b.catalog || ""), undefined, { numeric: true }));
      secSheet.hidden = list.length < 2; if (list.length < 2 || !v.visible) return;
      const d = SP.get(), bg = d.palette.bg, ink = d.palette.ink, accent = d.palette.accent;
      const n = list.length, cols = n <= 4 ? n : Math.min(6, Math.ceil(Math.sqrt(n * 1.4))), rows = Math.ceil(n / cols);
      const cell = 300, gap = 28, cap = 58, pad = 48, head = 96;
      const W = pad * 2 + cols * cell + (cols - 1) * gap, H = pad + head + rows * (cell + cap) + (rows - 1) * gap + pad;
      try { await Promise.all([document.fonts.load("800 40px Archivo"), document.fonts.load("500 20px 'IBM Plex Mono'")]); } catch (e) {}
      const imgs = await Promise.all(list.map(e => e.thumb ? loadImg(e.thumb) : null));
      if (job !== sheetJob) return;
      const c = sheetCanvas; c.width = W; c.height = H; const g = c.getContext("2d");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = ink; g.textBaseline = "alphabetic";
      g.font = "800 40px Archivo, 'Helvetica Neue', Arial, sans-serif";
      g.fillText((d.release.label || "Catalogue").toUpperCase(), pad, pad + 40, W - pad * 2 - 160);
      g.font = "500 18px 'IBM Plex Mono', Menlo, monospace"; g.globalAlpha = 0.6;
      g.fillText(`${n} releases`, pad, pad + 72); g.textAlign = "right";
      g.fillText(new Date().getFullYear(), W - pad, pad + 40); g.textAlign = "left"; g.globalAlpha = 1;
      g.fillStyle = accent; g.fillRect(pad, pad + head - 14, W - pad * 2, 3);
      list.forEach((e, i) => {
        const x = pad + (i % cols) * (cell + gap), y = pad + head + Math.floor(i / cols) * (cell + cap + gap);
        if (imgs[i]) g.drawImage(imgs[i], x, y, cell, cell); else { g.fillStyle = "rgba(127,127,127,.25)"; g.fillRect(x, y, cell, cell); }
        g.fillStyle = ink; g.font = "500 20px 'IBM Plex Mono', Menlo, monospace";
        g.fillText(e.catalog || "—", x, y + cell + 28, cell);
        g.globalAlpha = 0.6; g.font = "400 15px 'IBM Plex Mono', Menlo, monospace";
        let t = e.name; while (t.length > 3 && g.measureText(t).width > cell) t = t.slice(0, -2);
        g.fillText(t === e.name ? t : t.trimEnd() + "…", x, y + cell + 50); g.globalAlpha = 1;
      });
    }), 250);

    /* ---- 6. Back up / restore ---- */
    const secBackup = h("section", { class: "panel lb-backup" }, h("h2", {}, "Back up / restore"),
      h("p", { class: "hint" }, "One file with every saved release (and its picture), your flagged looks and your logo. Keep it somewhere safe, or use it to move to another computer."),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn", id: "lb-backup", onclick: async () => { await SP.library.backup(); SP.toast("Backup downloaded"); } }, "Back up everything"),
        h("button", { type: "button", class: "btn", id: "lb-restore", onclick: pick }, "Restore from a backup")),
      h("p", { class: "hint" }, "Restoring adds to what's here; releases with the same id are replaced."));

    /* ---- layout ---- */
    el.append(
      h("div", { class: "view-head" }, h("div", {}, h("h1", {}, "Library"), h("p", {}, "Save releases to come back to, keep looks you like, and set up your label once."))),
      warn,
      h("div", { class: "lb-layout" },
        h("div", { class: "lb-side" }, secCurrent, secLabel, secBackup),
        h("div", { class: "lb-main" }, secSaved, secLooks, secSheet)));

    /* ---- refresh wiring ---- */
    function refreshAll() { refreshCurrent(); refreshLabel(); refreshSaved(); drawLooks(); }
    v.refreshAll = refreshAll;
    baselineSynced = () => { if (v.visible) refreshCurrent(); };
    let looksSig = "";
    const onRecord = SP.debounce(() => {
      if (!v.visible) return;
      refreshCurrent(); refreshLabel();
      const s = JSON.stringify(App.flagged().map(l => [l.id, l.name]));
      if (s !== looksSig) { looksSig = s; drawLooks(); } else lookTiles.forEach(t => { if (t._key) drawLookTile(t); });
      drawSheet();
    }, 150);
    SP.on(onRecord); SP.cover.on(onRecord);
    SP.library.on(() => { if (v.visible) { refreshSaved(); refreshCurrent(); } });
  },
  show() { this.visible = true; this.refreshAll(); },
  hide() { this.visible = false; },
});
})();
