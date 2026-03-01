/**
 * app.js
 * Code stays in English (developer-friendly).
 * UI texts are shown in Catalan (user-friendly).
 */

/* =========================
   1) Catalan UI dictionary (i18n)
   ========================= */

const I18N = {
  loading: "Carregant...",
  errorLoadingData: "Error carregant dades",
  noResults: "Cap resultat",
  unknown: "Desconegut",
  expandCollapse: "Desplegar / col·lapsar",
  noSubdivisions: "Sense subdivisions",
  typeLabel: "Tipus",
  populationLabel: "Habitants",
  idLabel: "ID",
  demoAlertPrefix: "(DEMO) Entraries al xat de"
};

/* =========================
   DEMO config (no backend)
   - Only one territory works: sant-cugat-centre-estacio
   - Only 4 adjectives are actionable
   - If adjective has link in demo/group_links.json => open group
   - Else => open bot deep-link /start demo_<territory_id>_<topic_id>
   ========================= */

const DEMO = {
  config: null,
  groupLinks: {},
  allowedTerritoryId: "sant-cugat-centre-estacio",
  allowedPathIds: new Set(), // filled after territories load
  allowedAdjectives: [],
  allowedAdjByNorm: new Map(),
  botUsername: "PeuMiApp_bot"
};

function inTelegram() {
  return !!(window.Telegram && window.Telegram.WebApp);
}

function tgOpen(url) {
  if (!url) return;
  if (inTelegram()) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    // Prefer Telegram link opener for t.me links
    if (/^https?:\/\/t\.me\//i.test(url)) tg.openTelegramLink(url);
    else tg.openLink(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function loadDemoFiles() {
  try {
    const [cfg, links] = await Promise.all([
      fetch("./demo/demo_config.json", { cache: "no-cache" }).then(r => r.json()),
      fetch("./demo/group_links.json", { cache: "no-cache" }).then(r => r.json())
    ]);
    DEMO.config = cfg;
    DEMO.groupLinks = links || {};
    DEMO.allowedTerritoryId = cfg.allowed_territory_id || DEMO.allowedTerritoryId;
    DEMO.allowedAdjectives = Array.isArray(cfg.allowed_adjectives) ? cfg.allowed_adjectives : [];
    DEMO.allowedAdjByNorm = new Map(DEMO.allowedAdjectives.map(a => [a.norm, a]));
    DEMO.botUsername = cfg.bot_username || DEMO.botUsername;
  } catch (e) {
    console.warn("DEMO config not found, continuing with defaults.", e);
  }
}

function buildStartPayload(territoryId, topicId) {
  return `demo_${territoryId}_${topicId}`;
}

function openBotDeepLink(territoryId, topicId) {
  const payload = buildStartPayload(territoryId, topicId);
  const url = `https://t.me/${DEMO.botUsername}?start=${encodeURIComponent(payload)}`;
  tgOpen(url);
}



// Translate the territory "type" field (from JSON) into Catalan labels
const TYPE_CA = {
  region: "comarca",
  municipality: "municipi",     // (normalment no el mostrem, però el deixo per si el fas servir)
  city: "ciutat",
  town: "poble",
  district: "districte",
  neighborhood: "barri"
};

/* =========================
   2) Helper functions
   ========================= */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset" && value && typeof value === "object") {
      for (const [dKey, dVal] of Object.entries(value)) node.dataset[dKey] = dVal;
    } else if (value !== undefined) {
      node[key] = value;
    }
  }

  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

// Small helper to translate types safely
function typeToCatalan(type) {
  return TYPE_CA[type] || type; // fallback: if unknown type, show original
}

/* =========================
   3) App state
   ========================= */

let root = null;
const byId = new Map();
const parentById = new Map();
let flatIndex = [];
let currentId = null;

/* =========================
   4) Load JSON with fetch()
   ========================= */

async function loadTerritories() {
  const res = await fetch("./data/territories.json");
  if (!res.ok) {
    throw new Error("Failed to load territories.json. HTTP status: " + res.status);
  }
  return await res.json();
}

/* =========================
   5) Index the tree
   ========================= */

function indexTree(node, parentId = null, pathNames = []) {
  byId.set(node.id, node);
  parentById.set(node.id, parentId);

  const newPath = [...pathNames, node.name];

  flatIndex.push({
    id: node.id,
    name: node.name,
    type: node.type,
    population: node.population,
    path: newPath.join(" > "),
    hasChildren: Array.isArray(node.children) && node.children.length > 0,
    searchKey: normalize(node.name + " " + newPath.join(" "))
  });

  for (const child of node.children || []) {
    indexTree(child, node.id, newPath);
  }
}

/* =========================
   6) Render tree
   ========================= */

function renderTree(container, node, depth = 0) {
  const hasChildren = node.children && node.children.length > 0;

  const toggleBtn = el(
    "button",
    {
      className: "toggle",
      disabled: !hasChildren,
      title: hasChildren ? I18N.expandCollapse : I18N.noSubdivisions,
      "aria-expanded": "false",
      onClick: (e) => {
        e.stopPropagation();
        const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
        toggleBtn.setAttribute("aria-expanded", expanded ? "false" : "true");
        childrenWrap.style.display = expanded ? "none" : "block";
        toggleBtn.textContent = expanded ? "▸" : "▾";
      }
    },
    hasChildren ? "▸" : "·"
  );

  const enterBtn = el(
    "button",
    { className: "enter", onClick: () => enterTerritory(node.id) },
    `${node.name} `,
    el("span", { className: "pill" }, typeToCatalan(node.type))
  );

  const row = el("div", { className: `row indent-${Math.min(depth, 2)}` }, toggleBtn, enterBtn);
  container.appendChild(row);

  const childrenWrap = el("div", { style: "display:none;" });
  container.appendChild(childrenWrap);

  if (hasChildren) {
    for (const child of node.children) {
      renderTree(childrenWrap, child, depth + 1);
    }
  }
}

/* =========================
   7) Enter territory (right panel)
   ========================= */

function buildBreadcrumbs(id) {
  const names = [];
  let cur = id;

  while (cur) {
    const node = byId.get(cur);
    if (!node) break;
    names.push(node.name);
    cur = parentById.get(cur);
  }

  return names.reverse().join(" > ");
}

function enterTerritory(id) {
  // DEMO: only allow navigating within the allowed path (ancestors + target).
  if (DEMO.allowedPathIds.size && !DEMO.allowedPathIds.has(id)) {
    alert(`DEMO: només funciona ${byId.get(DEMO.allowedTerritoryId)?.name || DEMO.allowedTerritoryId}`);
    return;
  }
  currentId = id;
  const node = byId.get(id);

  document.getElementById("viewTitle").textContent = node.name;
  document.getElementById("breadcrumbs").textContent = buildBreadcrumbs(id);

  const pop =
    node.population === null || node.population === undefined
      ? I18N.unknown
      : node.population.toLocaleString("ca-ES");

  document.getElementById("viewMeta").textContent =
    `${I18N.typeLabel}: ${typeToCatalan(node.type)} · ${I18N.populationLabel}: ${pop} · ${I18N.idLabel}: ${node.id}`;
}

/* =========================
   8) Search
   ========================= */

function renderSearchResults(results) {
  const box = document.getElementById("searchResults");
  box.innerHTML = "";

  if (results.length === 0) {
    box.appendChild(el("div", { className: "muted" }, I18N.noResults));
    return;
  }

  for (const r of results.slice(0, 12)) {
    const row = el(
      "div",
      { className: "row" },
      el(
        "button",
        { className: "enter", onClick: () => enterTerritory(r.id) },
        `${r.name} `,
        el("span", { className: "pill" }, typeToCatalan(r.type)),
        el("div", { className: "muted", style: "margin-left:8px;" }, r.path)
      )
    );
    box.appendChild(row);
  }
}

function doSearch(query) {
  const q = normalize(query.trim());

  if (q.length === 0) {
    document.getElementById("searchResults").innerHTML = "";
    return;
  }

  const matches = flatIndex.filter(item => item.searchKey.includes(q));
  renderSearchResults(matches);
}

/* =========================
   9) Init
   ========================= */

async function init() {
  await loadDemoFiles();
  // Show loading text (Catalan)
  document.getElementById("breadcrumbs").textContent = I18N.loading;
  document.getElementById("viewTitle").textContent = I18N.loading;

  root = await loadTerritories();

  byId.clear();
  parentById.clear();
  flatIndex = [];
  indexTree(root);

  const tree = document.getElementById("tree");
  tree.innerHTML = "";
  renderTree(tree, root, 0);

    // DEMO: compute allowed path (ancestors of allowed territory)
  (function computeAllowedPath(){
    let cur = DEMO.allowedTerritoryId;
    const tmp = [];
    while (cur) {
      tmp.push(cur);
      cur = parentById.get(cur);
    }
    DEMO.allowedPathIds = new Set(tmp);
  })();

  enterTerritory(DEMO.allowedTerritoryId);


  const searchInput = document.getElementById("search");
  searchInput.addEventListener("input", debounce((e) => doSearch(e.target.value), 120));

  document.getElementById("enterChat").addEventListener("click", () => {
    // DEMO: open bot (no specific topic)
    const node = byId.get(currentId);
    tgOpen(`https://t.me/${DEMO.botUsername}`);
  });
}

/* =========================
   10) Adjectives search (MVP)
   ========================= */

// NOTE: We reuse the existing normalize() helper above.
// Don't redefine normalize() again.

const adjInput = document.getElementById("adjSearch");
const adjResultsEl = document.getElementById("results");

// If the HTML is not present (for safety), don't crash:
if (adjInput && adjResultsEl) {
  const prefixCache = new Map();
  let adjDebounceTimer = null;

  async function loadAdjPrefix(prefix) {
    if (prefixCache.has(prefix)) return prefixCache.get(prefix);

    const url = `./data/adjectius_plural/${prefix}.json`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        prefixCache.set(prefix, []);
        return [];
      }
      const data = await res.json();
      prefixCache.set(prefix, data);
      return data;
    } catch (err) {
      console.error("Error carregant prefix:", prefix, err);
      prefixCache.set(prefix, []);
      return [];
    }
  }

  function renderAdjResults(items) {
    adjResultsEl.innerHTML = "";

    if (!items.length) {
      adjResultsEl.appendChild(el("div", { className: "muted" }, "Sense resultats"));
      return;
    }

    const top = items.slice(0, 30);

    for (const item of top) {
      const btn = el(
        "button",
        {
          className: "enter",
          style: "display:block; width:100%; text-align:left; padding:10px; margin:6px 0;",
          onClick: () => {
            console.log("CLICK adjectiu:", item);
            const activeTerritoryId = currentId;
            if (activeTerritoryId !== DEMO.allowedTerritoryId) {
              alert(`Selecciona ${byId.get(DEMO.allowedTerritoryId)?.name || DEMO.allowedTerritoryId} per activar els adjetius.`);
              return;
            }
            const topicId = item.norm;
            const groupUrl = DEMO.groupLinks[topicId];
            if (groupUrl) tgOpen(groupUrl);
            else openBotDeepLink(activeTerritoryId, topicId);

          }
        },
        `som ${item.display}`
      );

      adjResultsEl.appendChild(btn);
    }
  }

  function matchesAdjQuery(item, qNorm) {
    if (item.norm && item.norm.includes(qNorm)) return true;

    if (Array.isArray(item.aliases)) {
      for (const a of item.aliases) {
        if (normalize(a).includes(qNorm)) return true;
      }
    }
    return false;
  }

  async function onAdjInputChange() {
    const qNorm = normalize(adjInput.value);

    if (qNorm.length === 0) {
      // DEMO: show the 4 allowed adjectives by default
      if (DEMO.allowedAdjectives && DEMO.allowedAdjectives.length) {
        renderAdjResults(DEMO.allowedAdjectives);
        return;
      }
      adjResultsEl.innerHTML = "";
      return;
    }

    if (qNorm.length < 2) {
      adjResultsEl.innerHTML = "";
      adjResultsEl.appendChild(el("div", { className: "muted" }, "Escriu mínim 2 lletres"));
      return;
    }

    const prefix = qNorm.slice(0, 2);
    const data = await loadAdjPrefix(prefix);
    let filtered = data.filter((item) => matchesAdjQuery(item, qNorm));
    // DEMO: keep only the 4 allowed adjectives (if configured)
    if (DEMO.allowedAdjByNorm && DEMO.allowedAdjByNorm.size) {
      filtered = filtered.filter(it => DEMO.allowedAdjByNorm.has(it.norm));
    }
    renderAdjResults(filtered);
  }

  adjInput.addEventListener("input", () => {
    clearTimeout(adjDebounceTimer);
    adjDebounceTimer = setTimeout(onAdjInputChange, 150);
  });
}

init().catch((err) => {
  console.error(err);
  document.getElementById("breadcrumbs").textContent = I18N.errorLoadingData;
  document.getElementById("viewTitle").textContent = err.message; // (això és tècnic; si vols, també ho traduïm)
});
