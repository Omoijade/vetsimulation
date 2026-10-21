(function () {
  "use strict";

  const D = globalThis.ClinicData;
  const I18N = globalThis.ClinicI18n;
  const STORAGE_KEY = "clinic-board-v3-full";
  const LEGACY_KEY = "clinic-board-v2-mvp";
  const SCHEMA_VERSION = 8;
  // Every number lives in data.js and is read where it is used, so a rule changed in the teacher's
  // workshop takes effect at once.
  const STOCK_SERVICES = new Set(["pharmacy", "surgery", "hospital", "dentistry", "orthopedic", "vaccination", "preventive"]);

  // Deterministic 0–1 value from a string, so a class code gives every team the same luck.
  function seededUnit(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  }

  function demandSwing(clinic, serviceId) {
    const seed = `${clinic.setup?.classCode || "default"}|${clinic.scenarioId}|${clinic.year}`;
    return (1 + (seededUnit(`${seed}|clinic`) * 2 - 1) * D.clientModel.clinicDemandSwing) * (1 + (seededUnit(`${seed}|${serviceId}`) * 2 - 1) * D.clientModel.serviceDemandSwing);
  }
  const ADVANCED_SERVICES = new Set(["surgery", "lab", "ultrasound", "dentistry", "radiography", "hospital", "orthopedic"]);
  const ROUTINE_SERVICES = new Set(["consult", "vaccination", "preventive", "pharmacy", "retail"]);
  const DROPOFF_SERVICES = new Set(["vaccination", "preventive", "lab", "pharmacy"]);
  const SERVICE_BY_ID = Object.fromEntries(D.services.map((item) => [item.id, item]));
  const DEFAULT_SOCIAL = { clientTrust: 50, staffClimate: 50, referralSupport: 50, communityPressure: 50 };

  // ---------- The game's rules: data.js, plus the changes a teacher made in the workshop ----------
  // A clinic may carry `modelRules` (version 2): { nom, valeurs: { chemin: nombre }, noms: { chemin:
  // { fr, en } or text }, delies: { serviceId: true }, monnaie: { code, facteur } }. Every number and
  // name the workshop may change is listed once (data.js › atelierSettings, atelierCatalogue). Before
  // every year is computed, all of them return to their original and the clinic's rules are applied
  // — so a clinic without rules plays the original game.
  const stepInto = (v, k) => (v == null ? undefined : Array.isArray(v) ? (v.find((x) => x && x.id === k) ?? (/^\d+$/.test(k) ? v[Number(k)] : undefined)) : v[k]);
  const readRule = (chemin) => chemin.split(".").reduce(stepInto, D);
  function writeRule(chemin, value) {
    const parts = chemin.split(".");
    const last = parts.pop();
    const parent = parts.reduce(stepInto, D);
    if (parent == null || typeof parent !== "object") return;
    parent[Array.isArray(parent) ? Number(last) : last] = value;
  }
  const isBilingual = (v) => v && typeof v === "object" && typeof v.en === "string" && typeof v.fr === "string";
  // A field's kind sets its bounds and its step, so no bound is typed by hand for each entry.
  const RULE_KINDS = {
    money: { bornes: (o) => [0, Math.max(o * 10, 100)], pas: (o) => (o >= 1000 ? 100 : 1), affichage: "euro" },
    share: { bornes: () => [0, 1], pas: () => .01, affichage: "pourcent" },
    hours: { bornes: (o) => [0, Math.max(o * 5, 10)], pas: (o) => (o >= 50 ? 10 : .01), affichage: "nombre" },
    count: { bornes: (o) => [0, Math.max(o * 5, 10)], pas: (o) => (o >= 50 ? 10 : 1), affichage: "nombre" },
    factor: { bornes: (o) => [Math.round(o * 20) / 100, Math.max(o * 5, 1)], pas: () => .05, affichage: "nombre" },
    points: { bornes: (o) => [Math.min(-20, o * 3), Math.max(20, o * 3)], pas: () => .5, affichage: "nombre" },
    score: { bornes: () => [0, 100], pas: () => 1, affichage: "nombre" }
  };
  const RULE_SETTINGS = {};
  const RULE_NAMES = {};
  (D.atelierSettings || []).forEach((s) => {
    RULE_SETTINGS[s.chemin] = { ...s, section: "regles", money: s.affichage === "euro", nomL: { en: s.nomEn || s.nom, fr: s.nom }, texteL: { en: s.texteEn || s.texte, fr: s.texte } };
  });
  // The rows of a catalogue table: one per item, with the path that reaches it in data.js.
  function atelierRows(table) {
    if (table.source === "scenarios.*.staff") {
      const vus = new Map();
      Object.entries(D.scenarios).forEach(([sc, scen]) => (scen.staff || []).forEach((p) => {
        if (vus.has(p)) vus.get(p).scenarios.push(sc);
        else vus.set(p, { cle: `scenarios.${sc}.staff.${p.id}`, objet: p, scenarios: [sc] });
      }));
      return [...vus.values()];
    }
    const src = readRule(table.source);
    if (Array.isArray(src)) return src.filter((x) => x && x.id).map((x) => ({ cle: `${table.source}.${x.id}`, objet: x }));
    return Object.entries(src || {}).map(([k, x]) => ({ cle: `${table.source}.${k}`, objet: x }));
  }
  function addRuleField(chemin, table, row, champ) {
    const v = readRule(chemin);
    if (typeof v !== "number" || RULE_SETTINGS[chemin]) return;
    const kind = RULE_KINDS[champ.genre] || RULE_KINDS.count;
    const [min, max] = kind.bornes(v);
    RULE_SETTINGS[chemin] = { chemin, section: table.section, table: table.id, ligne: row.cle, champ: champ.cle, label: champ.label, min, max, pas: kind.pas(v), affichage: kind.affichage, money: champ.genre === "money", complement: champ.complement ? `${row.cle}.${champ.complement}` : null };
  }
  (D.atelierCatalogue || []).forEach((table) => atelierRows(table).forEach((row) => {
    if (table.matrice) Object.keys(row.objet[table.matrice] || {}).forEach((svc) => addRuleField(`${row.cle}.${table.matrice}.${svc}`, table, row, { cle: svc, genre: table.genre }));
    else (table.champs || []).forEach((champ) => addRuleField(`${row.cle}.${champ.cle}`, table, row, champ));
    [table.nom, table.texte].filter(Boolean).forEach((f) => {
      const chemin = `${row.cle}.${f}`;
      const v = readRule(chemin);
      if (typeof v === "string" || isBilingual(v)) RULE_NAMES[chemin] = { section: table.section, table: table.id, ligne: row.cle, texte: f === table.texte };
    });
  }));
  const RULE_DEFAULTS = Object.fromEntries(Object.keys(RULE_SETTINGS).map((c) => [c, readRule(c)]));
  const NAME_DEFAULTS = Object.fromEntries(Object.keys(RULE_NAMES).map((c) => [c, JSON.parse(JSON.stringify(readRule(c)))]));
  const COMPLEMENT_DEFAULTS = Object.fromEntries(Object.values(RULE_SETTINGS).filter((s) => s.complement).map((s) => [s.complement, readRule(s.complement)]));
  const RULE_CURRENCIES = D.atelierCurrencies || ["EUR"];
  let ruleCurrency = "EUR";
  // Only listed settings and names, numbers inside their bounds, names kept short: a file from
  // elsewhere can change the rules, never break the game. What equals the original is dropped.
  function cleanRules(rules) {
    if (!rules || typeof rules !== "object") return null;
    const valeurs = {};
    Object.entries(rules.valeurs || {}).forEach(([chemin, v]) => {
      const def = RULE_SETTINGS[chemin];
      const n = Number(v);
      if (!def || !Number.isFinite(n)) return;
      const borne = Math.min(def.max, Math.max(def.min, n));
      if (Math.abs(borne - RULE_DEFAULTS[chemin]) > 1e-9) valeurs[chemin] = borne;
    });
    const noms = {};
    Object.entries(rules.noms || {}).forEach(([chemin, v]) => {
      const origine = NAME_DEFAULTS[chemin];
      if (origine === undefined || v == null) return;
      const court = (t, repli) => String(t ?? "").trim().slice(0, 120) || repli;
      if (typeof origine === "string") { const t = court(typeof v === "string" ? v : v.fr ?? v.en, origine); if (t !== origine) noms[chemin] = t; return; }
      const fr = court(v.fr, origine.fr), en = court(v.en, origine.en);
      if (fr !== origine.fr || en !== origine.en) noms[chemin] = { fr, en };
    });
    const delies = {};
    Object.entries(rules.delies || {}).forEach(([id, v]) => { if (v && SERVICE_BY_ID[id]) delies[id] = true; });
    const code = RULE_CURRENCIES.includes(rules.monnaie?.code) ? rules.monnaie.code : "EUR";
    const facteur = Math.min(5, Math.max(.2, Number(rules.monnaie?.facteur) || 1));
    const monnaie = code !== "EUR" || Math.abs(facteur - 1) > 1e-9 ? { code, facteur } : null;
    if (!Object.keys(valeurs).length && !Object.keys(noms).length && !monnaie && !Object.keys(delies).length) return null;
    return { nom: String(rules.nom || "").slice(0, 60), version: 2, valeurs, noms, delies, monnaie };
  }
  let appliedRulesKey = "";
  function applyModelRules(rules) {
    const clean = cleanRules(rules);
    const key = clean ? JSON.stringify(clean) : "";
    if (key === appliedRulesKey) return;
    Object.keys(RULE_SETTINGS).forEach((c) => writeRule(c, RULE_DEFAULTS[c]));
    Object.entries(COMPLEMENT_DEFAULTS).forEach(([c, v]) => writeRule(c, v));
    Object.keys(RULE_NAMES).forEach((c) => writeRule(c, JSON.parse(JSON.stringify(NAME_DEFAULTS[c]))));
    ruleCurrency = "EUR";
    if (clean) {
      Object.entries(clean.valeurs).forEach(([c, v]) => {
        writeRule(c, v);
        const comp = RULE_SETTINGS[c].complement;
        if (comp) writeRule(comp, Math.max(0, 1 - v));
      });
      // A base price moves what clients accept for that service by the same share, unless the
      // teacher unlinked it (to create an over-priced situation on purpose).
      Object.entries(clean.valeurs).forEach(([c, v]) => {
        const m = c.match(/^services\.([^.]+)\.price$/);
        if (!m || clean.delies[m[1]] || !RULE_DEFAULTS[c]) return;
        Object.keys(D.segments).forEach((seg) => {
          const p = `segments.${seg}.willingness.${m[1]}`;
          if (p in RULE_SETTINGS && !(p in clean.valeurs)) writeRule(p, RULE_DEFAULTS[p] * v / RULE_DEFAULTS[c]);
        });
      });
      Object.entries(clean.noms).forEach(([c, v]) => writeRule(c, typeof v === "string" ? v : { ...NAME_DEFAULTS[c], ...v }));
      if (clean.monnaie) ruleCurrency = clean.monnaie.code;
    }
    appliedRulesKey = key;
  }
  // Prices, salaries, treasury, households and the relations are copied into a clinic when a game
  // starts. So a clinic that has not played a year takes them again from the rules; after Year 1 they
  // stay as played.
  function withStartingValues(clinic) {
    if ((clinic.history || []).length) return clinic;
    applyModelRules(clinic.modelRules);
    const fresh = initialState(clinic.scenarioId, clinic.language, clinic.setup, clinic.rules);
    Object.keys(clinic.services).forEach((id) => { if (fresh.services[id]) clinic.services[id].price = fresh.services[id].price; });
    clinic.staff = fresh.staff;
    clinic.treasury = fresh.treasury;
    clinic.setup = { ...clinic.setup, startingTreasury: fresh.setup.startingTreasury };
    clinic.clients = fresh.clients;
    clinic.reputation = fresh.reputation;
    clinic.social = fresh.social;
    clinic.carbonBaseline = null;
    return clinic;
  }
  // The workshop's code is checked against a fingerprint (FNV-1a), never stored as such.
  function atelierFingerprint(texte) {
    let h = 0x811c9dc5;
    for (const c of String(texte || "").trim().toUpperCase()) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }


  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const detectedLanguage = () => String(navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
  const itemLabel = (item, language = state?.language || "en") => item?.[language] || item?.en || String(item || "");
  const serviceName = (id) => itemLabel(SERVICE_BY_ID[id]?.name || { en: id, fr: id });
  const roomName = (id) => itemLabel(D.rooms[id]?.name || { en: id, fr: id });
  const equipmentName = (id) => itemLabel(D.equipment[id]?.name || { en: id, fr: id });
  const skillName = (id) => itemLabel(D.skills[id] || { en: id, fr: id });

  // Vets can work on any service: vet work needs the vet skill, and they can
  // cover the support part of a case without a support skill. Support staff
  // can only do support work.
  function roleCompatible(person, service) {
    return person.role === "vet" ? true : service.supportShare > 0;
  }

  function personQualified(person, service) {
    if (person.role === "vet") return service.vetShare > 0 ? service.vetSkills.every((skill) => person.skills.includes(skill)) : true;
    return service.supportSkills.every((skill) => person.skills.includes(skill));
  }

  function vetCoversSupport(person, service) {
    return person.role === "vet" && service.vetShare === 0;
  }

  function legacyAllocations(person) {
    const primary = SERVICE_BY_ID[person.primaryService] ? person.primaryService : (person.role === "vet" ? "consult" : "vaccination");
    const secondary = SERVICE_BY_ID[person.secondaryService] ? person.secondaryService : "";
    const secondaryShare = secondary ? clamp(Number(person.secondaryShare || 0), 0, .95) : 0;
    return [{ serviceId: primary, share: 1 - secondaryShare }, ...(secondaryShare ? [{ serviceId: secondary, share: secondaryShare }] : [])];
  }

  // Allocations may total less than 100% (idle paid time) or up to 130%
  // (overtime). Totals are preserved; only an over-cap total is scaled down.
  function normalizeAllocations(person) {
    const source = Array.isArray(person.allocations) && person.allocations.length ? person.allocations : legacyAllocations(person);
    const merged = new Map();
    source.forEach((row) => {
      const service = SERVICE_BY_ID[row?.serviceId];
      if (!service || !roleCompatible(person, service)) return;
      const share = clamp(Number(row.share || 0), 0, D.staffModel.maxAllocation);
      merged.set(service.id, (merged.get(service.id) || 0) + share);
    });
    let allocations = [...merged.entries()].map(([serviceId, share]) => ({ serviceId, share: Math.min(D.staffModel.maxAllocation, share) }));
    if (!allocations.length) allocations = legacyAllocations(person);
    const total = allocationTotal(allocations);
    if (total > D.staffModel.maxAllocation) allocations = allocations.map((row) => ({ ...row, share: row.share * D.staffModel.maxAllocation / total }));
    return allocations;
  }

  function allocationTotal(allocations) {
    return allocations.reduce((sum, row) => sum + Number(row.share || 0), 0);
  }

  // One ceiling for every control that writes a share. The step buttons used to floor it to the
  // 5% grid: a row holding a typed share (90 h of 1 421 is 6.33%) dropped the reachable maximum
  // from 130% to 120% while the hours field still allowed 123.67%.
  function allocationCeiling(others) {
    return Math.max(0, D.staffModel.maxAllocation - others);
  }

  // Every share a student sets stands for a whole number of hours, so the hours on the rows add up
  // to the hours on the total. Without this, two rows of 33.33% each display 474 h beside a total
  // of 947 h, and the column does not close.
  function snapShareToHours(share, availableHours) {
    return availableHours > 0 ? Math.max(0, Math.round(share * availableHours)) / availableHours : 0;
  }

  // The two ways a student sets a share, with the same ceiling and the same hour quantum, so a
  // typed figure and a stepped figure cannot drift apart. A step adds its own size: re-rounding the
  // base to the 5% grid turned a typed 90 h into 142 h on one press of +.
  function stepShare(share, deltaPercent, others, availableHours) {
    return snapShareToHours(clamp(Number(share || 0) + Number(deltaPercent || 0) / 100, 0, allocationCeiling(others)), availableHours);
  }

  function shareFromHours(hours, others, availableHours) {
    if (!(availableHours > 0)) return 0;
    const wanted = Math.max(0, Math.round(Number(hours) || 0)) / availableHours;
    return snapShareToHours(clamp(wanted, 0, allocationCeiling(others)), availableHours);
  }

  // Unassigned paid share left for one row: steps cannot land on an exact 100% of a person's
  // hours, so this returns the precise remainder. It targets 100%, never the overtime ceiling.
  function allocationRemainder(allocations, index) {
    const others = allocationTotal(allocations) - (allocations[index]?.share || 0);
    return Math.max(0, Math.min(1, D.staffModel.maxAllocation) - others - (allocations[index]?.share || 0));
  }

  function validAllocations(person, allocations) {
    if (!Array.isArray(allocations) || !allocations.length) return false;
    const ids = new Set();
    let total = 0;
    for (const row of allocations) {
      const service = SERVICE_BY_ID[row?.serviceId];
      const share = Number(row?.share);
      if (!service || !roleCompatible(person, service) || ids.has(service.id)) return false;
      if (!Number.isFinite(share) || share <= 0 || share > D.staffModel.maxAllocation + .0001) return false;
      ids.add(service.id);
      total += share;
    }
    return total > 0 && total <= D.staffModel.maxAllocation + .0001;
  }

  function initialState(scenarioId = "balanced", language = detectedLanguage(), setupOverride = null, rulesOverride = null) {
    const scenario = D.scenarios[scenarioId] || D.scenarios.balanced;
    const setup = { startingTreasury: scenario.treasury, customTreasury: false, forecastPrecision: "exact", classCode: "", studyGroup: "", ...(setupOverride || {}) };
    if (!setup.customTreasury) setup.startingTreasury = scenario.treasury;
    const serviceState = Object.fromEntries(D.services.map((service) => [service.id, {
      active: scenario.services.includes(service.id),
      price: service.price,
      pace: "standard",
      lastDemand: 0,
      lastHonored: 0,
      lastBottleneck: { type: scenario.services.includes(service.id) ? "demandMet" : "notOffered" }
    }]));
    const roomState = Object.fromEntries(Object.keys(D.rooms).map((id) => [id, Number(scenario.rooms[id] || 0)]));
    const equipmentState = Object.fromEntries(Object.keys(D.equipment).map((id) => [id, {
      owned: Number(scenario.equipment[id]?.owned || 0),
      leased: Number(scenario.equipment[id]?.leased || 0)
    }]));
    return {
      schemaVersion: SCHEMA_VERSION,
      language,
      scenarioId,
      year: 1,
      treasury: setup.startingTreasury,
      clients: scenario.clients,
      reputation: scenario.reputation,
      marketFocus: scenario.marketFocus,
      staff: clone(scenario.staff).map(normalizeStaff),
      trainings: clone(scenario.trainings),
      social: clone(scenario.social || DEFAULT_SOCIAL),
      equipment: equipmentState,
      rooms: roomState,
      services: serviceState,
      operations: { openingPeriods: { extended: false, sunday: false, night: false }, dropoff: false, stockStrategy: "basic" },
      hr: { strategy: "reactive" },
      location: { sectorId: scenario.location, parking: false },
      marketing: { communication: "basic", geomarketing: "none" },
      finance: { loan: null },
      carbonModelVersion: D.carbonModel.version,
      sustainability: { energyUpgrade: "none", heatPump: false, solar: false, anaesthesiaProtocol: "standard", wasteStrategy: "standard", accessPlan: false },
      carbonBaseline: null,
      rules: { actionLimit: 3, unlimited: false, targetYear: 4, bankruptcyThreshold: -200000, ...(rulesOverride || {}) },
      reflections: {},
      runArchive: [],
      pending: {},
      history: [],
      domain: "overview",
      helpOpen: false,
      endState: null,
      sandboxMode: false,
      uiPreferences: { beginnerGuideDismissed: false },
      playerTeam: { teamCode: "" },
      setup,
      setupLog: [],
      cashLog: [],
      decisionLog: [],
      rehireBlocked: {},
      undo: null
    };
  }

  function normalizeStaff(person) {
    const base = Number(person.baseSalary || person.salary || (person.role === "vet" ? 56000 : 30000));
    const normalized = {
      id: person.id,
      name: person.name,
      role: person.role === "vet" ? "vet" : "support",
      baseSalary: base,
      salary: Number(person.salary || base),
      capacity: Number(person.capacity || 1500),
      skills: Array.isArray(person.skills) ? [...new Set(person.skills)] : [],
      primaryService: SERVICE_BY_ID[person.primaryService] ? person.primaryService : (person.role === "vet" ? "consult" : "vaccination"),
      secondaryService: SERVICE_BY_ID[person.secondaryService] ? person.secondaryService : "",
      secondaryShare: clamp(Number(person.secondaryShare || 0), 0, .95),
      lastOvertimeRatio: clamp(Number(person.lastOvertimeRatio || 0), 0, D.staffModel.maxAllocation),
      hiredYear: Number(person.hiredYear || 0),
      allocations: []
    };
    normalized.allocations = normalizeAllocations({ ...normalized, allocations: person.allocations });
    normalized.primaryService = normalized.allocations[0]?.serviceId || normalized.primaryService;
    normalized.secondaryService = normalized.allocations[1]?.serviceId || "";
    normalized.secondaryShare = normalized.allocations[1]?.share || 0;
    return normalized;
  }

  function migrateLegacy(saved) {
    const fresh = initialState("balanced", saved.language || detectedLanguage());
    ["year", "treasury", "clients", "reputation", "marketFocus"].forEach((key) => {
      if (saved[key] !== undefined) fresh[key] = saved[key];
    });
    if (Array.isArray(saved.staff)) fresh.staff = saved.staff.map(normalizeStaff);
    D.services.forEach((service) => {
      const old = saved.services?.[service.id];
      if (old) fresh.services[service.id] = { ...fresh.services[service.id], ...old, lastBottleneck: { type: "none" } };
    });
    Object.keys(D.rooms).forEach((id) => {
      if (saved.rooms?.[id] !== undefined) fresh.rooms[id] = Number(saved.rooms[id]);
    });
    Object.keys(D.equipment).forEach((id) => {
      const old = Number(saved.equipment?.[id] || 0);
      if (old) fresh.equipment[id] = { owned: old, leased: 0 };
    });
    fresh.trainings = [...new Set([...(saved.supportTrainings || []), ...(saved.vetTrainings || []), ...fresh.trainings])];
    fresh.social = { ...fresh.social, ...(saved.social || {}) };
    fresh.rules.actionLimit = Number(saved.actionLimit || 3);
    fresh.rules.unlimited = Boolean(saved.unlimitedActions);
    fresh.history = (saved.history || []).map((report) => ({
      ...report,
      legacyActions: Array.isArray(report.actions) ? report.actions.filter((item) => typeof item === "string") : [],
      actions: Array.isArray(report.actions) ? report.actions.filter((item) => typeof item === "object") : []
    }));
    fresh.reflections = saved.teamNote ? { [Math.max(1, fresh.year - 1)]: { observed: saved.teamNote } } : {};
    return fresh;
  }

  function hydrate(saved) {
    if (!saved || !saved.schemaVersion || saved.schemaVersion < 3) return migrateLegacy(saved || {});
    const fresh = initialState(saved.scenarioId || "balanced", saved.language || detectedLanguage());
    const merged = { ...fresh, ...saved };
    merged.schemaVersion = SCHEMA_VERSION;
    merged.rules = { ...fresh.rules, ...(saved.rules || {}) };
    merged.operations = { ...fresh.operations, ...(saved.operations || {}), openingPeriods: { ...fresh.operations.openingPeriods, ...(saved.operations?.openingPeriods || {}) } };
    merged.hr = { ...fresh.hr, ...(saved.hr || {}) };
    merged.location = { ...fresh.location, ...(saved.location || {}) };
    merged.marketing = { ...fresh.marketing, ...(saved.marketing || {}) };
    merged.finance = { ...fresh.finance, ...(saved.finance || {}) };
    merged.sustainability = { ...fresh.sustainability, ...(saved.sustainability || {}) };
    merged.services = { ...fresh.services, ...(saved.services || {}) };
    merged.rooms = { ...fresh.rooms, ...(saved.rooms || {}) };
    merged.equipment = { ...fresh.equipment, ...(saved.equipment || {}) };
    merged.staff = (saved.staff || fresh.staff).map(normalizeStaff);
    merged.pending = Object.fromEntries(Object.entries(saved.pending || {}).map(([key, action]) => [key, { revisions: 0, ...action, key }]));
    merged.history = saved.history || [];
    merged.reflections = saved.reflections || {};
    merged.runArchive = Array.isArray(saved.runArchive) ? saved.runArchive : [];
    merged.social = { ...DEFAULT_SOCIAL, ...(saved.social || {}) };
    merged.uiPreferences = { ...fresh.uiPreferences, ...(saved.uiPreferences || {}) };
    merged.setup = { ...fresh.setup, ...(saved.setup || {}) };
    merged.setupLog = Array.isArray(saved.setupLog) ? saved.setupLog : [];
    merged.cashLog = Array.isArray(saved.cashLog) ? saved.cashLog : [];
    merged.decisionLog = Array.isArray(saved.decisionLog) ? saved.decisionLog : [];
    merged.rehireBlocked = saved.rehireBlocked || {};
    // An undo snapshot from an older schema would restore a clinic this version cannot read, so it
    // is only carried when it came from this one.
    merged.undo = saved.undo && saved.undo.snapshot && saved.undo.snapshot.schemaVersion === SCHEMA_VERSION ? saved.undo : null;
    // Only an anonymous team code is carried. Free-text names from older saves are dropped on load
    // so they cannot reach an export that becomes research data.
    merged.playerTeam = { teamCode: String(saved.playerTeam?.teamCode || "").trim().slice(0, 24) };
    const domainMap = { dashboard: "overview", services: "care", facilities: "care", staff: "team", operations: "team", money: "business", market: "business" };
    merged.domain = domainMap[merged.domain] || merged.domain || "overview";
    return merged;
  }

  function loadState() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) return hydrate(JSON.parse(current));
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) return migrateLegacy(JSON.parse(legacy));
    } catch (error) {
      console.warn("Could not load saved clinic", error);
    }
    return initialState();
  }

  let state = loadState();
  let t = I18N.createTranslator(state.language);
  let ui = { framesOpen: false, noteOpen: false, regleOpen: false, passCheck: false, personTab: "time", showClosedServices: false, drawer: null, drawerStep: 1, drawerContext: null, selectedServiceId: null, reopenBeginnerGuide: false, vacancy: { role: "vet", skills: [], budget: 60000 }, candidateLimit: 4, lastFocus: null, allocationDrafts: {}, decisionDrafts: {}, settingsOpen: false, settingsDraft: null, settingsError: "", restore: null, returnFocus: null, autoFocusDrawer: false, replaceRoute: false, originStack: [], returnLabel: null, focusItem: null };

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function locale() {
    return state.language === "fr" ? "fr-BE" : "en-GB";
  }

  function money(value, devise = ruleCurrency) {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: devise, maximumFractionDigits: 0 }).format(Math.round(Number(value || 0)));
  }

  function currencySymbol() {
    return (new Intl.NumberFormat(locale(), { style: "currency", currency: ruleCurrency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency") || {}).value || ruleCurrency;
  }

  function number(value) {
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Math.round(Number(value || 0)));
  }

  function preciseNumber(value) {
    return new Intl.NumberFormat(locale(), { minimumFractionDigits: 3, maximumFractionDigits: 8 }).format(Number(value || 0));
  }

  function pct(value) {
    return new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function decimal(value, digits = 1) {
    return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value || 0));
  }

  function tonnes(value, digits = 1) {
    return `${decimal(value, digits)} tCO₂e`;
  }

  function kilograms(value) {
    return `${decimal(value, 1)} kgCO₂e`;
  }

  function L(en, fr) {
    return state.language === "fr" ? fr : en;
  }

  function signed(value, type = "number") {
    const n = Number(value || 0);
    const sign = n > 0 ? "+" : "";
    if (type === "money") return `${sign}${money(n)}`;
    if (type === "percent") return `${sign}${pct(n)}`;
    return `${sign}${number(n)}`;
  }

  function announce(message) {
    const node = document.querySelector("#announcer");
    if (!node) return;
    node.textContent = "";
    window.setTimeout(() => { node.textContent = message; }, 30);
  }

  function toast(message, tone = "") {
    document.querySelector(".toast")?.remove();
    const node = document.createElement("div");
    node.className = `toast ${tone}`;
    node.textContent = message;
    document.body.appendChild(node);
    announce(message);
    window.setTimeout(() => node.remove(), 2800);
  }

  function pendingActions() {
    return Object.values(state.pending);
  }

  function actionLimit() {
    return state.rules.unlimited ? Infinity : Math.max(1, Number(state.rules.actionLimit || 3));
  }

  // Actions that commit nothing: they move hours the clinic already pays for, so they stay listed
  // in the plan, stay removable, and stay in the decision log — but they do not use up the year.
  const FREE_ACTION_KINDS = new Set(["staff-allocation"]);
  function isFreeAction(payload) {
    return FREE_ACTION_KINDS.has(payload?.kind);
  }
  function countedActions() {
    return pendingActions().filter((action) => !isFreeAction(action.payload));
  }

  // `label` is the decision as the team read it on screen, written at the moment it happens: a
  // removed decision no longer exists anywhere else, and a key such as "price:consult" says nothing
  // to someone reading the report.
  function logDecision(event, key, label = "") {
    if (!Array.isArray(state.decisionLog)) state.decisionLog = [];
    state.decisionLog.push({ year: state.year, at: new Date().toISOString(), event, key, ...(label ? { label } : {}) });
  }

  function queueAction(key, payload) {
    const previous = state.pending[key];
    if (!previous && !isFreeAction(payload) && countedActions().length >= actionLimit()) {
      toast(`${t("forecast.limitReached")} ${t("forecast.removeHint")}`, "warn");
      return;
    }
    const at = new Date().toISOString();
    // First queue stamps `at`; later edits to the same target keep it and count as revisions,
    // so "repeated edits are one action" still holds while the going back and forth stays visible.
    state.pending[key] = { key, payload: clone(payload), at: previous?.at || at, updatedAt: at, revisions: previous ? Number(previous.revisions || 0) + 1 : 0 };
    logDecision(previous ? "revise" : "add", key, actionLabel(payload));
    saveState();
    render();
  }

  // `champ` carries a text field across the re-render: what was typed and where the caret was. A
  // field rewritten from state without it loses the caret to position zero, and the next digit goes
  // in at the front — 937 typed one key at a time arrived as 739.
  // The workshop is a full page: its scroll and the field being used survive a redraw.
  function keepAtelierScroll(selector = null, caret = null) {
    ui.atelierRestore = { main: document.querySelector(".atelier-main")?.scrollTop || 0, page: window.scrollY || 0, selector, caret };
  }
  function restoreAtelierScroll() {
    const r = ui.atelierRestore;
    ui.atelierRestore = null;
    if (!r) return;
    const main = document.querySelector(".atelier-main");
    if (main) main.scrollTop = r.main;
    window.scrollTo(0, r.page);
    const cible = r.selector ? document.querySelector(r.selector) : null;
    if (cible) { cible.focus({ preventScroll: true }); if (r.caret != null && typeof cible.setSelectionRange === "function") { try { cible.setSelectionRange(r.caret, r.caret); } catch (e) { /* range inputs have no caret */ } } }
  }

  function rememberDrawer(selector = null, champ = null) {
    const body = document.querySelector(".drawer-body");
    ui.restore = { scrollTop: body?.scrollTop || 0, selector, champ };
  }

  function removeAction(key) {
    if (state.pending[key]) logDecision("remove", key, actionLabel(state.pending[key].payload));
    delete state.pending[key];
    saveState();
    render();
    toast(t("toast.actionRemoved"));
  }

  function emptyEffects() {
    return { oneTimeCosts: 0, cashAdjustment: 0, vetTrainingHours: 0, supportTrainingHours: 0, trainingHoursByPerson: {}, supportReserved: 0, facilityHoursLost: 0, relocationLoss: 0, advancedDemand: 0, routineDemand: 0, severance: 0, climateShock: 0, fatigueRelief: 0, focusTransition: 0, recruitment: [], departures: [] };
  }

  function combineEffects(total, effect) {
    Object.keys(total).forEach((key) => {
      if (Array.isArray(total[key])) total[key].push(...(effect[key] || []));
      else if (total[key] && typeof total[key] === "object") Object.entries(effect[key] || {}).forEach(([id, value]) => { total[key][id] = (total[key][id] || 0) + Number(value || 0); });
      else total[key] += Number(effect[key] || 0);
    });
    return total;
  }

  function equipmentQuantity(clinic, id) {
    return Number(clinic.equipment[id]?.owned || 0) + Number(clinic.equipment[id]?.leased || 0);
  }

  function addSkill(clinic, role, skill) {
    clinic.staff.filter((person) => person.role === role).forEach((person) => {
      if (!person.skills.includes(skill)) person.skills.push(skill);
    });
  }

  function candidateById(id) {
    return D.candidates.find((item) => item.id === id);
  }

  function applyAction(target, action, chargeCosts = false) {
    const p = action.payload;
    const effect = emptyEffects();
    if (!p?.kind) return effect;
    if (p.kind === "toggle-service" && target.services[p.targetId]) {
      const wasActive = target.services[p.targetId].active;
      target.services[p.targetId].active = Boolean(p.value);
      if (!wasActive && p.value) target.services[p.targetId].openedYear = target.year;
    }
    if (p.kind === "price" && target.services[p.targetId]) target.services[p.targetId].price = clamp(Number(p.value), 1, 5000);
    if (p.kind === "service-pace" && target.services[p.targetId] && D.servicePaces[p.value]) target.services[p.targetId].pace = p.value;
    if (p.kind === "market-focus" && D.segments[p.targetId]) {
      // Clients take a year to notice a new positioning.
      if (chargeCosts && target.marketFocus !== p.targetId) effect.focusTransition = .1;
      target.marketFocus = p.targetId;
    }
    if (p.kind === "equipment-acquire" && D.equipment[p.targetId]) {
      target.equipment[p.targetId][p.mode === "lease" ? "leased" : "owned"] += 1;
      if (chargeCosts && p.mode !== "lease") effect.oneTimeCosts += D.equipment[p.targetId].purchase;
    }
    if (p.kind === "equipment-remove" && D.equipment[p.targetId]) {
      const field = p.mode === "lease" ? "leased" : "owned";
      if (target.equipment[p.targetId][field] > 0) {
        target.equipment[p.targetId][field] -= 1;
        if (chargeCosts && field === "owned") effect.cashAdjustment += D.equipment[p.targetId].purchase * .4;
      }
    }
    if (p.kind === "room-add" && D.rooms[p.targetId]) {
      target.rooms[p.targetId] += 1;
      if (chargeCosts) effect.oneTimeCosts += D.rooms[p.targetId].fitout;
    }
    if (p.kind === "room-close" && D.rooms[p.targetId] && target.rooms[p.targetId] > 0) target.rooms[p.targetId] -= 1;
    if (p.kind === "salary") {
      const person = target.staff.find((item) => item.id === p.targetId);
      if (person) person.salary = clamp(Number(p.value), Math.round(person.baseSalary * .8), Math.round(person.baseSalary * 1.3));
    }
    if (p.kind === "schedule") {
      target.staff = target.staff.map((person) => {
        const row = p.value.find((item) => item.id === person.id);
        if (!row) return person;
        const legacy = { ...person, ...row };
        if (!row.allocations) delete legacy.allocations;
        return normalizeStaff(legacy);
      });
    }
    if (p.kind === "staff-allocation") {
      const index = target.staff.findIndex((person) => person.id === p.targetId);
      if (index >= 0 && validAllocations(target.staff[index], p.value?.allocations)) {
        target.staff[index] = normalizeStaff({ ...target.staff[index], allocations: clone(p.value.allocations) });
      }
    }
    if (p.kind === "hire") {
      const candidate = candidateById(p.targetId);
      const salary = Number(typeof p.value === "object" ? p.value.offeredSalary : p.value);
      const blockedUntil = Number(target.rehireBlocked?.[p.targetId] || 0);
      const accepted = Boolean(candidate && salary >= candidate.expectedSalary && blockedUntil <= target.year);
      if (candidate && accepted && !target.staff.some((person) => person.id === candidate.id)) {
        target.staff.push(normalizeStaff({ ...candidate, salary, hiredYear: target.year, secondaryService: "", secondaryShare: 0 }));
      }
      if (chargeCosts && candidate) effect.oneTimeCosts += candidate.postingFee;
      effect.recruitment.push({ candidateId: p.targetId, salary, accepted });
    }
    if (p.kind === "fire") {
      const index = target.staff.findIndex((person) => person.id === p.targetId);
      if (index >= 0) {
        const person = target.staff[index];
        target.staff.splice(index, 1);
        target.rehireBlocked = { ...(target.rehireBlocked || {}), [person.id]: target.year + 1 };
        if (chargeCosts) {
          const severance = person.salary * D.staffModel.severanceShare;
          effect.oneTimeCosts += severance;
          effect.severance += severance;
          effect.climateShock += D.staffModel.departureClimate;
          effect.departures.push({ id: person.id, name: person.name, reason: "fired" });
        }
      }
    }
    if (p.kind === "training") {
      const training = D.trainings[p.targetId];
      const trainee = p.personId ? target.staff.find((person) => person.id === p.personId && person.role === training?.role) : null;
      if (training && trainee) {
        if (!trainee.skills.includes(p.targetId)) {
          trainee.skills.push(p.targetId);
          if (!target.trainings.includes(p.targetId)) target.trainings.push(p.targetId);
          if (chargeCosts) {
            effect.oneTimeCosts += training.cost;
            effect.trainingHoursByPerson[trainee.id] = (effect.trainingHoursByPerson[trainee.id] || 0) + training.hours;
          }
        }
      } else if (training && !p.personId && !target.trainings.includes(p.targetId)) {
        // Legacy saves queued role-wide training without a named person.
        target.trainings.push(p.targetId);
        addSkill(target, training.role, p.targetId);
        if (chargeCosts) {
          effect.oneTimeCosts += training.cost;
          effect[training.role === "vet" ? "vetTrainingHours" : "supportTrainingHours"] += training.hours;
        }
      }
    }
    if (p.kind === "opening-period" && D.openingPeriods[p.targetId]) target.operations.openingPeriods[p.targetId] = Boolean(p.value);
    if (p.kind === "dropoff") target.operations.dropoff = Boolean(p.value);
    if (p.kind === "stock-strategy" && D.stockStrategies[p.targetId]) target.operations.stockStrategy = p.targetId;
    if (p.kind === "hr-strategy" && D.hrStrategies[p.targetId]) target.hr.strategy = p.targetId;
    if (p.kind === "location" && D.locations[p.targetId] && p.targetId !== target.location.sectorId) {
      target.location.sectorId = p.targetId;
      target.location.parking = false;
      if (chargeCosts) {
        effect.oneTimeCosts += D.locations[p.targetId].moveCost;
        effect.relocationLoss = .05;
      }
    }
    if (p.kind === "parking") {
      target.location.parking = Boolean(p.value);
      if (chargeCosts && p.value) effect.oneTimeCosts += D.locations[target.location.sectorId].parkingCost;
    }
    if (p.kind === "marketing-strategy" && D.marketingStrategies[p.strategy]?.[p.targetId]) target.marketing[p.strategy] = p.targetId;
    if (p.kind === "social-action") {
      const socialAction = D.socialActions[p.targetId];
      if (socialAction) {
        // Repeating the same move year after year wears it out: each consecutive earlier year it was
        // taken multiplies its effect by repeatDecay. A cheap fix stays usable, not leaned on.
        const decay = D.socialModel?.repeatDecay ?? 1;
        let streak = 0;
        for (let i = (target.history || []).length - 1; i >= 0; i--) {
          if ((target.history[i].actions || []).some((a) => (a.payload || a).kind === "social-action" && (a.payload || a).targetId === p.targetId)) streak += 1; else break;
        }
        const strength = Math.pow(decay, streak);
        Object.entries(socialAction.deltas).forEach(([key, value]) => { target.social[key] = clamp(Number(target.social[key] || 0) + value * strength, 0, 100); });
        if (chargeCosts) {
          effect.oneTimeCosts += socialAction.cost;
          effect.supportReserved += Number(socialAction.supportHours || 0);
          effect.advancedDemand += Number(socialAction.advancedDemand || 0);
          effect.routineDemand += Number(socialAction.routineDemand || 0);
          effect.fatigueRelief += Number(socialAction.fatigueRelief || 0);
        }
      }
    }
    if (p.kind === "loan") {
      const rate = loanRate(target);
      if (!target.finance.loan && rate !== null) {
        target.finance.loan = { principal: Number(p.value), remaining: Number(p.value), yearsRemaining: 5, rate };
        if (chargeCosts) effect.cashAdjustment += Number(p.value);
      }
    }
    if (p.kind === "repay-loan" && target.finance.loan) {
      if (chargeCosts) effect.cashAdjustment -= target.finance.loan.remaining;
      target.finance.loan = null;
    }
    if (p.kind === "sustainability") {
      const S = D.sustainability;
      if (p.targetId === "energyUpgrade" && S.energyUpgrades[p.value]) {
        const was = target.sustainability.energyUpgrade;
        target.sustainability.energyUpgrade = p.value;
        if (chargeCosts && was !== p.value && p.value !== "none") {
          const choice = S.energyUpgrades[p.value];
          effect.oneTimeCosts += choice.once;
          effect.supportTrainingHours += choice.supportHours || 0;
          effect.facilityHoursLost += choice.facilityHoursLost || 0;
        }
      }
      if (["heatPump", "solar", "accessPlan"].includes(p.targetId)) {
        const was = Boolean(target.sustainability[p.targetId]);
        target.sustainability[p.targetId] = Boolean(p.value);
        const choice = S.interventions[p.targetId];
        if (chargeCosts && !was && p.value && choice) {
          effect.oneTimeCosts += choice.once || 0;
          effect.facilityHoursLost += choice.facilityHoursLost || 0;
        }
      }
      if (p.targetId === "anaesthesiaProtocol") {
        const was = target.sustainability.anaesthesiaProtocol;
        target.sustainability.anaesthesiaProtocol = p.value === "lowFlow" ? "lowFlow" : "standard";
        if (chargeCosts && was !== "lowFlow" && p.value === "lowFlow") {
          effect.oneTimeCosts += S.interventions.lowFlow.once;
          effect.vetTrainingHours += S.interventions.lowFlow.vetHours;
        }
      }
      if (p.targetId === "wasteStrategy" && S.wasteStrategies[p.value]) {
        const was = target.sustainability.wasteStrategy;
        target.sustainability.wasteStrategy = p.value;
        if (chargeCosts && was !== p.value) effect.oneTimeCosts += S.wasteStrategies[p.value].once || 0;
      }
    }
    return effect;
  }

  function plannedState() {
    const planned = clone(state);
    pendingActions().forEach((action) => applyAction(planned, action, false));
    return planned;
  }

  function hasSkill(clinic, role, skill) {
    return clinic.staff.some((person) => person.role === role && person.skills.includes(skill));
  }

  function openingHours(clinic) {
    return 2256 + Object.entries(clinic.operations.openingPeriods).reduce((sum, [id, active]) => sum + (active ? D.openingPeriods[id].hours : 0), 0);
  }

  function openingConditionMet(service, clinic) {
    if (!service.operations.includes("emergencyCoverage")) return true;
    return Boolean(clinic.operations.openingPeriods.extended || clinic.operations.openingPeriods.night);
  }

  function missingRequirements(service, clinic) {
    const missing = [];
    service.roomIds.forEach((id) => { if (Number(clinic.rooms[id] || 0) <= 0) missing.push({ type: "missingRoom", id }); });
    service.equipmentIds.forEach((id) => { if (equipmentQuantity(clinic, id) <= 0) missing.push({ type: "missingEquipment", id }); });
    service.vetSkills.forEach((id) => { if (!hasSkill(clinic, "vet", id)) missing.push({ type: "missingVetSkill", id }); });
    // A vet on staff can cover support work, so a missing support skill only blocks a vet-less clinic.
    service.supportSkills.forEach((id) => { if (!hasSkill(clinic, "support", id) && !clinic.staff.some((person) => person.role === "vet")) missing.push({ type: "missingSupportSkill", id }); });
    if (!openingConditionMet(service, clinic)) missing.push({ type: "opening", id: "emergencyCoverage" });
    return missing;
  }

  function salaryCapacityMultiplier(person) {
    return 1 + clamp((person.salary / Math.max(1, person.baseSalary) - 1) * .6, -.06, .04);
  }

  function initialResources(clinic, effects) {
    const hr = D.hrStrategies[clinic.hr.strategy] || D.hrStrategies.reactive;
    const vetByService = Object.fromEntries(D.services.map((service) => [service.id, 0]));
    const supportByService = Object.fromEntries(D.services.map((service) => [service.id, 0]));
    const climate = Number(clinic.social?.staffClimate ?? 50);
    // Morale changes absence: a low climate raises it, a high climate lowers it.
    const stm = D.staffModel;
    const moraleRate = climate < stm.moraleLow ? Math.min(stm.moraleLowCap, (stm.moraleLow - climate) * stm.moraleLowSlope) : climate > stm.moraleHigh ? -Math.min(stm.moraleHighCap, (climate - stm.moraleHigh) * stm.moraleHighSlope) : 0;
    const fatigueRelief = clamp(Number(effects.fatigueRelief || 0), 0, 1);
    const preliminary = clinic.staff.map((person) => {
      const contractedHours = person.capacity * salaryCapacityMultiplier(person);
      // Last year's overtime carries into this year as extra absence.
      const fatigueRate = Math.min(.09, Number(person.lastOvertimeRatio || 0) * D.staffModel.fatigueAbsencePerOvertime) * (1 - fatigueRelief);
      const expectedAbsenceHours = contractedHours * Math.max(0, hr.absenteeism + fatigueRate + moraleRate);
      const gross = contractedHours - expectedAbsenceHours;
      const roleTraining = person.role === "vet" ? effects.vetTrainingHours : effects.supportTrainingHours;
      const sameRoleCount = Math.max(1, clinic.staff.filter((item) => item.role === person.role).length);
      const trainingHours = roleTraining / sameRoleCount + Number(effects.trainingHoursByPerson?.[person.id] || 0);
      // People hired this year spend a quarter of their time learning the clinic.
      const onboardingHours = person.hiredYear === clinic.year ? Math.max(0, gross - trainingHours) * D.staffModel.hireOnboarding : 0;
      return { person, contractedHours, expectedAbsenceHours, fatigueAbsenceHours: contractedHours * fatigueRate, moraleAbsenceHours: contractedHours * moraleRate, onboardingHours, grossHours: gross, trainingHours, beforeDuties: Math.max(0, gross - trainingHours - onboardingHours) };
    });
    const stock = D.stockStrategies[clinic.operations.stockStrategy];
    const geo = D.marketingStrategies.geomarketing[clinic.marketing.geomarketing] || D.marketingStrategies.geomarketing.none;
    const waste = D.sustainability.wasteStrategies[clinic.sustainability.wasteStrategy];
    const access = clinic.sustainability.accessPlan ? D.sustainability.interventions.accessPlan : { supportHours: 0 };
    // Named where they are taken, so the drawer that shows a person's "other duties" can say what
    // took them instead of working the list out again. The render layer's own copy listed the
    // clinic-wide figures against one person's share — with two support workers it announced 30 h
    // of other duties and then named a single 60 h cause — and left out the hours reserved by
    // decisions already in the plan.
    const reservationParts = [
      { id: "stock", hours: stock.supportHours || 0 },
      { id: "geomarketing", hours: geo.supportHours || 0 },
      { id: "waste", hours: waste.supportHours || 0 },
      { id: "accessPlan", hours: access.supportHours || 0 },
      { id: "planned", hours: effects.supportReserved || 0 }
    ].filter((part) => part.hours > 0);
    const reservedSupport = reservationParts.reduce((sum, part) => sum + part.hours, 0);
    const rawSupport = preliminary.filter((row) => row.person.role === "support").reduce((sum, row) => sum + row.beforeDuties, 0);
    const supportScale = rawSupport ? clamp((rawSupport - reservedSupport) / rawSupport, 0, 1) : 0;
    let totalVet = 0;
    let totalSupport = 0;
    const staffRows = preliminary.map((row) => {
      const { person } = row;
      const nonClinicalHours = person.role === "support" ? row.beforeDuties * (1 - supportScale) : 0;
      // This person's share of each reservation. The parts sum to their other duties by
      // construction, whatever the number of support workers and whether or not the reservation
      // exceeds the hours the clinic has.
      const partFactor = reservedSupport > 0 ? nonClinicalHours / reservedSupport : 0;
      const nonClinicalParts = partFactor > 0 ? reservationParts.map((part) => ({ id: part.id, hours: part.hours * partFactor })) : [];
      const availableHours = Math.max(0, row.beforeDuties - nonClinicalHours);
      const allocations = normalizeAllocations(person);
      const assignedShare = allocationTotal(allocations);
      const assignments = allocations.map((allocation) => {
        const service = SERVICE_BY_ID[allocation.serviceId];
        const assignedHours = availableHours * allocation.share;
        const qualified = personQualified(person, service);
        const effectiveHours = qualified ? assignedHours : 0;
        const target = person.role === "vet" ? vetByService : supportByService;
        target[service.id] = (target[service.id] || 0) + effectiveHours;
        return { serviceId: service.id, share: allocation.share, assignedHours, effectiveHours, blockedHours: qualified ? 0 : assignedHours, qualified, usedHours: 0 };
      });
      if (person.role === "vet") totalVet += availableHours;
      else totalSupport += availableHours;
      return {
        id: person.id,
        role: person.role,
        contractedHours: row.contractedHours,
        expectedAbsenceHours: row.expectedAbsenceHours,
        fatigueAbsenceHours: row.fatigueAbsenceHours,
        moraleAbsenceHours: row.moraleAbsenceHours,
        onboardingHours: row.onboardingHours,
        trainingHours: row.trainingHours,
        nonClinicalHours,
        nonClinicalParts,
        availableHours,
        hourlyRate: person.salary / Math.max(1, row.contractedHours),
        assignedShare,
        assignedHours: availableHours * assignedShare,
        assignments,
        blockedHours: assignments.reduce((sum, assignment) => sum + assignment.blockedHours, 0),
        usedHours: 0,
        overtimeHours: 0,
        overtimePay: 0,
        unusedHours: availableHours,
        workload: 0
      };
    });
    const hours = openingHours(clinic);
    const availableHours = Math.max(0, hours - effects.facilityHoursLost);
    const roomHours = Object.fromEntries(Object.entries(D.rooms).map(([id]) => [id, Number(clinic.rooms[id] || 0) * availableHours]));
    const equipmentHours = Object.fromEntries(Object.entries(D.equipment).map(([id, item]) => [id, equipmentQuantity(clinic, id) * availableHours * item.capacityHours / 2256]));
    return {
      vetByService, supportByService, totalVet, totalSupport, remainingVet: totalVet, remainingSupport: totalSupport,
      startVetByService: clone(vetByService), startSupportByService: clone(supportByService),
      rooms: roomHours, equipment: equipmentHours, startRooms: clone(roomHours), startEquipment: clone(equipmentHours), staffRows, reservedSupport: Math.min(rawSupport, reservedSupport)
    };
  }

  function servicePace(clinic, serviceId) {
    return D.servicePaces[clinic.services[serviceId]?.pace] || D.servicePaces.standard;
  }

  function caseDuration(service, clinic) {
    return service.duration * servicePace(clinic, service.id).duration;
  }

  function dropoffActive(clinic) {
    return Boolean(clinic.operations.dropoff) && clinic.staff.filter((person) => person.role === "support").length >= 2;
  }

  function vetDuration(service, clinic) {
    let value = caseDuration(service, clinic) * service.vetShare;
    if (clinic.operations.dropoff && DROPOFF_SERVICES.has(service.id) && clinic.staff.filter((person) => person.role === "support").length >= 2) value *= .9;
    return value;
  }

  function supportDuration(service, clinic) {
    let value = caseDuration(service, clinic) * service.supportShare;
    if (clinic.operations.dropoff && DROPOFF_SERVICES.has(service.id) && clinic.staff.filter((person) => person.role === "support").length >= 2) value *= 1.1;
    return value;
  }

  // The price the clinic's clients accept for a service: what their type of client will pay, raised
  // by paid communication, and moved by their trust in the clinic. One function, read by demand, by
  // the trust lost to an unfair price, and by the price screen — so what is shown is what acts.
  // A communication programme kept at the same level wears in: its trust gain halves (repeatDecay)
  // for each earlier year in a row at that level. Its demand and accepted-price effects stay.
  function communicationStrength(clinic) {
    const level = clinic.marketing?.communication;
    const decay = D.socialModel?.repeatDecay ?? 1;
    let streak = 0;
    for (let i = (clinic.history || []).length - 1; i >= 0; i--) {
      if (clinic.history[i].clinicSnapshot?.marketing?.communication === level) streak += 1; else break;
    }
    return Math.pow(decay, streak);
  }

  // What the clinic knows of the price its clients accept: a range, unless a market study narrows it.
  // The band is deliberately not centred on the true value, so its middle gives nothing away.
  function acceptedKnown(service, clinic, value = acceptedPrice(service, clinic)) {
    const study = D.marketingStrategies.geomarketing[clinic.marketing?.geomarketing] || D.marketingStrategies.geomarketing.none;
    const p = study.precision || 0;
    if (p <= 0) return { exact: true, low: Math.round(value), high: Math.round(value) };
    const tilt = ([...service.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 7) / 10 + .2;
    const low = Math.floor(value * (1 - p * 2 * tilt));
    let high = Math.ceil(value * (1 + p * 2 * (1 - tilt)));
    if (Math.abs((low + high) / 2 - value) < 1) high += 2;
    return { exact: false, low, high };
  }

  function acceptedText(known) {
    return known.exact ? money(known.low) : `${money(known.low)}–${money(known.high)}`;
  }

  function acceptedPrice(service, clinic) {
    const segment = D.segments[clinic.marketFocus];
    const communication = D.marketingStrategies.communication[clinic.marketing.communication];
    const trustFactor = 1 + (Number(clinic.social?.clientTrust ?? 50) - 50) * (D.trustModel?.priceSlope || 0);
    // Paid communication raises what clients accept paying, not only how many of them come. That is
    // what keeps it worth buying once capacity binds, when extra demand converts to nothing at all.
    return (segment.willingness[service.id] || service.price) * (1 + (communication.willingness || 0)) * trustFactor;
  }

  function projectedDemand(service, clinic, effects = emptyEffects()) {
    const segment = D.segments[clinic.marketFocus];
    const location = D.locations[clinic.location.sectorId];
    const serviceState = clinic.services[service.id];
    const communication = D.marketingStrategies.communication[clinic.marketing.communication];
    const willingness = acceptedPrice(service, clinic);
    const priceRatio = serviceState.price / Math.max(1, willingness);
    const priceEffect = priceRatio <= 1
      ? 1 + (1 - priceRatio) * service.elasticity * D.clientModel.priceUnderResponse
      // Above willingness the response decays instead of running into a flat clamp. A flat floor
      // could not work here: the old linear term reached zero at ratios from 1.65 (retail) to 5.55
      // (emergency), so every service plateaued at a different price and none could be priced out
      // of its market. Exponential decay keeps the curve strictly decreasing at every price.
      // The constant is the decay rate per unit of over-pricing, and it has to be steep enough that
      // a price rise is a decision: at 2.2 a consultation priced 20% over willingness still kept 92%
      // of its requests. Rescue prices above willingness by default, so it is the scenario this
      // constant moves; Balanced and Growth sit below it and never evaluate this branch at all.
      : Math.exp(-(priceRatio - 1) * service.elasticity * D.clientModel.priceOverDecay * segment.priceSensitivity);
    const geo = D.marketingStrategies.geomarketing[clinic.marketing.geomarketing] || D.marketingStrategies.geomarketing.none;
    const competition = location.competition;
    const socialTrust = 1 + (clinic.social.clientTrust - 50) / D.clientModel.trustDemandDivisor;
    const sm = D.socialModel || {};
    // Referring vets send imaging and specialist cases: their support moves advanced requests only.
    const referral = ADVANCED_SERVICES.has(service.id) ? Math.max(.2, 1 + (clinic.social.referralSupport - 50) * (sm.referralSlope ?? 1 / 350)) : 1;
    const pressure = ROUTINE_SERVICES.has(service.id) ? 1 + Math.max(0, clinic.social.communityPressure - 50) * (sm.pressureDemandSlope ?? 1 / 500) : 1;
    const periods = Object.entries(clinic.operations.openingPeriods).reduce((sum, [id, active]) => sum + (active ? D.openingPeriods[id].demand : 0), 0);
    const emergency = service.id === "emergency" && clinic.operations.openingPeriods.night ? D.openingPeriods.night.emergencyDemand : 0;
    const parking = clinic.location.parking && (clinic.marketFocus === "routine" || clinic.marketFocus === "budget" || service.id === "boarding") ? D.clientModel.parkingDemand : 1;
    const actionDemand = 1 + (ADVANCED_SERVICES.has(service.id) ? effects.advancedDemand : 0) + (ROUTINE_SERVICES.has(service.id) ? effects.routineDemand : 0);
    const accessDemand = clinic.sustainability.accessPlan ? 1 + D.sustainability.interventions.accessPlan.demand : 1;
    return Math.max(0, Math.round(
      service.demand * D.demandScale * (clinic.clients / 1200) * segment.serviceMix[service.id] * priceEffect *
      (location.segmentMultipliers[clinic.marketFocus] || 1) * (location.serviceMultipliers[service.id] || 1) *
      competition * (1 + communication.demand) * (1 + (geo.demand || 0)) * socialTrust * referral * pressure *
      (1 + periods + emergency) * parking * accessDemand * actionDemand * (1 - effects.relocationLoss) * (1 - (effects.focusTransition || 0))
    ));
  }

  function sustainabilityAnnualCost(clinic) {
    const S = D.sustainability;
    return S.energyUpgrades[clinic.sustainability.energyUpgrade].annual +
      S.wasteStrategies[clinic.sustainability.wasteStrategy].annual +
      (clinic.sustainability.heatPump ? S.interventions.heatPump.annual : 0) +
      (clinic.sustainability.solar ? S.interventions.solar.annual : 0) +
      (clinic.sustainability.accessPlan ? S.interventions.accessPlan.annual : 0);
  }

  function calculateCarbon(clinic, serviceResults) {
    const model = D.carbonModel;
    const factors = model.factors;
    const upgrade = D.sustainability.energyUpgrades[clinic.sustainability.energyUpgrade];
    const waste = D.sustainability.wasteStrategies[clinic.sustainability.wasteStrategy];
    const location = D.locations[clinic.location.sectorId];
    const serviceActivity = serviceResults.reduce((totals, result) => {
      const activity = SERVICE_BY_ID[result.id].carbonActivity;
      totals.electricity += (result.honored + (result.returnVisits || 0)) * activity.electricityKWhPerCase;
      totals.clinicalWaste += (result.honored + (result.returnVisits || 0)) * activity.clinicalWasteKgPerCase;
      totals.generalWaste += (result.honored + (result.returnVisits || 0)) * activity.generalWasteKgPerCase;
      totals.anaesthetic += (result.honored + (result.returnVisits || 0)) * activity.anaestheticMlPerCase;
      totals.trips += (result.honored + (result.returnVisits || 0)) * activity.clientTripsPerCase;
      return totals;
    }, { electricity: 0, clinicalWaste: 0, generalWaste: 0, anaesthetic: 0, trips: 0 });
    const roomElectricity = Object.entries(clinic.rooms).reduce((sum, [id, qty]) => sum + qty * D.rooms[id].electricityKWhYear, 0);
    const roomHeating = Object.entries(clinic.rooms).reduce((sum, [id, qty]) => sum + qty * D.rooms[id].heatingKWhYear, 0);
    let electricityKWh = (openingHours(clinic) * model.building.electricityKWhPerOpenHour + roomElectricity + serviceActivity.electricity) * upgrade.electricityMultiplier;
    let heatingKWh = (openingHours(clinic) * model.building.heatingKWhPerOpenHour + roomHeating) * upgrade.heatingMultiplier;
    const heatPump = clinic.sustainability.heatPump ? D.sustainability.interventions.heatPump : null;
    const fuelHeatingKWh = heatPump ? heatingKWh * (1 - heatPump.heatingFuelReplacement) : heatingKWh;
    if (heatPump) electricityKWh += heatingKWh * heatPump.heatingFuelReplacement / heatPump.cop;
    const solarKWh = clinic.sustainability.solar ? electricityKWh * D.sustainability.interventions.solar.electricityShare : 0;
    const purchasedElectricityKWh = Math.max(0, electricityKWh - solarKWh);
    const anaestheticMl = serviceActivity.anaesthetic * (clinic.sustainability.anaesthesiaProtocol === "lowFlow" ? D.sustainability.interventions.lowFlow.anaestheticMultiplier : 1);
    const clinicalWasteKg = serviceActivity.clinicalWaste * waste.clinicalMultiplier * waste.totalMultiplier;
    const divertedWasteKg = Math.max(0, serviceActivity.clinicalWaste * waste.totalMultiplier - clinicalWasteKg);
    const generalWasteKg = (serviceActivity.generalWaste * waste.totalMultiplier) + divertedWasteKg;
    const carShare = clamp(location.carShare + (clinic.location.parking ? .08 : 0), 0, 1);
    const travelMultiplier = clinic.sustainability.accessPlan ? D.sustainability.interventions.accessPlan.travelMultiplier : 1;
    const carKm = serviceActivity.trips * location.averageRoundTripKm * carShare * travelMultiplier;
    const bySourceKg = {
      building: purchasedElectricityKWh * factors.electricityKgPerKWh + fuelHeatingKWh * factors.naturalGasKgPerKWh,
      clinical: anaestheticMl * factors.anaestheticKgPerMl,
      waste: clinicalWasteKg * factors.clinicalWasteKgPerKg + generalWasteKg * factors.generalWasteKgPerKg,
      travel: carKm * factors.carKgPerKm
    };
    const totalKg = Object.values(bySourceKg).reduce((sum, value) => sum + value, 0);
    const totalCases = serviceResults.reduce((sum, result) => sum + result.honored, 0);
    const primaryDrivers = Object.entries(bySourceKg).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return {
      total: totalKg / 1000,
      perCase: totalCases ? totalKg / totalCases : 0,
      totalCases,
      bySource: Object.fromEntries(Object.entries(bySourceKg).map(([id, value]) => [id, value / 1000])),
      activity: { electricityKWh, purchasedElectricityKWh, solarKWh, heatingKWh, fuelHeatingKWh, anaestheticMl, clinicalWasteKg, generalWasteKg, carKm },
      factorVersion: model.version,
      primaryDrivers
    };
  }

  function lowestCap(caps) {
    const entries = Object.entries(caps);
    const min = Math.min(...entries.map(([, value]) => value));
    const [key] = entries.find(([, value]) => value === min) || ["demand"];
    if (key === "vet") return { type: "vetHours" };
    if (key === "support") return { type: "supportHours" };
    if (key.startsWith("room:")) return { type: "roomFull", id: key.split(":")[1] };
    if (key.startsWith("equipment:")) return { type: "equipmentFull", id: key.split(":")[1] };
    return { type: "demand" };
  }

  // A student who only watches an outcome learns little; one who committed to an expectation and
  // was contradicted has nowhere to hide. The plan panel already forecasts the coming year, so
  // predicting THAT would be reading a row. The question is about the year after: it is displayed
  // nowhere, and answering it means reasoning about effects that land late — a service opening at
  // 60% of its demand, an investment that only works the following year, a new hire still settling.
  function constraintKey(reason) {
    return `${reason?.type || "none"}:${reason?.id || ""}`;
  }

  function predictionOptions(planned, forecast) {
    const seen = new Map();
    const add = (reason) => { const key = constraintKey(reason); if (reason && reason.type && reason.type !== "none" && !seen.has(key)) seen.set(key, reason); };
    add({ type: "demandMet" });
    add({ type: "vetHours" });
    add({ type: "supportHours" });
    (forecast.serviceResults || []).filter((row) => row.active).forEach((row) => add(row.bottleneck));
    (forecast.operational.facilityRows || []).filter((row) => row.capacity > 0).forEach((row) => add({ type: row.kind === "room" ? "roomFull" : "equipmentFull", id: row.id }));
    add({ type: "revenue" });
    return [...seen.entries()].map(([key, reason]) => ({ key, label: blockerText(reason) }));
  }

  // The clinic's answer is a ranking, not a fact: the constraint that left the most requests
  // unserved wins, often narrowly. Rebuilt here from the service results so the student can see the
  // ranking, the margin, and where their own answer came in — an answer whose runner-up is two
  // requests behind is an answer worth arguing with.
  function constraintBreakdown(report) {
    const rows = new Map();
    (report.serviceResults || []).filter((row) => row.active).forEach((row) => {
      const key = constraintKey(row.bottleneck);
      if (!rows.has(key)) rows.set(key, { key, reason: row.bottleneck, unserved: 0, services: [] });
      const entry = rows.get(key);
      const missed = Math.max(0, row.demand - row.honored);
      entry.unserved += missed;
      if (missed > 0) entry.services.push({ id: row.id, unserved: missed });
    });
    return [...rows.values()].sort((a, b) => b.unserved - a.unserved).map((entry) => ({ ...entry, services: entry.services.sort((a, b) => b.unserved - a.unserved) }));
  }

  function dominantConstraint(unmet) {
    const entries = Object.entries(unmet).sort((a, b) => b[1].count - a[1].count);
    return entries[0]?.[1].reason || { type: "none" };
  }

  function resourceUse(start, remaining) {
    return Object.keys(start).map((id) => ({ id, capacity: start[id], used: Math.max(0, start[id] - remaining[id]), rate: start[id] ? (start[id] - remaining[id]) / start[id] : 0 }));
  }

  function clinicSnapshot(clinic) {
    return clone({
      year: clinic.year,
      treasury: clinic.treasury,
      clients: clinic.clients,
      reputation: clinic.reputation,
      marketFocus: clinic.marketFocus,
      services: clinic.services,
      staff: clinic.staff.map((person) => ({ ...person, allocations: normalizeAllocations(person) })),
      trainings: clinic.trainings,
      rooms: clinic.rooms,
      equipment: clinic.equipment,
      operations: clinic.operations,
      hr: clinic.hr,
      location: clinic.location,
      marketing: clinic.marketing,
      finance: clinic.finance,
      sustainability: clinic.sustainability
    });
  }

  function simulateYear(clinic, before, effects, actions, options = {}) {
    applyModelRules(clinic.modelRules);
    const resources = initialResources(clinic, effects);
    const stockPlan = D.stockStrategies[clinic.operations.stockStrategy] || D.stockStrategies.basic;
    let totalExpected = 0;
    let totalStockoutLost = 0;
    const results = [];
    const unmet = {};
    let revenue = 0;
    let baseVariableCosts = 0;
    let totalDemand = 0;
    let totalOpportunity = 0;
    let totalHonored = 0;
    let advancedServed = 0;
    const facilityCapacity = { room: resources.startRooms, equipment: resources.startEquipment };
    const facilityNeed = { room: {}, equipment: {} };
    const facilityLost = { room: {}, equipment: {} };
    let readyServices = 0;
    // First pass: what each open, ready, staffed service could deliver with its staff alone.
    const plans = D.services.slice().sort((a, b) => a.priority - b.priority).map((service) => {
      const serviceState = clinic.services[service.id];
      const openedThisYear = serviceState.openedYear === clinic.year;
      const expectedDemand = Math.round(projectedDemand(service, clinic, effects) * (openedThisYear ? D.clientModel.serviceRampUp : 1));
      // "Exact figures" must mean exact. The forecast clips demand at capacity BEFORE the swing is
      // applied, so a good year can never beat the projection while a bad one misses it: measured
      // over 300 class codes, the largest year-3 gap is 0.00 €. In exact mode the swing is off on
      // both sides and the plan lands to the euro. Ranges and costs keep the variance — that is
      // where uncertainty is the lesson.
      const demandVaries = clinic.setup?.forecastPrecision !== "exact";
      const demand = options.actual && demandVaries ? Math.round(expectedDemand * demandSwing(clinic, service.id)) : expectedDemand;
      const missing = missingRequirements(service, clinic);
      // A rushed case comes back a share of the time: the return uses the same vet, support and room
      // time again, consumes supplies, and earns nothing. Folding it into the time per served case
      // lets every capacity below — staff, rooms, equipment — feel it without a second pass.
      // A tired team works slower: below the climate line, every case takes longer — staff and room
      // time alike — so a low climate costs cases even when the room, not the team, is the constraint.
      const slowdown = tiredSlowdown(clinic);
      const returnRate = servicePace(clinic, service.id).returnRate || 0;
      const vd = vetDuration(service, clinic) * (1 + returnRate) * (1 + slowdown);
      const sd = supportDuration(service, clinic) * (1 + returnRate) * (1 + slowdown);
      const vetPool = resources.vetByService[service.id] || 0;
      const supportPool = resources.supportByService[service.id] || 0;
      // Drop-off animals wait outside the room while support staff work, freeing room time.
      const facilityDuration = caseDuration(service, clinic) * (1 + returnRate) * (1 + slowdown) * (dropoffActive(clinic) && DROPOFF_SERVICES.has(service.id) ? D.operationsModel.dropoffRoomFactor : 1);
      // Vet hours can cover the support part of a case; support hours cannot cover vet work.
      const unstaffed = vd > 0 && vetPool <= 0 ? { type: "unstaffed", id: "vet" } : vd + sd > 0 && vetPool + supportPool <= 0 ? { type: "unstaffed", id: "support" } : null;
      const staffCaps = { demand, vet: vd > 0 ? Math.floor(vetPool / vd) : Infinity, support: vd + sd > 0 ? Math.floor((vetPool + supportPool) / (vd + sd)) : Infinity };
      const runnable = serviceState.active && !missing.length && !unstaffed;
      const staffCap = runnable ? Math.min(...Object.values(staffCaps)) : 0;
      if (runnable) {
        service.roomIds.forEach((id) => { facilityNeed.room[id] = (facilityNeed.room[id] || 0) + staffCap * facilityDuration; });
        service.equipmentIds.forEach((id) => { facilityNeed.equipment[id] = (facilityNeed.equipment[id] || 0) + staffCap * facilityDuration; });
      }
      return { service, serviceState, demand, expectedDemand, rampUp: openedThisYear, missing, vd, sd, supportPool, facilityDuration, unstaffed, staffCaps, staffCap };
    });
    // A full room or equipment item cuts every service using it by the same share.
    const facilityFactor = (kind, id) => {
      const need = facilityNeed[kind][id] || 0;
      return need > 0 ? Math.min(1, (facilityCapacity[kind][id] || 0) / need) : 1;
    };
    plans.forEach(({ service, serviceState, demand, expectedDemand, rampUp, missing, vd, sd, supportPool, facilityDuration, unstaffed, staffCaps, staffCap }) => {
      totalOpportunity += demand;
      let honored = 0;
      let stockoutLost = 0;
      let vetUsed = 0;
      let supportUsed = 0;
      let bottleneck = serviceState.active ? { type: "demandMet" } : { type: "notOffered" };
      // Where the refused requests went, by cause: the staff hours, then the room or equipment, then
      // stock. They add up to demand − honored, so every screen can split the same number.
      const lostBy = [];
      if (serviceState.active) {
        totalDemand += demand;
        totalExpected += expectedDemand;
        if (missing.length) { bottleneck = missing[0]; lostBy.push({ reason: missing[0], count: demand }); }
        else if (unstaffed) { bottleneck = unstaffed; lostBy.push({ reason: unstaffed, count: demand }); }
        else {
          readyServices += 1;
          const caps = { ...staffCaps };
          service.roomIds.forEach((id) => { caps[`room:${id}`] = Math.floor(staffCap * facilityFactor("room", id) + 1e-9); });
          service.equipmentIds.forEach((id) => { caps[`equipment:${id}`] = Math.floor(staffCap * facilityFactor("equipment", id) + 1e-9); });
          honored = Math.max(0, Math.min(...Object.values(caps)));
          bottleneck = honored >= demand ? { type: "demandMet" } : lowestCap(caps);
          const staffOnly = Math.max(0, Math.min(staffCaps.vet, staffCaps.support, demand));
          if (demand - staffOnly > 0) lostBy.push({ reason: staffCaps.vet <= staffCaps.support ? { type: "vetHours" } : { type: "supportHours" }, count: demand - staffOnly });
          if (staffOnly - honored > 0) lostBy.push({ reason: lowestCap(Object.fromEntries(Object.entries(caps).filter(([k]) => k.includes(":")))), count: staffOnly - honored });
          if (bottleneck.type === "roomFull" || bottleneck.type === "equipmentFull") {
            const kind = bottleneck.type === "roomFull" ? "room" : "equipment";
            facilityLost[kind][bottleneck.id] = (facilityLost[kind][bottleneck.id] || 0) + Math.max(0, staffCap - honored);
          }
          // Running out of stock loses a share of cases in services that need supplies.
          if (STOCK_SERVICES.has(service.id) && stockPlan.stockoutRate > 0 && honored > 0) {
            stockoutLost = Math.round(honored * stockPlan.stockoutRate);
            honored -= stockoutLost;
            totalStockoutLost += stockoutLost;
            if (stockoutLost > 0 && bottleneck.type === "demandMet") bottleneck = { type: "stockout" };
            if (stockoutLost > 0) lostBy.push({ reason: { type: "stockout" }, count: stockoutLost });
          }
          supportUsed = Math.min(supportPool, honored * sd);
          vetUsed = honored * vd + (honored * sd - supportUsed);
          resources.vetByService[service.id] = Math.max(0, resources.vetByService[service.id] - vetUsed);
          resources.supportByService[service.id] = Math.max(0, resources.supportByService[service.id] - supportUsed);
          resources.remainingVet -= vetUsed;
          resources.remainingSupport -= supportUsed;
          service.roomIds.forEach((id) => { resources.rooms[id] = Math.max(0, resources.rooms[id] - honored * facilityDuration); });
          service.equipmentIds.forEach((id) => { resources.equipment[id] = Math.max(0, resources.equipment[id] - honored * facilityDuration); });
        }
        totalHonored += honored;
        if (ADVANCED_SERVICES.has(service.id)) advancedServed += honored;
        const key = `${bottleneck.type}:${bottleneck.id || ""}`;
        if (!unmet[key]) unmet[key] = { count: 0, reason: bottleneck };
        unmet[key].count += Math.max(0, demand - honored);
      }
      const serviceRevenue = honored * serviceState.price;
      const circularMultiplier = D.sustainability.wasteStrategies[clinic.sustainability.wasteStrategy].variableCostMultiplier;
      const returnVisits = Math.round(honored * (servicePace(clinic, service.id).returnRate || 0));
      const variable = (serviceRevenue + returnVisits * serviceState.price) * service.variableCost * circularMultiplier;
      revenue += serviceRevenue;
      baseVariableCosts += variable;
      serviceState.lastDemand = demand;
      serviceState.lastHonored = honored;
      serviceState.lastBottleneck = bottleneck;
      results.push({ id: service.id, active: serviceState.active, demand, honored, lostBy, returnVisits, acceptedPrice: Math.round(acceptedPrice(service, clinic)), price: serviceState.price, revenue: serviceRevenue, variableCosts: variable, contributionPerCase: serviceState.price * (1 - service.variableCost), missing, bottleneck, vetDuration: vd, supportDuration: sd, vetUsed, supportUsed, vetCoverHours: Math.max(0, vetUsed - honored * vd), staffCap, expectedDemand, rampUp, stockoutLost });
    });
    const facilityRows = [...Object.keys(D.rooms).map((id) => ["room", id]), ...Object.keys(D.equipment).map((id) => ["equipment", id])]
      .filter(([kind, id]) => (facilityCapacity[kind][id] || 0) > 0 || (facilityNeed[kind][id] || 0) > 0)
      .map(([kind, id]) => {
        const capacity = facilityCapacity[kind][id] || 0;
        const used = Math.max(0, capacity - ((kind === "room" ? resources.rooms[id] : resources.equipment[id]) || 0));
        const needed = facilityNeed[kind][id] || 0;
        const services = D.services.filter((service) => (kind === "room" ? service.roomIds : service.equipmentIds).includes(id) && clinic.services[service.id].active).map((service) => service.id);
        return { kind, id, capacity, needed, used, rate: capacity ? used / capacity : 0, full: needed > capacity + .5, turnedAway: facilityLost[kind][id] || 0, services };
      });
    const serviceHourRows = [];
    results.forEach((result) => {
      const service = SERVICE_BY_ID[result.id];
      const effVet = resources.startVetByService[result.id] || 0;
      const effSupport = resources.startSupportByService[result.id] || 0;
      const needVet = result.active ? result.demand * result.vetDuration : 0;
      const needSupport = result.active ? result.demand * result.supportDuration : 0;
      const supportGap = Math.max(0, needSupport - effSupport);
      const vetSpare = Math.max(0, effVet - needVet);
      [["vet", effVet, needVet + supportGap, result.vetUsed], ["support", effSupport, needSupport, result.supportUsed]].forEach(([role, effectiveHours, neededHours, usedHours]) => {
        const assignedHours = resources.staffRows.filter((row) => row.role === role).flatMap((row) => row.assignments).filter((assignment) => assignment.serviceId === result.id).reduce((sum, assignment) => sum + assignment.assignedHours, 0);
        if (!(role === "vet" ? service.vetShare : service.supportShare) && !assignedHours) return;
        // Hours short = hours that would serve more cases: the requests this service lost because
        // this role ran out, times this role's time per case. Measured against all requests instead,
        // it pointed at hours that would sit idle behind the room or the other role (owner, 2026-10-19).
        const lostToRole = (result.lostBy || []).filter((l) => l.reason.type === (role === "vet" ? "vetHours" : "supportHours")).reduce((sum, l) => sum + l.count, 0);
        // A service also held back by a full room or machine gains nothing from more staff hours: they
        // only win it room time from the services it shares with (owner's case: +94 support hours on
        // preventive care, −19 cases in all). No shortage is announced there.
        const facilityBound = (result.lostBy || []).some((l) => l.reason.type === "roomFull" || l.reason.type === "equipmentFull");
        const shortageHours = facilityBound ? 0 : lostToRole * (role === "vet" ? (result.vetDuration || 0) : (result.supportDuration || 0));
        const surplusHours = Math.max(0, effectiveHours - neededHours);
        serviceHourRows.push({ serviceId: result.id, role, assignedHours, effectiveHours, blockedHours: Math.max(0, assignedHours - effectiveHours), neededHours, usedHours: usedHours || 0, shortageHours, surplusHours });
      });
    });
    resources.staffRows.forEach((staffRow) => {
      staffRow.assignments.forEach((assignment) => {
        const result = results.find((item) => item.id === assignment.serviceId);
        const service = SERVICE_BY_ID[assignment.serviceId];
        const pool = staffRow.role === "vet" ? resources.startVetByService[assignment.serviceId] : resources.startSupportByService[assignment.serviceId];
        const serviceUsed = (staffRow.role === "vet" ? result?.vetUsed : result?.supportUsed) || 0;
        assignment.usedHours = assignment.qualified && pool > 0 ? serviceUsed * assignment.effectiveHours / pool : 0;
        assignment.blocker = assignment.qualified ? null : { type: staffRow.role === "vet" ? "missingVetSkill" : "missingSupportSkill", id: (staffRow.role === "vet" ? service.vetSkills : service.supportSkills).find((skill) => !clinic.staff.find((person) => person.id === staffRow.id)?.skills.includes(skill)) };
      });
      staffRow.usedHours = staffRow.assignments.reduce((sum, assignment) => sum + assignment.usedHours, 0);
      // Overtime is paid only for hours actually worked beyond available time.
      staffRow.overtimeHours = Math.max(0, staffRow.usedHours - staffRow.availableHours);
      staffRow.overtimePay = staffRow.overtimeHours * staffRow.hourlyRate * D.staffModel.overtimePremium;
      // Hours the clinic pays for and nobody works. There is one definition and this is it: five
      // others existed, agreeing only when nothing was blocked, and one of them counted an
      // over-allocation as free time — 1 945 idle hours reported where 1 518 were real. Blocked
      // hours are a reason some of these went unworked, never a second deduction from them.
      staffRow.unusedHours = Math.max(0, staffRow.availableHours - staffRow.usedHours);
      staffRow.workload = staffRow.availableHours ? staffRow.usedHours / staffRow.availableHours : 0;
    });
    const overtimeHours = resources.staffRows.reduce((sum, row) => sum + row.overtimeHours, 0);
    const overtimePay = resources.staffRows.reduce((sum, row) => sum + row.overtimePay, 0);
    const overtimeCost = overtimePay * (1 + D.financeModel.socialChargeRate);
    const overtimeClimate = -Math.min(D.climateModel.overtimeCap, resources.staffRows.reduce((sum, row) => sum + (row.availableHours ? row.overtimeHours / row.availableHours : 0), 0) * D.climateModel.overtimeWeight);
    const stock = D.stockStrategies[clinic.operations.stockStrategy];
    const variableCosts = baseVariableCosts * stock.multiplier;
    const payroll = clinic.staff.reduce((sum, person) => sum + person.salary, 0);
    const socialCharges = payroll * D.financeModel.socialChargeRate;
    const ownedMaintenance = Object.entries(clinic.equipment).reduce((sum, [id, counts]) => sum + counts.owned * D.equipment[id].purchase * D.equipment[id].maintenanceRate, 0);
    const leaseCosts = Object.entries(clinic.equipment).reduce((sum, [id, counts]) => sum + counts.leased * D.equipment[id].lease, 0);
    const roomRent = Object.entries(clinic.rooms).reduce((sum, [id, qty]) => sum + Math.max(0, qty - D.rooms[id].baseIncluded) * D.rooms[id].annualRent, 0);
    const location = D.locations[clinic.location.sectorId];
    const facilityCosts = location.rent + roomRent + ownedMaintenance + leaseCosts + (clinic.location.parking ? location.parkingMaintenance : 0);
    const openingCosts = Object.entries(clinic.operations.openingPeriods).reduce((sum, [id, active]) => sum + (active ? D.openingPeriods[id].cost : 0), 0);
    const dropoffCost = clinic.operations.dropoff ? 4000 : 0;
    const hrCost = D.hrStrategies[clinic.hr.strategy].cost;
    const marketingCost = Object.entries(clinic.marketing).reduce((sum, [strategy, level]) => sum + (D.marketingStrategies[strategy]?.[level]?.cost || 0), 0);
    const sustainabilityCost = sustainabilityAnnualCost(clinic);
    const admin = D.financeModel.adminBase + D.services.filter((service) => clinic.services[service.id].active).length * D.financeModel.adminPerService;
    let loanPayment = 0;
    let loanPrincipalPayment = 0;
    let loanInterest = 0;
    let nextLoan = clinic.finance.loan ? clone(clinic.finance.loan) : null;
    if (nextLoan) {
      loanPrincipalPayment = nextLoan.remaining / Math.max(1, nextLoan.yearsRemaining);
      loanInterest = nextLoan.remaining * nextLoan.rate;
      loanPayment = loanPrincipalPayment + loanInterest;
      nextLoan.remaining = Math.max(0, nextLoan.remaining - loanPrincipalPayment);
      nextLoan.yearsRemaining -= 1;
      if (nextLoan.yearsRemaining <= 0 || nextLoan.remaining < 1) nextLoan = null;
    }
    const operatingCosts = openingCosts + dropoffCost + stock.cost + hrCost + marketingCost + sustainabilityCost + admin + loanInterest;
    const fixedCosts = payroll + socialCharges + facilityCosts + operatingCosts + effects.oneTimeCosts;
    const totalCosts = variableCosts + fixedCosts + overtimeCost;
    const communeLast = lastCommitment(clinic, "commune");
    const grant = communeLast?.ok && (investsInSustainability(clinic) || !D.commitmentModel?.grantNeedsInvestment) ? (D.commitmentModel?.grant || 0) : 0;
    const operatingResult = revenue - totalCosts + grant;
    const tax = operatingResult > 0 ? operatingResult * D.financeModel.taxRate : 0;
    const netResult = operatingResult - tax;
    const financingCashAdjustment = effects.cashAdjustment - loanPrincipalPayment;
    const treasury = clinic.treasury + financingCashAdjustment + netResult;
    const honoredRate = totalDemand ? totalHonored / totalDemand : 0;
    const usedTeamHours = resources.staffRows.reduce((sum, row) => sum + row.usedHours, 0);
    const staffUse = (resources.totalVet + resources.totalSupport) ? usedTeamHours / (resources.totalVet + resources.totalSupport) : 0;
    let mainConstraint = dominantConstraint(unmet);
    if (mainConstraint.type === "none" && netResult < 0) mainConstraint = { type: "revenue" };
    const hr = D.hrStrategies[clinic.hr.strategy];
    const communication = D.marketingStrategies.communication[clinic.marketing.communication];
    const periodClimate = Object.entries(clinic.operations.openingPeriods).reduce((sum, [id, active]) => sum + (active ? D.openingPeriods[id].climate : 0), 0) * (clinic.hr.strategy === "supportive" ? D.climateModel.supportiveHoursFactor : 1);
    const averagePayRatio = clinic.staff.reduce((sum, person) => sum + person.salary / person.baseSalary, 0) / Math.max(1, clinic.staff.length);
    const payClimate = clamp((averagePayRatio - 1) * D.climateModel.payWeight, -D.climateModel.payCap, D.climateModel.payCap);
    const social = clone(clinic.social);
    const accessTrust = clinic.sustainability.accessPlan ? D.sustainability.interventions.accessPlan.trust : 0;
    const paceMix = results.reduce((sum, result) => {
      const pace = servicePace(clinic, result.id);
      return { trust: sum.trust + result.honored * pace.trust, reputation: sum.reputation + result.honored * pace.reputation };
    }, { trust: 0, reputation: 0 });
    const paceTrust = totalHonored ? paceMix.trust / totalHonored : 0;
    const paceReputation = totalHonored ? paceMix.reputation / totalHonored : 0;
    const stockoutShare = totalStockoutLost / Math.max(1, totalHonored + totalStockoutLost);
    // A price above what clients accept costs trust every year it stays there, weighted by the share
    // of cases at that price and by how sensitive this type of client is to price.
    const tm = D.trustModel || {};
    const segmentNow = D.segments[clinic.marketFocus];
    const unfair = totalHonored ? results.reduce((sum, result) => {
      if (!result.active || !result.honored) return sum;
      const service = SERVICE_BY_ID[result.id];
      const over = Math.max(0, result.price / Math.max(1, acceptedPrice(service, clinic)) - 1);
      return sum + (result.honored / totalHonored) * over;
    }, 0) : 0;
    const priceTrust = -Math.min(tm.unfairCap || 0, unfair * (tm.unfairWeight || 0) * segmentNow.priceSensitivity);
    const sm = D.socialModel || {};
    // Refused clients pile up (access pressure, carried from last year): past 50 they cost trust.
    const refusedTrust = -Math.max(0, Number(clinic.social.communityPressure ?? 50) - 50) * (sm.pressureTrustSlope || 0);
    // Clients notice the footprint per case moving: lower than last year raises trust, higher lowers it.
    // Compared with last year, not with the start, so it rewards a change rather than a service mix.
    const previousPerCase = clinic.history?.length ? clinic.history[clinic.history.length - 1].carbon?.perCase : clinic.carbonBaseline?.perCase;
    const carbonNow = calculateCarbon(clinic, results);
    const carbonTrust = previousPerCase && carbonNow.perCase ? clamp((previousPerCase - carbonNow.perCase) / previousPerCase * (sm.carbonTrustWeight || 0), -(sm.carbonTrustCap || 0), sm.carbonTrustCap || 0) : 0;
    const trustParts = { served: honoredRate * tm.servedGain - (1 - honoredRate) * tm.refusedLoss, communication: communication.trust * communicationStrength(clinic), access: accessTrust, pace: paceTrust, price: priceTrust, refused: refusedTrust, carbon: carbonTrust, dropoff: dropoffActive(clinic) ? tm.dropoffTrust : 0, stockouts: -Math.min(tm.stockoutCap, stockoutShare * tm.stockoutWeight) };
    social.clientTrust = clamp(social.clientTrust + Object.values(trustParts).reduce((sum, value) => sum + value, 0), 0, 100);
    // Rushing wears the team: each service run at a fast pace costs climate every year.
    const paceClimate = D.services.reduce((sum, service) => sum + (clinic.services[service.id]?.active ? (servicePace(clinic, service.id).climate || 0) : 0), 0);
    const climateParts = { hr: hr.climate, openingHours: periodClimate, pay: payClimate, overtime: overtimeClimate, workload: staffUse > D.climateModel.workloadHigh ? D.climateModel.workloadHighEffect : staffUse >= D.climateModel.workloadLow ? D.climateModel.workloadOkEffect : D.climateModel.workloadLowEffect, pace: paceClimate, departure: effects.climateShock || 0 };
    social.staffClimate = clamp(social.staffClimate + Object.values(climateParts).reduce((sum, value) => sum + value, 0), 0, 100);
    // Year-end resignations are deterministic so the forecast can warn about them.
    const retainedClimate = social.staffClimate + (hr.retention || 0);
    const payRatio = (person) => person.salary / Math.max(1, person.baseSalary);
    const resignations = clinic.staff.filter((person) => retainedClimate < D.staffModel.resignPayClimate && payRatio(person) < D.staffModel.resignPayRatio - .001).map((person) => ({ id: person.id, name: person.name, reason: "pay" }));
    if (!resignations.length && retainedClimate < D.staffModel.resignClimate && clinic.staff.length > 1) {
      const overtimeRatio = (person) => {
        const row = resources.staffRows.find((item) => item.id === person.id);
        return row?.availableHours ? row.overtimeHours / row.availableHours : 0;
      };
      const leaver = clinic.staff.slice().sort((a, b) => overtimeRatio(b) - overtimeRatio(a) || payRatio(a) - payRatio(b))[0];
      resignations.push({ id: leaver.id, name: leaver.name, reason: "climate" });
    }
    const demandVariance = totalExpected ? totalDemand / totalExpected - 1 : 0;
    const peersLast = lastCommitment(clinic, "peers");
    const peersReaction = peersLast ? (peersLast.ok ? (D.commitmentModel?.referralKept || 0) : (D.commitmentModel?.referralMissed || 0)) : 0;
    social.referralSupport = clamp(social.referralSupport + (advancedServed > 0 ? honoredRate * 2 : -.5) + peersReaction, 0, 100);
    // Refused clients pile up: pressure moves halfway each year toward a level set by the share refused.
    social.communityPressure = sm.pressureSpeed
      ? clamp(social.communityPressure + ((sm.pressureBase ?? 40) + (1 - honoredRate) * (sm.pressureRefusedWeight ?? 150) - social.communityPressure) * sm.pressureSpeed, 0, 100)
      : clamp(social.communityPressure + (1 - honoredRate) * (sm.pressureRise ?? 5) - (honoredRate > .84 ? (sm.pressureFall ?? 2) : 0), 0, 100);
    const segment = D.segments[clinic.marketFocus];
    const rm = D.reputationModel;
    const reputation = clamp(clinic.reputation + honoredRate * rm.served - (1 - honoredRate) * rm.refused + (netResult >= 0 ? rm.profit : rm.loss) + (social.clientTrust - 50) / rm.trustDivisor + paceReputation, rm.min, rm.max);
    // Past a line, trust stops being a mood and becomes a movement of clients: they leave below 45,
    // faster below 35, and bring others above 65. The same shape as the team climate's thresholds.
    const trustMovement = social.clientTrust < (tm.fleeBelow ?? -1) ? (tm.fleeRate || 0) : social.clientTrust < (tm.leaveBelow ?? -1) ? (tm.leaveRate || 0) : social.clientTrust > (tm.referAbove ?? 101) ? (tm.referRate || 0) : 0;
    const cm = D.clientModel;
    const clientGrowth = clamp(cm.growthBase + honoredRate * cm.growthServedWeight + (reputation - 56) * (sm.reputationGrowthWeight ?? 1 / 900) + segment.growth + (social.clientTrust - 50) * (sm.trustGrowthWeight ?? 1 / 900) + trustMovement, cm.growthMin, cm.growthMax);
    // A refused request is a family turned away; some of them go elsewhere for good, with all their
    // other visits. The leavers are counted on their own so the results can say how many.
    const refusedLeft = Math.round(Math.max(0, totalDemand - totalHonored) * (sm.refusedLeave || 0));
    const clients = Math.max(0, Math.round(clinic.clients * clientGrowth) - refusedLeft);
    const avgContribution = results.filter((r) => r.active && r.contributionPerCase > 0).reduce((sum, r, _, rows) => sum + r.contributionPerCase / rows.length, 0);
    const carbon = carbonNow;
    return {
      turn: clinic.year,
      scenarioId: clinic.scenarioId,
      actions: actions.map((action) => clone(action.payload)),
      actionRecords: actions.map((action) => clone({ key: action.key, ...action.payload, queuedAt: action.at || null, confirmedAt: action.updatedAt || null, revisions: Number(action.revisions || 0) })),
      legacyActions: [],
      clinicSnapshot: clinicSnapshot(clinic),
      serviceResults: results,
      financial: { grant, revenue, baseVariableCosts, variableCosts, payroll, socialCharges, overtimeHours, overtimePay, overtimeCost, ownedMaintenance, leaseCosts, roomRent, locationRent: location.rent, facilityCosts, openingCosts, dropoffCost, stockCost: stock.cost, hrCost, marketingCost, sustainabilityCost, admin, loanPayment, loanPrincipalPayment, loanInterest, oneTimeCosts: effects.oneTimeCosts, cashAdjustment: financingCashAdjustment, fixedCosts, totalCosts, operatingResult, tax, netResult, treasury, margin: revenue ? netResult / revenue : 0, breakEvenCases: avgContribution ? Math.ceil(fixedCosts / avgContribution) : 0 },
      operational: { totalDemand, totalOpportunity, totalHonored, honoredRate, mainConstraint, staffUse, startVetHours: resources.totalVet, remainingVetHours: resources.remainingVet, startSupportHours: resources.totalSupport, remainingSupportHours: resources.remainingSupport, reservedSupportHours: resources.reservedSupport, roomUse: resourceUse(resources.startRooms, resources.rooms), equipmentUse: resourceUse(resources.startEquipment, resources.equipment), advancedServed, readyServices, facilityRows, staffRows: resources.staffRows, serviceHourRows, stockoutLost: totalStockoutLost, expectedDemand: totalExpected, demandVariance },
      social: { before: clone(before.social || DEFAULT_SOCIAL), after: social, climateParts, trustParts, clientMovement: trustMovement, refusedLeft },
      carbon,
      recruitment: effects.recruitment,
      resignations,
      departures: [...(effects.departures || []), ...resignations],
      next: { clients, reputation, social, loan: nextLoan }
    };
  }

  function simulatePlan(actions = pendingActions()) {
    const clinic = clone(state);
    const effects = emptyEffects();
    actions.forEach((action) => combineEffects(effects, applyAction(clinic, action, true)));
    return simulateYear(clinic, state, effects, actions);
  }

  // The same plan seen one year on: the service is out of its first year at 60% of demand, the new
  // hire has finished settling in, and the move's disruption is over. Without this, "per year" named
  // the first year only — 62% below what a service actually costs from year two, permanently.
  function settledPlan(actions) {
    const clinic = clone(state);
    const effects = emptyEffects();
    actions.forEach((action) => combineEffects(effects, applyAction(clinic, action, true)));
    clinic.year += 1;
    return simulateYear(clinic, state, effects, actions);
  }

  // Only these decisions behave differently in their first year, so only these pay for the second
  // pair of simulations.
  const SETTLES_IN = new Set(["toggle-service", "market-focus", "location", "hire"]);
  function hasSettledYear(payload) {
    if (!payload || !SETTLES_IN.has(payload.kind)) return false;
    return payload.kind === "toggle-service" ? Boolean(payload.value) : true;
  }

  function forecastPair() {
    return { baseline: simulatePlan([]), forecast: simulatePlan(pendingActions()) };
  }

  function forecastSnapshot(run) {
    return {
      netResult: run.financial.netResult,
      revenue: run.financial.revenue,
      totalCosts: run.financial.totalCosts,
      treasury: run.financial.treasury,
      demand: run.operational.totalDemand,
      served: run.operational.totalHonored,
      constraintId: run.operational.mainConstraint,
      staffClimate: run.social.after.staffClimate,
      clientTrust: run.social.after.clientTrust,
      carbonTotal: run.carbon?.total ?? null,
      opportunity: run.operational.totalOpportunity ?? null
    };
  }

  // Keeps the forecast the team actually saw, the no-action comparison beside it, and the gap
  // against what happened. Without this the displayed forecast is unrecoverable after the year.
  function forecastRecord(planned, baseline, actual) {
    const shown = forecastSnapshot(planned);
    const realised = forecastSnapshot(actual);
    return {
      precision: state.setup.forecastPrecision,
      shown,
      noActionBaseline: forecastSnapshot(baseline),
      realised,
      frames: planFrames(baseline, planned).map(({ id, verdict, delta }) => ({ id, verdict, delta })),
      error: {
        netResult: realised.netResult - shown.netResult,
        served: realised.served - shown.served,
        treasury: realised.treasury - shown.treasury
      }
    };
  }

  function ensureCarbonBaseline() {
    if (state.carbonBaseline?.total > 0) return;
    const fresh = initialState(state.scenarioId, state.language);
    const report = simulateYear(fresh, fresh, emptyEffects(), []);
    state.carbonBaseline = clone(report.carbon);
    state.carbonModelVersion = D.carbonModel.version;
  }

  // The promises a year kept or broke, grouped by who holds the clinic to them.
  function commitmentsFor(report, clinic = state) {
    const map = D.commitmentModel?.stakeholders || {};
    const checks = goalChecks(report, clinic);
    return Object.entries(map).map(([id, goalIds]) => {
      const goals = checks.filter((goal) => goalIds.includes(goal.id));
      if (!goals.length) return null;
      // The municipality holds the clinic to its footprint *and* to acting on it: a service mix that
      // happens to lower carbon per case is not a promise kept.
      const invests = id === "commune" && D.commitmentModel?.grantNeedsInvestment ? investsInSustainability(clinic) : true;
      return { id, ok: goals.every((goal) => goal.ok) && invests, goals: goals.map((goal) => ({ id: goal.id, ok: goal.ok })), ...(id === "commune" ? { invests } : {}) };
    }).filter(Boolean);
  }

  function investsInSustainability(clinic) {
    const su = clinic.sustainability || {};
    return Boolean(su.energyUpgrade !== "none" || su.heatPump || su.solar || su.anaesthesiaProtocol !== "standard" || su.wasteStrategy !== "standard" || su.accessPlan);
  }

  // How many years in a row, ending with the last passed year, the bank promise was broken.
  function bankMisses(clinic) {
    let misses = 0;
    for (let i = (clinic.history || []).length - 1; i >= 0; i--) {
      const bank = (clinic.history[i].commitments || []).find((c) => c.id === "bank");
      if (!bank || bank.ok) break;
      misses++;
    }
    return misses;
  }

  function loanRate(clinic) {
    const rates = D.commitmentModel?.bankRates || [.06];
    return rates[Math.min(bankMisses(clinic), rates.length - 1)];
  }

  function lastCommitment(clinic, id) {
    const last = (clinic.history || [])[clinic.history.length - 1];
    return (last?.commitments || []).find((c) => c.id === id) || null;
  }

  function goalChecks(report, clinic = plannedState()) {
    const goals = [...(D.scenarios[state.scenarioId]?.goals || D.scenarios.balanced.goals)];
    const carbonTargets = { balanced: .15, rescue: .08, growth: .20 };
    goals.push({ id: "carbon", type: "min", metric: "carbonReduction", value: carbonTargets[state.scenarioId] || .15, label: { en: `Reduce carbon per treated case by ${Math.round((carbonTargets[state.scenarioId] || .15) * 100)}% while retaining 80% of starting case volume`, fr: `Réduire de ${Math.round((carbonTargets[state.scenarioId] || .15) * 100)} % le carbone par cas traité tout en conservant 80 % du volume initial` } });
    const baselinePerCase = state.carbonBaseline?.perCase || report.carbon?.perCase || 0;
    const baselineCases = state.carbonBaseline?.totalCases || report.operational.totalHonored || 0;
    const metrics = {
      honoredRate: report.operational.honoredRate,
      netResult: report.financial.netResult,
      treasury: report.financial.treasury,
      staffUse: report.operational.staffUse,
      readyServices: report.operational.readyServices,
      staffClimate: report.social.after.staffClimate,
      margin: report.financial.margin,
      advancedServed: report.operational.advancedServed,
      carbonReduction: baselinePerCase && report.operational.totalHonored >= baselineCases * .8 ? 1 - report.carbon.perCase / baselinePerCase : -1
    };
    return goals.map((goal) => {
      const metric = metrics[goal.metric];
      const ok = goal.type === "range" ? metric >= goal.value[0] && metric <= goal.value[1] : metric >= goal.value;
      const display = goal.metric === "honoredRate" || goal.metric === "staffUse" || goal.metric === "margin" || goal.metric === "carbonReduction" ? pct(metric)
        : goal.metric === "netResult" || goal.metric === "treasury" ? money(metric) : number(metric);
      return { ...goal, ok, display };
    });
  }

  function resolveTurn() {
    const actions = pendingActions();
    // Capture what the team was shown before any state is mutated by applyAction below.
    const shownPlan = simulatePlan(actions);
    const shownBaseline = simulatePlan([]);
    const before = clone(state);
    const effects = emptyEffects();
    actions.forEach((action) => combineEffects(effects, applyAction(state, action, true)));
    const report = simulateYear(state, before, effects, actions, { actual: true });
    report.forecastShown = forecastRecord(shownPlan, shownBaseline, report);
    // When the year was passed: with the decision times, it shows how long a team stayed on a year.
    report.passedAt = new Date().toISOString();
    report.commitments = commitmentsFor(report, state);
    logDecision("pass", `year:${report.turn}`);
    // Adjudicate BEFORE the new prediction replaces the old one: the student answers for year T+1
    // while passing year T, so at the moment year T resolves the pending slot still holds the
    // prediction made a year ago. No score is attached — the pairing is the whole of the teaching.
    if (state.prediction && state.prediction.forYear === report.turn) {
      const actual = constraintKey(report.operational.mainConstraint);
      report.prediction = { predicted: state.prediction.constraint, actual, match: state.prediction.constraint === actual };
      logDecision("prediction-resolved", `${state.prediction.constraint}→${actual}`);
    }
    state.prediction = ui.predictionDraft ? { forYear: report.turn + 1, constraint: ui.predictionDraft } : null;
    if (ui.predictionDraft) logDecision("prediction", `year:${report.turn + 1}:${ui.predictionDraft}`);
    ui.predictionDraft = null;
    state.treasury = report.financial.treasury;
    state.clients = report.next.clients;
    state.reputation = report.next.reputation;
    state.social = report.next.social;
    state.finance.loan = report.next.loan;
    state.staff.forEach((person) => {
      const row = report.operational.staffRows.find((item) => item.id === person.id);
      person.lastOvertimeRatio = row?.availableHours ? row.overtimeHours / row.availableHours : 0;
    });
    const leaving = new Set((report.resignations || []).map((item) => item.id));
    if (leaving.size) state.staff = state.staff.filter((person) => !leaving.has(person.id));
    // `before` was already cloned above and thrown away. Keeping it is the whole of undo: the model
    // has no random generator — the demand seed is a pure function of class code, scenario and year
    // — so restoring this object and passing the year again reproduces the year exactly.
    // `history` and `undo` are excluded: history is restored by truncation, and nesting the previous
    // snapshot inside the next would make the save grow by a year every year.
    const snapshot = { ...before };
    delete snapshot.history;
    delete snapshot.undo;
    state.undo = { year: report.turn, at: new Date().toISOString(), snapshot, historyLength: before.history.length, cashLogLength: (before.cashLog || []).length };
    state.history.push(report);
    state.pending = {};
    state.year += 1;
    state.domain = "results";
    ui.drawer = null;
    ui.drawerContext = null;
    ui.confirm = null;
    if (!state.sandboxMode) {
      if (state.treasury < state.rules.bankruptcyThreshold) state.endState = { type: "failure", reportTurn: report.turn };
      else if (report.turn >= state.rules.targetYear) state.endState = { type: state.treasury < 0 ? "strained" : "success", reportTurn: report.turn };
    }
    saveState();
    render();
    toast(t("toast.yearComplete", { year: report.turn }), "good");
  }

  // Undoing a year restores the clinic but never the record of it. The decision log is research data
  // and the reflections are the students' own writing, so both survive; an `undo-year` entry is
  // appended instead, and the instructor's report prints it. A cash adjustment announced after the
  // year was passed sits outside the snapshot, so it is re-applied rather than silently erased.
  function undoYear() {
    const memo = state.undo;
    if (!memo) return false;
    const kept = {
      decisionLog: state.decisionLog,
      cashLog: state.cashLog,
      setupLog: state.setupLog,
      reflections: state.reflections,
      rules: state.rules,
      setup: state.setup,
      playerTeam: state.playerTeam,
      uiPreferences: state.uiPreferences,
      language: state.language
    };
    const lateCash = (state.cashLog || []).slice(memo.cashLogLength).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const history = state.history.slice(0, memo.historyLength);
    state = { ...memo.snapshot, ...kept, history, undo: null };
    state.treasury += lateCash;
    logDecision("undo-year", `year:${memo.year}`);
    ui.drawer = null;
    ui.drawerContext = null;
    ui.confirm = null;
    saveState();
    render();
    return true;
  }

  function blockerText(reason) {
    if (!reason) return t("blockers.none");
    const type = reason.type || "none";
    if (type === "room" || type === "missingRoom" || type === "roomFull") return t(`blockers.${type}`, { name: roomName(reason.id) });
    if (type === "equipment" || type === "missingEquipment" || type === "equipmentFull") return t(`blockers.${type}`, { name: equipmentName(reason.id) });
    if (type === "unstaffed") return t("blockers.unstaffed", { name: reason.id === "vet" ? L("veterinary work", "travail vétérinaire") : L("support work", "travail de soutien") });
    if (type === "missingVetSkill" || type === "missingSupportSkill") return t(`blockers.${type}`, { name: skillName(reason.id) });
    if (type === "opening") return t("blockers.opening", { name: itemLabel({ en: "emergency coverage", fr: "couverture d’urgence" }) });
    return t(`blockers.${type}`);
  }

  function actionLabel(payload) {
    if (!payload) return "";
    const verb = (on, off) => payload.value ? on : off;
    if (payload.kind === "toggle-service") return t("actions.toggleService", { verb: verb(t("common.open"), t("common.close")), name: serviceName(payload.targetId) });
    if (payload.kind === "price") return t("actions.price", { name: serviceName(payload.targetId), value: money(payload.value) });
    if (payload.kind === "market-focus") return t("actions.marketFocus", { name: itemLabel(D.segments[payload.targetId].name) });
    if (payload.kind === "equipment-acquire") return t("actions.equipment", { verb: payload.mode === "lease" ? t("facilities.lease") : t("facilities.buy"), name: equipmentName(payload.targetId) });
    if (payload.kind === "equipment-remove") return t("actions.equipment", { verb: payload.mode === "lease" ? t("facilities.return") : t("facilities.sell"), name: equipmentName(payload.targetId) });
    if (payload.kind === "room-add" || payload.kind === "room-close") return t("actions.room", { verb: payload.kind === "room-add" ? t("facilities.addRoom") : t("facilities.closeRoom"), name: roomName(payload.targetId) });
    if (payload.kind === "hire") return t("actions.hire", { name: candidateById(payload.targetId)?.name || payload.targetId, salary: money(typeof payload.value === "object" ? payload.value.offeredSalary : payload.value) });
    if (payload.kind === "salary") return t("actions.salary", { name: state.staff.find((p) => p.id === payload.targetId)?.name || payload.targetId, salary: money(payload.value) });
    if (payload.kind === "schedule") return t("actions.schedule");
    if (payload.kind === "staff-allocation") return L(`Change time allocation for ${state.staff.find((p) => p.id === payload.targetId)?.name || payload.targetId}`, `Modifier l’affectation du temps de ${state.staff.find((p) => p.id === payload.targetId)?.name || payload.targetId}`);
    if (payload.kind === "training" && payload.personId) { const name = state.staff.find((p) => p.id === payload.personId)?.name || candidateById(payload.personId)?.name || payload.personId; const skill = itemLabel(D.trainings[payload.targetId]?.name); return L(`Train ${name} in ${skill}`, `Former ${name} : ${skill}`); }
    if (payload.kind === "training") return t("actions.training", { name: itemLabel(D.trainings[payload.targetId]?.name) });
    if (payload.kind === "fire") { const name = state.staff.find((p) => p.id === payload.targetId)?.name || candidateById(payload.targetId)?.name || payload.targetId; return L(`Let ${name} go`, `Se séparer de ${name}`); }
    if (payload.kind === "service-pace") { const pace = itemLabel(D.servicePaces[payload.value]?.name || { en: payload.value, fr: payload.value }); return L(`Set ${serviceName(payload.targetId)} pace to ${pace}`, `Rythme de ${serviceName(payload.targetId)} : ${pace}`); }
    if (payload.kind === "opening-period") return t("actions.opening", { verb: verb(t("common.add"), t("common.remove")), name: itemLabel(D.openingPeriods[payload.targetId].name) });
    if (payload.kind === "dropoff") return t("actions.dropoff", { verb: verb(t("common.add"), t("common.remove")) });
    if (payload.kind === "stock-strategy") return t("actions.stock", { name: itemLabel(D.stockStrategies[payload.targetId].name) });
    if (payload.kind === "hr-strategy") return t("actions.hr", { name: itemLabel(D.hrStrategies[payload.targetId].name) });
    if (payload.kind === "location") return t("actions.location", { name: itemLabel(D.locations[payload.targetId].name) });
    if (payload.kind === "parking") return t("actions.parking", { verb: verb(t("common.add"), t("common.remove")) });
    if (payload.kind === "marketing-strategy") return t("actions.marketing", { type: strategyLabel(payload.strategy), name: itemLabel(D.marketingStrategies[payload.strategy][payload.targetId].name) });
    if (payload.kind === "social-action") return t("actions.social", { name: itemLabel(D.socialActions[payload.targetId]?.name || { en: payload.targetId, fr: payload.targetId }) });
    if (payload.kind === "loan") return t("actions.loan", { amount: money(payload.value) });
    if (payload.kind === "repay-loan") return t("actions.repay");
    if (payload.kind === "sustainability") {
      if (payload.targetId === "energyUpgrade") return t("actions.sustainability", { name: itemLabel(D.sustainability.energyUpgrades[payload.value].name) });
      if (payload.targetId === "wasteStrategy") return t("actions.sustainability", { name: itemLabel(D.sustainability.wasteStrategies[payload.value].name) });
      if (payload.targetId === "anaesthesiaProtocol") return t("actions.sustainability", { name: itemLabel(payload.value === "lowFlow" ? D.sustainability.interventions.lowFlow.name : { en: "Standard anaesthesia", fr: "Anesthésie standard" }) });
      const name = itemLabel(D.sustainability.interventions[payload.targetId]?.name || { en: payload.targetId, fr: payload.targetId });
      return payload.value ? t("actions.sustainability", { name }) : L(`Remove ${name}`, `Retirer ${name}`);
    }
    return payload.legacyLabel || payload.kind;
  }

  function strategyLabel(strategy) {
    const labels = {
      communication: { en: "communication", fr: "la communication" },
      geomarketing: { en: "local market study", fr: "l’étude du marché local" }
    };
    return itemLabel(labels[strategy] || { en: strategy, fr: strategy });
  }

  function plural(count, singular, pluralForm) {
    return `${number(count)} ${count === 1 ? singular : pluralForm}`;
  }

  // Segments are described by what they actually ask for and what they will pay, because those are
  // the fields that drive demand. Their `size` is not used by the model and is deliberately unshown.
  function segmentAppetite(segment) {
    const wanted = Object.entries(segment.serviceMix || {}).filter(([, factor]) => factor > 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => serviceName(id));
    const asks = wanted.length ? L(`Asks most for: ${wanted.join(", ")}`, `Demande surtout : ${wanted.join(", ")}`) : L("Asks evenly across services", "Demande équilibrée entre les services");
    const tolerance = segment.priceSensitivity <= .8 ? L("Low", "Faible") : segment.priceSensitivity <= 1.2 ? L("Medium", "Moyenne") : L("High", "Élevée");
    return `${asks} · ${L("Price sensitivity", "Sensibilité au prix")}: ${tolerance}`;
  }

  function priceSensitivity(value) {
    if (value <= .25) return L("Low", "Faible");
    if (value <= .50) return L("Medium", "Moyenne");
    return L("High", "Élevée");
  }

  // Requests the market made for services the clinic does not offer. The served rate counts only
  // open services, so without this the dashboard can read 100% while most of the market is refused.
  // Requests the clinic could take on this year: services closed but ready to open (nothing missing).
  // The rest of the market — surgery without a theatre — is not a lever yet, so it is not shown here.
  function offerableRequests(forecast) {
    const clinic = plannedState();
    return Math.round((forecast.serviceResults || []).filter((r) => !r.active && !missingRequirements(SERVICE_BY_ID[r.id], clinic).length).reduce((sum, r) => sum + (r.demand || 0), 0));
  }

  function unmetRequests(forecast) {
    return Math.max(0, Math.round((forecast.operational.totalOpportunity || 0) - (forecast.operational.totalDemand || 0)));
  }

  function annualCostDrivers(forecast) {
    const financial = forecast.financial;
    return [
      { key: "payroll", label: L("payroll and employer costs", "les salaires et charges"), value: financial.payroll + financial.socialCharges },
      { key: "facilities", label: L("rooms, equipment, and rent", "les salles, l’équipement et le loyer"), value: financial.facilityCosts },
      { key: "supplies", label: L("direct supplies", "les fournitures directes"), value: financial.variableCosts },
      { key: "operations", label: L("other annual operating costs", "les autres coûts annuels de fonctionnement"), value: financial.openingCosts + financial.dropoffCost + financial.stockCost + financial.hrCost + financial.marketingCost + financial.sustainabilityCost + financial.admin },
      { key: "loanInterest", label: L("loan interest", "les intérêts d’emprunt"), value: financial.loanInterest || 0 }
    ].filter((row) => row.key !== "loanInterest" || row.value > 0).sort((a, b) => b.value - a.value);
  }

  const SERVICE_FAMILY = { consult: "core", vaccination: "core", preventive: "core", emergency: "core", lab: "diagnostics", ultrasound: "diagnostics", radiography: "diagnostics", surgery: "surgery", dentistry: "surgery", orthopedic: "surgery", hospital: "hospital", pharmacy: "commercial", retail: "commercial", boarding: "commercial" };

  function serviceDestination(serviceId) {
    return { drawer: "services", context: SERVICE_FAMILY[serviceId], service: serviceId };
  }

  function facilityName(row) {
    return row.kind === "room" ? roomName(row.id) : equipmentName(row.id);
  }

  function closedAssignments(person, clinic) {
    return normalizeAllocations(person).filter((row) => row.share > 0 && !clinic.services[row.serviceId]?.active);
  }

  function serviceStatusLabel(row) {
    if (!row.active) return L("Closed", "Fermé");
    if (row.missing?.length) return L("Blocked", "Bloqué");
    if (row.bottleneck.type === "unstaffed") return L("Nobody assigned", "Personne d’affecté");
    return L("Running", "En service");
  }

  function signalButton(destination, label, tone) {
    const target = destination.drawer
      ? `data-open-drawer="${destination.drawer}"${destination.context ? ` data-context="${escapeHtml(destination.context)}"` : ""}${destination.service ? ` data-service="${escapeHtml(destination.service)}"` : ""}`
      : `data-domain="${destination.domain}"`;
    return `<button class="button ${tone}" ${target}>${escapeHtml(label)}</button>`;
  }

  // Signals are ordered by how directly they block care: wasted hours first,
  // then unstaffed services, full facilities, staff shortages, money, idle time.
  function getBeginnerSignals(forecast, clinic) {
    const signals = [];
    const rows = Object.fromEntries(forecast.operational.staffRows.map((row) => [row.id, row]));
    const onClosed = clinic.staff.map((person) => {
      const closed = closedAssignments(person, clinic);
      return { person, closed, hours: closed.reduce((sum, row) => sum + (rows[person.id]?.availableHours || 0) * row.share, 0) };
    }).filter((item) => item.hours > 1).sort((a, b) => b.hours - a.hours)[0];
    if (onClosed) {
      const names = onClosed.closed.map((row) => serviceName(row.serviceId)).join(", ");
      const first = onClosed.closed[0].serviceId;
      signals.push({
        key: "hoursOnClosedServices", status: "bad", destination: serviceDestination(first),
        title: L(`${onClosed.person.name}’s hours go to closed services`, `Les heures de ${onClosed.person.name} vont à des services fermés`),
        text: L(`${number(onClosed.hours)} paid hours · ${names} closed`, `${number(onClosed.hours)} h payées · ${names} : fermé`),
        action: L(`Investigate ${serviceName(first)}`, `Examiner ${serviceName(first)}`),
        secondary: { label: L("Move the hours", "Déplacer les heures"), destination: { drawer: "staffAllocation", context: onClosed.person.id } }
      });
    }
    (forecast.resignations || []).slice(0, 1).forEach((leaver) => {
      signals.push({
        key: "resignationRisk", status: "bad", destination: { drawer: "hr" },
        title: L(`${leaver.name} is set to resign at year end`, `${leaver.name} va démissionner en fin d’année`),
        text: leaver.reason === "pay"
          ? L(`pay below ${Math.round(D.staffModel.resignPayRatio * 100)} % of benchmark · climate ${number(forecast.social.after.staffClimate)}`, `salaire sous ${Math.round(D.staffModel.resignPayRatio * 100)} % de la référence · climat ${number(forecast.social.after.staffClimate)}`)
          : L(`climate ${number(forecast.social.after.staffClimate)}`, `climat ${number(forecast.social.after.staffClimate)}`),
        action: L("Review HR strategy", "Examiner la stratégie RH"),
        secondary: leaver.reason === "pay"
          ? { label: L(`Review ${leaver.name}’s pay`, `Examiner le salaire de ${leaver.name}`), destination: { drawer: "staffPerson", context: leaver.id } }
          : { label: L("Climate and trust", "Climat et confiance"), destination: { drawer: "relations" } }
      });
    });
    const unstaffed = forecast.serviceResults.find((row) => row.active && row.bottleneck.type === "unstaffed");
    if (unstaffed) {
      const service = SERVICE_BY_ID[unstaffed.id];
      const needsVet = unstaffed.bottleneck.id === "vet";
      const able = clinic.staff.filter((person) => roleCompatible(person, service) && personQualified(person, service) && (!needsVet || person.role === "vet"));
      const candidate = able.find((person) => person.role === (needsVet ? "vet" : "support")) || able[0];
      signals.push({
        key: "unstaffedService", status: "bad", destination: candidate ? { drawer: "staffAllocation", context: candidate.id } : { drawer: "capabilities" },
        title: L(`${serviceName(unstaffed.id)} is open but nobody works on it`, `${serviceName(unstaffed.id)} est ouvert mais personne n’y travaille`),
        text: L(`0 of ${number(unstaffed.demand)} requests served`, `0 des ${number(unstaffed.demand)} demandes traitées`),
        action: candidate ? L(`${candidate.name}’s time`, `Temps de ${candidate.name}`) : L("See who can do what", "Voir qui peut faire quoi")
      });
    }
    // Measurements, not causes: the busiest room or machine, and the service refusing the most.
    // Which of them limits the clinic is the students' call, confirmed in Résultats.
    const busiest = (forecast.operational.facilityRows || []).filter((row) => row.capacity > 0 && row.rate >= .9).sort((a, b) => b.rate - a.rate)[0];
    if (busiest) {
      signals.push({
        key: "facilityBusy", status: "warn", destination: { drawer: busiest.kind === "room" ? "rooms" : "equipment" },
        title: facilityName(busiest),
        text: `${number(busiest.used)} / ${number(busiest.capacity)} h · ${pct(busiest.rate)}`,
        action: busiest.kind === "room" ? L("See the rooms", "Voir les salles") : L("See the equipment", "Voir l’équipement")
      });
    }
    const mostRefused = forecast.serviceResults.filter((row) => row.active && row.demand - row.honored - stockoutsFor(forecast, row.id) > 0).sort((a, b) => (b.demand - b.honored) - (a.demand - a.honored))[0];
    if (mostRefused) {
      signals.push({
        key: "serviceRefusing", status: "warn", destination: serviceDestination(mostRefused.id),
        title: serviceName(mostRefused.id),
        text: L(`${number(mostRefused.honored)} / ${number(mostRefused.demand)} served · ${number(mostRefused.demand - mostRefused.honored)} refused`, `${number(mostRefused.honored)} / ${number(mostRefused.demand)} traités · ${number(mostRefused.demand - mostRefused.honored)} refusées`),
        action: L(`Investigate ${serviceName(mostRefused.id)}`, `Examiner ${serviceName(mostRefused.id)}`),
        secondary: { label: L("Team", "Équipe"), destination: { domain: "team" } }
      });
    }
    if (forecast.financial.netResult < 0) {
      const largest = annualCostDrivers(forecast)[0];
      signals.push({
        key: "financialLoss", status: "bad", destination: { domain: "business" },
        title: L("Income does not cover annual costs", "Les recettes ne couvrent pas les coûts annuels"),
        text: L(
          `The clinic is short by ${money(Math.abs(forecast.financial.netResult))}. Its largest annual cost is ${largest.label} at ${money(largest.value)}.`,
          `Il manque ${money(Math.abs(forecast.financial.netResult))}. Le coût annuel principal est ${largest.label}, soit ${money(largest.value)}.`
        ),
        action: L("Review income and costs", "Examiner recettes et coûts")
      });
    }
    if (forecast.operational.staffUse < .65) {
      const idlest = forecast.operational.staffRows.slice().sort((a, b) => b.unusedHours - a.unusedHours)[0];
      const person = clinic.staff.find((item) => item.id === idlest?.id);
      const openable = person ? D.services.filter((service) => !clinic.services[service.id].active && roleCompatible(person, service) && personQualified(person, service) && !missingRequirements(service, clinic).length).map((service) => ({ id: service.id, demand: projectedDemand(service, clinic) })).sort((a, b) => b.demand - a.demand)[0] : null;
      signals.push({
        key: "teamUnderused", status: "warn", destination: openable ? serviceDestination(openable.id) : { drawer: "services" },
        title: L("Much of the team’s paid time is unused", "Une grande partie du temps payé de l’équipe est inutilisée"),
        text: L(`${pct(1 - forecast.operational.staffUse)} of paid hours not worked${person ? ` · ${person.name} ${number(idlest.unusedHours)} h` : ""}`, `${pct(1 - forecast.operational.staffUse)} des heures payées non travaillées${person ? ` · ${person.name} ${number(idlest.unusedHours)} h` : ""}`),
        action: openable ? L(`Investigate ${serviceName(openable.id)}`, `Examiner ${serviceName(openable.id)}`) : L("Explore compatible services", "Explorer les services compatibles"),
        secondary: person ? { label: L(`Change ${person.name}’s time`, `Modifier le temps de ${person.name}`), destination: { drawer: "staffAllocation", context: person.id } } : null
      });
    }
    // Never show two primary buttons to the same place: a repeat falls back to its secondary action.
    const seen = new Set();
    const unique = signals.map((signal) => {
      const target = JSON.stringify(signal.destination);
      if (!seen.has(target)) { seen.add(target); return signal; }
      const fallback = signal.secondary && JSON.stringify(signal.secondary.destination);
      if (fallback && !seen.has(fallback)) { seen.add(fallback); return { ...signal, destination: signal.secondary.destination, action: signal.secondary.label, secondary: null }; }
      return null;
    }).filter(Boolean);
    return unique.slice(0, 3).map((signal) => ({ ...signal, scenarioId: clinic.scenarioId }));
  }

  function formatMetric(value, type) {
    if (type === "money") return money(value);
    if (type === "percent") return pct(value);
    if (type === "carbon") return tonnes(value);
    return number(value);
  }

  // Five pages show cards for the year that has not been played, and the results page shows cards
  // for the year that has. "Résultat net" was the label on both, so one name answered to two
  // numbers and nothing on screen said which was which. In exact precision — the default — not even
  // the word "forecast" appeared.
  function forecastGridNote() {
    return `<p class="grille-note">${escapeHtml(L(`Forecast for Year ${state.year} — the plan as it stands, not a result`, `Prévision pour l’année ${state.year} — le plan en l’état, pas un résultat`))}</p>`;
  }

  function resolvedGridNote(turn) {
    return `<p class="grille-note">${escapeHtml(L(`Year ${turn}, as played`, `Année ${turn}, telle que jouée`))}</p>`;
  }

  function metricCard(label, value, note = "", tone = "", lien = null) {
    return `<article class="metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<em>${escapeHtml(note)}</em>` : ""}${lien ? `<button class="text-button" data-open-drawer="${lien.drawer}">${escapeHtml(lien.label)} ›</button>` : ""}</article>`;
  }

  function meter(value, tone = "") {
    return `<div class="meter" aria-hidden="true"><i class="${tone}" style="width:${clamp(value, 0, 1) * 100}%"></i></div>`;
  }

  function renderHeader(planned) {
    const limitText = state.rules.unlimited ? t("app.unlimited") : state.rules.actionLimit;
    return `
      <header class="command-bar">
        <div class="brand-block"><strong>${escapeHtml(t("app.brand"))}</strong><span>${escapeHtml(t("app.year", { year: state.year, target: state.rules.targetYear }))}</span></div>
        <div class="command-metrics">
          <div><span>${escapeHtml(t("app.treasury"))}</span><strong>${escapeHtml(money(state.treasury))}</strong></div>
          <div class="${countedActions().length >= actionLimit() ? "at-limit" : ""}"><span>${escapeHtml(t("app.actions"))}</span><strong>${countedActions().length}/${escapeHtml(limitText)}</strong></div>
          <div class="hide-small"><span>${escapeHtml(t("app.scenario"))}</span><strong>${escapeHtml(itemLabel(D.scenarios[state.scenarioId].name))}</strong></div>
        </div>
        <div class="header-actions">
          <div class="language-switch" role="group" aria-label="${escapeHtml(t("app.language"))}">
            <button data-language="fr" class="${state.language === "fr" ? "active" : ""}" aria-pressed="${state.language === "fr"}">FR</button>
            <button data-language="en" class="${state.language === "en" ? "active" : ""}" aria-pressed="${state.language === "en"}">EN</button>
          </div>
          <button class="button secondary" data-open-drawer="setup" aria-label="${escapeHtml(L("Game setup", "Paramétrage de la partie"))}">⚙<span class="hide-small"> ${escapeHtml(L("Game setup", "Paramétrage"))}</span></button>
          <button class="button secondary" data-help>${escapeHtml(t("app.help"))}</button>
          <button class="button secondary hide-small" data-export>${escapeHtml(t("app.export"))}</button>
        </div>
      </header>
    `;
  }

  // Each drawer belongs to one work area; opening it moves the page behind it there.
  const DRAWER_HOME = { relations: "team", services: "care", rooms: "care", equipment: "care", person: "team", staffAllocation: "team", staffPerson: "team", staffExit: "team", training: "team", capabilities: "team", hoursByService: "team", serviceLedger: "results", recruitment: "team", opening: "team", dropoff: "team", stock: "team", hr: "team", pricing: "business", finance: "business", market: "business", location: "business", marketing: "business", sustainability: "sustainability", plan: null, export: null, setup: null, atelier: null };
  const AREAS = ["overview", "care", "team", "business", "sustainability", "results"];
  // Older per-person drawers now open the person hub on the matching tab.
  const PERSON_TABS = { staffAllocation: "time", staffPerson: "pay", staffExit: "exit", training: "training" };

  function areaLabel(id) {
    return ({ overview: L("Overview", "Vue d’ensemble"), care: L("Care & facilities", "Soins et installations"), team: L("Team & operations", "Équipe et opérations"), business: L("Business", "Gestion"), sustainability: L("Sustainability", "Durabilité"), results: L("Results", "Résultats") })[id] || id;
  }

  function drawerTitleFor(drawer) {
    return drawerTitles()[drawer] || areaLabel(DRAWER_HOME[drawer] || state.domain);
  }

  function drawerBreadcrumb(planned) {
    if (ui.returnLabel) return ui.returnLabel;
    const home = DRAWER_HOME[ui.drawer];
    const parts = [home ? areaLabel(home) : L("Decision workspace", "Espace de décision")];
    if (ui.drawer === "services" && ui.selectedServiceId) parts.push(serviceName(ui.selectedServiceId));
    if (["person", "training"].includes(ui.drawer) && ui.drawerContext) parts.push(planned.staff.find((item) => item.id === ui.drawerContext)?.name || state.staff.find((item) => item.id === ui.drawerContext)?.name || "");
    return parts.filter(Boolean).join(" › ");
  }

  function openDrawer(drawer, context = null, detail = null) {
    // Closing has to put the student back exactly where they left. The origin is a ROUTE, not a
    // work area: a student who jumps from a service's missing-requirement list to buy the room must
    // land back on that service card, not on the bare Care page, or they believe they opened the
    // service when they only bought the room. It must be captured before anything below mutates,
    // and applyRoute already restores every field the route encodes.
    // Every open pushes where we were; every close pops back one step. A student who jumps from a
    // service's missing-requirement list to buy the room lands back on that service card — without
    // it they believe they opened the service when they only bought the room. Captured before
    // anything below mutates; applyRoute restores every field the route encodes.
    ui.originStack = [...(ui.originStack || []), routeFor()].slice(-6);
    let target = drawer;
    if (PERSON_TABS[drawer] && context) { target = "person"; detail = detail && drawer === "person" ? detail : PERSON_TABS[drawer]; }
    ui.lastFocus = { drawer, context: context || "" };
    ui.drawer = target;
    ui.drawerContext = context;
    ui.selectedServiceId = target === "services" ? detail : null;
    if (target === "person") ui.personTab = detail || "time";
    ui.drawerStep = 1;
    ui.confirm = null;
    ui.passCheck = false;
    ui.candidateLimit = 4;
    ui.autoFocusDrawer = true;
    const home = DRAWER_HOME[target];
    if (home && state.domain !== home) { state.domain = home; saveState(); }
    render();
    announce(drawerTitle());
  }

  // Hash routes: #area/drawer/context/detail, so Back and refresh keep the student's place.
  function parseRoute(hash) {
    const [domain, drawer, context, detail] = String(hash || "").replace(/^#/, "").split("/").map((part) => decodeURIComponent(part || ""));
    return { domain: AREAS.includes(domain) ? domain : null, drawer: drawer && drawer in DRAWER_HOME ? drawer : null, context: context || null, detail: detail || null };
  }

  function routeFor() {
    const detail = ui.drawer === "person" ? ui.personTab : ui.drawer === "services" ? ui.selectedServiceId : null;
    const parts = [state.domain, ...(ui.drawer ? [ui.drawer, ui.drawerContext || "", detail || ""] : [])];
    while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
    return `#${parts.map((part) => encodeURIComponent(part)).join("/")}`;
  }

  // `replaceRoute` marks a navigation that should not become a Back step. Loading with no hash was
  // the worst case: the first render pushed #overview on top of the bare document, and Back landed
  // on a hashless URL that re-pushed it, so Back could never leave the page.
  function syncRoute() {
    if (typeof location === "undefined" || !window.history?.pushState) return;
    const next = routeFor();
    const replace = ui.replaceRoute || !location.hash;
    ui.replaceRoute = false;
    if (location.hash === next) return;
    if (replace && window.history.replaceState) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
  }

  function applyRoute(route) {
    if (route.domain) state.domain = route.domain;
    // A link and a click must land on the same screen. openDrawer folds the legacy per-person
    // drawers into the person hub; without the same fold here, the workbook's own link
    // (#team/staffAllocation/support-maya) opened a different, untabbed screen than the button did.
    let drawer = route.drawer;
    let detail = route.detail;
    if (drawer && PERSON_TABS[drawer] && route.context) { detail = drawer === "person" ? detail : PERSON_TABS[drawer]; drawer = "person"; }
    ui.drawer = drawer;
    ui.drawerContext = drawer ? route.context : null;
    ui.selectedServiceId = drawer === "services" ? detail : null;
    if (drawer === "person") ui.personTab = detail || "time";
    // Arriving by Back must not inherit leftovers from the last drawer: a stale step reopened
    // recruitment on the applicant list, and a stale restore stole focus and forced scroll to 0.
    ui.drawerStep = 1;
    ui.restore = null;
    ui.focusItem = null;
    ui.returnLabel = null;
    ui.candidateLimit = 4;
    ui.confirm = null;
    ui.passCheck = false;
  }

  function renderStartBanner() {
    const last = state.history[state.history.length - 1];
    const lastYear = last ? `<p class="last-year">${escapeHtml(L(`Year ${state.year}. Last year: net ${money(last.financial.netResult)}, ${number(last.operational.totalHonored)} cases served.`, `Année ${state.year}. L’an dernier : résultat net ${money(last.financial.netResult)}, ${number(last.operational.totalHonored)} cas traités.`))} <button class="text-button" data-domain="results">${escapeHtml(L("See results", "Voir les résultats"))} ›</button></p>` : "";
    const showSetup = !state.history.length && !(state.setupLog || []).length && !state.uiPreferences.setupBannerDismissed;
    const banner = showSetup ? `<section class="setup-banner"><div><strong>${escapeHtml(L("Before you start", "Avant de commencer"))}</strong><span>${escapeHtml(L("Enter your instructor’s game settings: starting cash, forecast precision, class code, and study group.", "Saisissez les paramètres donnés par votre enseignant : trésorerie de départ, précision des prévisions, code de classe et groupe d’étude."))}</span></div><div class="button-row"><button class="button primary" data-open-drawer="setup">${escapeHtml(L("Open game setup", "Ouvrir le paramétrage"))}</button><button class="button secondary" data-dismiss-setup>${escapeHtml(L("Not needed", "Pas nécessaire"))}</button></div></section>` : "";
    return lastYear + banner;
  }

  // A last look before the year resolves; it warns but never blocks.
  function renderPassCheck(planned, forecast) {
    if (!ui.passCheck) return "";
    const actions = pendingActions();
    const left = actionLimit() - countedActions().length;
    const warnings = [];
    (forecast.resignations || []).forEach((item) => warnings.push(L(`${item.name} is forecast to resign at year end.`, `${item.name} devrait démissionner en fin d’année.`)));
    forecast.serviceResults.filter((row) => row.active && row.bottleneck.type === "unstaffed").forEach((row) => warnings.push(L(`${serviceName(row.id)} is open but nobody is assigned to it.`, `${serviceName(row.id)} est ouvert mais personne n’y est affecté.`)));
    (forecast.operational.facilityRows || []).filter((row) => row.full).forEach((row) => warnings.push(L(`${facilityName(row)} is full: ${number(row.turnedAway)} requests turned away.`, `${facilityName(row)} est saturé : ${number(row.turnedAway)} demandes refusées.`)));
    planned.staff.filter((person) => closedAssignments(person, planned).length).forEach((person) => warnings.push(L(`${person.name} has hours on closed services.`, `${person.name} a des heures sur des services fermés.`)));
    if (forecast.financial.treasury < state.rules.bankruptcyThreshold) warnings.push(L("The forecast treasury falls below the bankruptcy threshold.", "La trésorerie prévue passe sous le seuil de faillite."));
    const unused = Number.isFinite(left) && left > 0 ? `<p class="no-effect">${escapeHtml(L(`${left} action${left > 1 ? "s" : ""} unused this year.`, `${left} action${left > 1 ? "s" : ""} non utilisée${left > 1 ? "s" : ""} cette année.`))}</p>` : "";
    return `<div class="modal-backdrop"><section class="modal pass-check" role="dialog" aria-modal="true" aria-labelledby="pass-title"><div class="modal-head"><h2 id="pass-title">${escapeHtml(L(`Ready to pass Year ${state.year}?`, `Prêt à passer l’année ${state.year} ?`))}</h2><button data-cancel-pass aria-label="${escapeHtml(t("app.close"))}">×</button></div><h3>${escapeHtml(L("Planned actions", "Actions prévues"))}</h3>${actions.length ? `<ul>${actions.map((action) => `<li>${escapeHtml(actionLabel(action.payload))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No actions planned.", "Aucune action prévue."))}</p>`}${unused}${warnings.length ? `<h3>${escapeHtml(L("Warnings still showing", "Alertes encore visibles"))}</h3><ul class="pass-warnings">${warnings.slice(0, 6).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : `<p class="good-text">${escapeHtml(L("No outstanding warnings.", "Aucune alerte en cours."))}</p>`}<div class="prediction-ask"><label><span>${escapeHtml(L(`After this year, what do you expect to limit the clinic in Year ${state.year + 1}?`, `Après cette année, qu’attendez-vous comme limite de la clinique en année ${state.year + 1} ?`))}</span><select data-prediction><option value="">${escapeHtml(L("Skip — no prediction", "Passer — pas de prédiction"))}</option>${predictionOptions(planned, forecast).map((option) => `<option value="${escapeHtml(option.key)}" ${ui.predictionDraft === option.key ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label><small>${escapeHtml(L("Nothing is scored. The clinic will answer at the end of that year.", "Rien n’est noté. La clinique répondra à la fin de cette année-là."))}</small></div><div class="button-row"><button class="button secondary" data-cancel-pass>${escapeHtml(L("Go back", "Retour"))}</button><button class="button primary" data-confirm-pass>${escapeHtml(L(`Pass Year ${state.year}`, `Passer l’année ${state.year}`))}</button></div></section></div>`;
  }

  // One place per person: time, pay, training, and letting go.
  function renderPersonDrawer(planned, forecast) {
    const person = planned.staff.find((item) => item.id === ui.drawerContext);
    if (!person) {
      const key = `fire:${ui.drawerContext}`;
      const name = state.staff.find((item) => item.id === ui.drawerContext)?.name || "";
      return state.pending[key] ? `<p>${escapeHtml(L(`Letting ${name} go is in the plan.`, `La séparation avec ${name} est dans le plan.`))}</p><button class="button secondary" data-remove-action="${escapeHtml(key)}">${escapeHtml(L("Undo", "Annuler"))}</button>` : `<p>${escapeHtml(L("This person is no longer on the planned team.", "Cette personne ne fait plus partie de l’équipe planifiée."))}</p>`;
    }
    const tabs = [["time", L("Time", "Temps")], ["pay", L("Pay", "Salaire")], ["training", L("Training", "Formation")], ["exit", L("Let go", "Départ")]];
    const tab = tabs.some(([id]) => id === ui.personTab) ? ui.personTab : "time";
    const locked = pendingActions().some((action) => (action.payload.kind === "hire" && action.payload.targetId === person.id) || (action.payload.kind === "training" && action.payload.personId === person.id));
    const body = tab === "pay" ? renderStaffPersonDrawer(planned)
      : tab === "training" ? renderTrainingDrawer(planned, true)
      : tab === "exit" ? (locked ? `<p class="no-effect">${escapeHtml(L("This person is being hired or trained in the current plan; remove that action first.", "Cette personne est recrutée ou formée dans le plan actuel ; retirez d’abord cette action."))}</p>` : renderStaffExitDrawer(planned, forecast))
      : renderAllocationDrawer(planned, forecast);
    return `<div class="drawer-tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" aria-selected="${id === tab}" class="${id === tab ? "active" : ""}" data-person-tab="${id}">${escapeHtml(label)}</button>`).join("")}</div>${body}`;
  }

  // ---------- The workshop: the teacher changes the game, sees what it does, and hands it out ----------
  const REGLES_KIND = "clinique-regles";
  const ATELIER_SECTIONS = [
    ["regles", { en: "Rules", fr: "Règles" }],
    ["services", { en: "Services and prices", fr: "Services et prix" }],
    ["equipe", { en: "Team and salaries", fr: "Équipe et salaires" }],
    ["salles", { en: "Rooms and equipment", fr: "Salles et équipement" }],
    ["fonctionnement", { en: "Operations", fr: "Fonctionnement" }],
    ["depart", { en: "Starting clinic", fr: "Clinique de départ" }],
    ["monnaie", { en: "Currency", fr: "Monnaie" }],
    ["noms", { en: "Names", fr: "Noms" }]
  ];
  const nameOf = (v) => (typeof v === "string" ? v : isBilingual(v) ? itemLabel(v) : "");
  // Originals are written in data.js's currency, euros; values used, in the chosen currency.
  function ruleText(def, v, devise) {
    if (def.affichage === "pourcent") return `${decimal(v * 100, Math.abs(v * 100) < 1 && v !== 0 ? 2 : 1).replace(/[.,]0+$/, "")} %`;
    if (def.affichage === "euro") return money(v, devise);
    if (def.affichage === "fois") return `×${decimal(v, 2)}`;
    return decimal(v, Math.abs(v) < 1 && v !== 0 ? 3 : Math.abs(v) < 10 ? 2 : 0).replace(/[.,]0+$/, "");
  }
  // « Consultation générale › Prix de base », « Familles qui partent après un refus ».
  function ruleLabel(def) {
    if (def.section === "regles") return itemLabel(def.nomL);
    const ligne = nameOf(readRule(`${def.ligne}.name`)) || def.ligne.split(".").pop();
    if (def.table === "acceptes") return `${nameOf(SERVICE_BY_ID[def.champ]?.name) || def.champ} › ${ligne}`;
    return `${ligne} › ${itemLabel(def.label)}`;
  }
  function nameLabel(chemin) {
    const def = RULE_NAMES[chemin];
    const table = (D.atelierCatalogue || []).find((t) => t.id === def.table);
    return `${itemLabel(table?.titre || { en: def.table, fr: def.table })} › ${def.texte ? L("description", "description") : L("name", "nom")}`;
  }
  // Every change a set of rules makes, readable: for the exports, the file and the editor.
  function rulesSummary(rules) {
    const clean = cleanRules(rules);
    if (!clean) return [];
    const out = [];
    if (clean.monnaie) out.push({ section: "monnaie", nom: L("Currency", "Monnaie"), texteOrigine: "EUR", texteValeur: `${clean.monnaie.code}${Math.abs(clean.monnaie.facteur - 1) > 1e-9 ? ` (${L("amounts", "montants")} ×${decimal(clean.monnaie.facteur, 2)})` : ""}` });
    Object.entries(clean.valeurs).forEach(([chemin, v]) => { const def = RULE_SETTINGS[chemin]; out.push({ chemin, section: def.section, nom: ruleLabel(def), origine: RULE_DEFAULTS[chemin], valeur: v, texteOrigine: ruleText(def, RULE_DEFAULTS[chemin], "EUR"), texteValeur: ruleText(def, v) }); });
    Object.keys(clean.delies).forEach((id) => out.push({ section: "services", nom: `${nameOf(SERVICE_BY_ID[id]?.name)} › ${L("accepted price", "prix accepté")}`, texteOrigine: L("follows the base price", "suit le prix de base"), texteValeur: L("unlinked", "délié") }));
    Object.entries(clean.noms).forEach(([chemin, v]) => out.push({ chemin, section: "noms", nom: nameLabel(chemin), texteOrigine: nameOf(NAME_DEFAULTS[chemin]), texteValeur: typeof v === "string" ? v : L(v.en, v.fr) }));
    return out;
  }
  // This year and the next for the clinic as planned, under given rules (with its starting values
  // rebuilt if no year was played) — then the game's own rules are put back.
  function rulePreview(rules) {
    const clinic = clone(state);
    clinic.modelRules = rules;
    withStartingValues(clinic);
    applyModelRules(rules);
    const effects = emptyEffects();
    const actions = pendingActions();
    actions.forEach((action) => combineEffects(effects, applyAction(clinic, action, true)));
    const first = simulateYear(clinic, clinic, effects, actions);
    const second = clone(clinic);
    second.social = clone(first.next.social);
    second.clients = first.next.clients;
    second.reputation = first.next.reputation;
    second.treasury = first.financial.treasury;
    second.finance.loan = first.next.loan;
    second.year += 1;
    second.history = [...(clinic.history || []), { ...first, commitments: commitmentsFor(first, clinic) }];
    const next = simulateYear(second, second, emptyEffects(), []);
    applyModelRules(state.modelRules);
    return { first, next };
  }
  function rulesEffectLines(draft) {
    const now = rulePreview(state.modelRules), then = rulePreview(draft);
    const rows = [
      [L("Cases served", "Cas traités"), (r) => r.operational.totalHonored, "number"],
      [L("Requests refused", "Demandes refusées"), (r) => r.operational.totalDemand - r.operational.totalHonored, "number"],
      [L("Net result", "Résultat net"), (r) => r.financial.netResult, "money"],
      [L("End treasury", "Trésorerie finale"), (r) => r.financial.treasury, "money"],
      [L("Client trust", "Confiance des clients"), (r) => r.social.after.clientTrust, "decimal"],
      [L("Staff climate", "Climat de l’équipe"), (r) => r.social.after.staffClimate, "decimal"]
    ];
    // Amounts are shown in the draft's currency, then the game's own is put back.
    const garde = ruleCurrency;
    ruleCurrency = cleanRules(draft)?.monnaie?.code || "EUR";
    const fmt = (v, type) => type === "money" ? signed(Math.round(v), "money") : type === "decimal" ? `${v >= 0 ? "+" : "−"}${decimal(Math.abs(v), 1)}` : signed(Math.round(v));
    const year = (a, b) => rows.map(([label, get, type]) => { const d = get(b) - get(a); return Math.abs(d) >= (type === "decimal" ? .05 : .5) ? [label, fmt(d, type)] : null; }).filter(Boolean);
    const foyers = then.first.next.clients - now.first.next.clients;
    const out = { cette: year(now.first, then.first), suivante: [...(Math.abs(foyers) >= .5 ? [[L("Client households", "Foyers clients"), signed(Math.round(foyers))]] : []), ...year(now.next, then.next)] };
    ruleCurrency = garde;
    return out;
  }
  function renderRulesSection() {
    const summary = rulesSummary(state.modelRules);
    const status = summary.length ? L(`Rules « ${state.modelRules.nom || "untitled"} »: ${summary.length} change${summary.length > 1 ? "s" : ""}`, `Règles « ${state.modelRules.nom || "sans nom"} » : ${summary.length} changement${summary.length > 1 ? "s" : ""}`) : L("Original rules", "Règles d’origine");
    return `<div class="rules-setup"><h3>${escapeHtml(L("Rules of the model", "Règles du modèle"))}</h3><p><strong>${escapeHtml(status)}</strong></p>${summary.length ? `<ul class="rules-list">${summary.slice(0, 8).map((r) => `<li>${escapeHtml(r.nom)} : ${escapeHtml(r.texteOrigine)} → <strong>${escapeHtml(r.texteValeur)}</strong></li>`).join("")}${summary.length > 8 ? `<li>${escapeHtml(L(`and ${summary.length - 8} more`, `et ${summary.length - 8} autres`))}</li>` : ""}</ul>` : ""}
      ${state.history.length ? `<p><small>${escapeHtml(L("Rules from your teacher are loaded before Year 1.", "Les règles de votre enseignant se chargent avant l’année 1."))}</small></p>` : `<label class="button secondary file-button">${escapeHtml(L("Load rules from your teacher", "Charger des règles de l’enseignant"))}<input type="file" accept="application/json,.json" data-charger-regles hidden></label>`}
      <details class="atelier-entry"><summary>${escapeHtml(L("Teacher’s workshop", "Atelier de l’enseignant"))}</summary>${ui.atelierUnlocked ? `<button class="button primary" data-atelier-show>${escapeHtml(L("Open the workshop", "Ouvrir l’atelier"))}</button>` : `<label><span>${escapeHtml(L("Workshop code", "Code de l’atelier"))}</span><input type="password" autocomplete="off" data-atelier-code></label><button class="button secondary" data-atelier-open>${escapeHtml(L("Open", "Ouvrir"))}</button>`}</details></div>`;
  }

  // The values a field shows and takes: shares in %, everything else as is.
  const ruleShown = (def, v) => (def.affichage === "pourcent" ? Math.round(v * 10000) / 100 : Math.round(v * 1000) / 1000);
  const ruleTaken = (def, texte) => { const n = Number(String(texte).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? (def.affichage === "pourcent" ? n / 100 : n) : null; };
  function atelierCell(chemin) {
    const def = RULE_SETTINGS[chemin];
    if (!def) return "<td></td>";
    const draft = ui.rulesDraft;
    const v = draft.valeurs[chemin] ?? RULE_DEFAULTS[chemin];
    const lie = def.table === "acceptes" && !(chemin in draft.valeurs) ? linkedAccepted(chemin) : null;
    const shown = lie ?? v;
    const modifie = Math.abs(shown - RULE_DEFAULTS[chemin]) > 1e-9;
    return `<td class="${modifie ? "changed" : ""}"><input type="text" inputmode="decimal" value="${ruleShown(def, shown)}" data-rule-cell="${escapeHtml(chemin)}" aria-label="${escapeHtml(ruleLabel(def))}">${def.affichage === "pourcent" ? "<span class=\"unit\">%</span>" : ""}<small>${escapeHtml(L("orig.", "orig."))} ${escapeHtml(ruleText(def, RULE_DEFAULTS[chemin], "EUR"))}${lie != null && modifie ? ` · ${escapeHtml(L("follows the price", "suit le prix"))}` : ""}${chemin in draft.valeurs ? ` · <button class="text-button" data-rule-reset="${escapeHtml(chemin)}">${escapeHtml(L("reset", "rétablir"))}</button>` : ""}</small></td>`;
  }
  // What a linked accepted price becomes when its service's base price is changed in the draft.
  function linkedAccepted(chemin) {
    const m = chemin.match(/^segments\.[^.]+\.willingness\.(.+)$/);
    const prix = `services.${m?.[1]}.price`;
    if (!m || ui.rulesDraft.delies[m[1]] || !(prix in ui.rulesDraft.valeurs)) return null;
    return RULE_DEFAULTS[chemin] * ui.rulesDraft.valeurs[prix] / RULE_DEFAULTS[prix];
  }
  function atelierTable(table) {
    const q = (ui.atelierSearch || "").trim().toLowerCase();
    const rows = atelierRows(table).filter((row) => !q || nameOf(row.objet.name).toLowerCase().includes(q) || row.cle.toLowerCase().includes(q));
    if (table.matrice) {
      const segs = rows;
      const services = D.services.filter((s) => segs.some((seg) => `${seg.cle}.${table.matrice}.${s.id}` in RULE_SETTINGS));
      return `<h3>${escapeHtml(itemLabel(table.titre))}</h3><p class="muted">${escapeHtml(L("Each accepted price follows its service’s base price unless you untick « linked ».", "Chaque prix accepté suit le prix de base de son service, sauf si vous décochez « lié »."))}</p><div class="atelier-scroll"><table class="atelier-table"><thead><tr><th>${escapeHtml(L("Service", "Service"))}</th>${segs.map((seg) => `<th>${escapeHtml(nameOf(seg.objet.name))}</th>`).join("")}<th>${escapeHtml(L("Linked", "Lié"))}</th></tr></thead><tbody>${services.map((s) => `<tr><th>${escapeHtml(nameOf(s.name))}</th>${segs.map((seg) => atelierCell(`${seg.cle}.${table.matrice}.${s.id}`)).join("")}<td><input type="checkbox" ${ui.rulesDraft.delies[s.id] ? "" : "checked"} data-rule-link="${s.id}" aria-label="${escapeHtml(L("Linked to the base price", "Lié au prix de base"))}"></td></tr>`).join("")}</tbody></table></div>`;
    }
    if (!rows.length) return "";
    return `<h3>${escapeHtml(itemLabel(table.titre))}</h3><div class="atelier-scroll"><table class="atelier-table"><thead><tr><th></th>${table.champs.map((c) => `<th>${escapeHtml(itemLabel(c.label))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr><th>${escapeHtml(nameOf(row.objet.name) || row.cle.split(".").pop())}${row.scenarios && row.scenarios.length < Object.keys(D.scenarios).length ? `<small>${escapeHtml(row.scenarios.map((sc) => nameOf(D.scenarios[sc].name)).join(", "))}</small>` : ""}</th>${table.champs.map((c) => atelierCell(`${row.cle}.${c.cle}`)).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function atelierRules() {
    const draft = ui.rulesDraft;
    const groupes = [...new Set((D.atelierSettings || []).map((s) => s.groupe))];
    const q = (ui.atelierSearch || "").trim().toLowerCase();
    const slider = (s) => {
      const def = RULE_SETTINGS[s.chemin];
      const v = draft.valeurs[s.chemin] ?? RULE_DEFAULTS[s.chemin];
      const modifie = Math.abs(v - RULE_DEFAULTS[s.chemin]) > 1e-9;
      return `<div class="rule-row ${modifie ? "changed" : ""}"><div><strong>${escapeHtml(itemLabel(def.nomL))}</strong><small>${escapeHtml(itemLabel(def.texteL))}</small></div><div class="rule-control"><input type="range" min="${def.min}" max="${def.max}" step="${def.pas}" value="${v}" data-rule="${escapeHtml(s.chemin)}" aria-label="${escapeHtml(itemLabel(def.nomL))}"><output>${escapeHtml(ruleText(def, v))}</output><small>${escapeHtml(L("original", "origine"))} ${escapeHtml(ruleText(def, RULE_DEFAULTS[s.chemin], "EUR"))}${modifie ? ` · <button class="text-button" data-rule-reset="${escapeHtml(s.chemin)}">${escapeHtml(L("reset", "rétablir"))}</button>` : ""}</small></div></div>`;
    };
    const groupesEn = { Clients: "Clients", Confiance: "Trust", "Équipe": "Team", Argent: "Money", Fonctionnement: "Operations", Promesses: "Promises" };
    return groupes.map((g) => { const items = (D.atelierSettings || []).filter((s) => s.groupe === g && (!q || itemLabel(RULE_SETTINGS[s.chemin].nomL).toLowerCase().includes(q))); return items.length ? `<h3>${escapeHtml(L(groupesEn[g] || g, g))}</h3>${items.map(slider).join("")}` : ""; }).join("");
  }
  function atelierCurrency() {
    const draft = ui.rulesDraft;
    const code = draft.monnaie?.code || "EUR";
    const facteur = draft.monnaie?.facteur ?? 1;
    const consult = RULE_DEFAULTS["services.consult.price"];
    const apercu = (() => { const garde = ruleCurrency; ruleCurrency = code; const t = money(Math.round(consult * facteur)); ruleCurrency = garde; return t; })();
    return `<h3>${escapeHtml(L("Currency", "Monnaie"))}</h3><label class="atelier-field"><span>${escapeHtml(L("Currency shown in the game", "Monnaie affichée dans le jeu"))}</span><select data-rule-currency>${RULE_CURRENCIES.map((c) => `<option value="${c}" ${c === code ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label class="atelier-field"><span>${escapeHtml(L("Convert every amount by", "Convertir tous les montants par"))}</span><input type="text" inputmode="decimal" value="${facteur}" data-rule-factor></label>
      <p>${escapeHtml(L(`Example: the consultation, ${money(consult)} today, would be ${apercu}.`, `Exemple : la consultation, ${money(consult)} aujourd’hui, passerait à ${apercu}.`))}</p>
      <button class="button primary" data-rule-convert>${escapeHtml(L("Convert all amounts", "Convertir tous les montants"))}</button>
      <p class="muted">${escapeHtml(L("Converting sets every amount (prices, salaries, rents, equipment, costs, treasury) to its original × the factor. You can then adjust each one in its section.", "Convertir remplace chaque montant (prix, salaires, loyers, équipements, coûts, trésorerie) par son original × le facteur. Vous pouvez ensuite ajuster chacun dans sa section."))}</p>`;
  }
  function atelierNames() {
    const q = (ui.atelierSearch || "").trim().toLowerCase();
    const rows = Object.keys(RULE_NAMES).filter((c) => !q || nameOf(NAME_DEFAULTS[c]).toLowerCase().includes(q));
    const draftName = (c) => ui.rulesDraft.noms[c] ?? NAME_DEFAULTS[c];
    return `<h3>${escapeHtml(L("Names", "Noms"))}</h3><p class="muted">${escapeHtml(L("The workbook and the model map use the original names.", "Le carnet et la carte du modèle utilisent les noms d’origine."))}</p><div class="atelier-scroll"><table class="atelier-table names"><thead><tr><th></th><th>Français</th><th>English</th></tr></thead><tbody>${rows.map((c) => { const o = NAME_DEFAULTS[c], d = draftName(c); const changed = JSON.stringify(o) !== JSON.stringify(d); return `<tr class="${changed ? "changed" : ""}"><th><small>${escapeHtml(nameLabel(c))}</small>${escapeHtml(nameOf(o))}</th>${typeof o === "string" ? `<td colspan="2"><input type="text" maxlength="120" value="${escapeHtml(typeof d === "string" ? d : d.fr)}" data-name-single="${escapeHtml(c)}"></td>` : `<td data-langue="Français"><input type="text" maxlength="120" value="${escapeHtml(d.fr)}" data-name-fr="${escapeHtml(c)}" aria-label="${escapeHtml(nameOf(o))} · Français"></td><td data-langue="English"><input type="text" maxlength="120" value="${escapeHtml(d.en)}" data-name-en="${escapeHtml(c)}" aria-label="${escapeHtml(nameOf(o))} · English"></td>`}</tr>`; }).join("")}</tbody></table></div>`;
  }
  function renderAtelierPage() {
    if (!ui.rulesDraft) { const c = cleanRules(state.modelRules); ui.rulesDraft = { nom: c?.nom || "", valeurs: { ...(c?.valeurs || {}) }, noms: { ...(c?.noms || {}) }, delies: { ...(c?.delies || {}) }, monnaie: c?.monnaie ? { ...c.monnaie } : null }; }
    const draft = ui.rulesDraft;
    const section = ui.atelierSection || "regles";
    const changes = rulesSummary(draft);
    const parSection = (id) => changes.filter((r) => r.section === id).length;
    const effets = rulesEffectLines(draft);
    const ligne = (titre, items) => `<div class="effect-year"><h4>${escapeHtml(titre)}</h4>${items.length ? `<ul>${items.map(([label, v]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(v)}</strong></li>`).join("")}</ul>` : `<p class="muted">${escapeHtml(L("nothing moves on your clinic as it is", "rien ne bouge sur votre clinique telle qu’elle est"))}</p>`}</div>`;
    const contenu = section === "regles" ? atelierRules()
      : section === "monnaie" ? atelierCurrency()
      : section === "noms" ? atelierNames()
      : (D.atelierCatalogue || []).filter((t) => t.section === section).map(atelierTable).join("");
    return `<div class="atelier-page">
      <header class="atelier-top"><div><h1>${escapeHtml(L("Teacher’s workshop", "Atelier de l’enseignant"))}</h1><span>${escapeHtml(L(`${changes.length} change${changes.length === 1 ? "" : "s"}`, `${changes.length} changement${changes.length > 1 ? "s" : ""}`))}</span></div>
        <label class="rules-name"><span>${escapeHtml(L("Name of these rules", "Nom de ces règles"))}</span><input type="text" maxlength="60" value="${escapeHtml(draft.nom || "")}" data-rule-name placeholder="${escapeHtml(L("e.g. Clinic in Geneva", "ex. Clinique à Genève"))}"></label>
        <div class="language-switch"><button data-language="fr" class="${state.language === "fr" ? "active" : ""}" aria-pressed="${state.language === "fr"}">FR</button><button data-language="en" class="${state.language === "en" ? "active" : ""}" aria-pressed="${state.language === "en"}">EN</button></div>
        <div class="button-row"><button class="button primary" data-rules-apply>${escapeHtml(L("Apply to my game", "Appliquer à ma partie"))}</button><button class="button secondary" data-rules-download ${changes.length ? "" : "disabled"}>${escapeHtml(L("Download for students", "Télécharger pour les étudiants"))}</button><button class="button secondary" data-rules-reset-all>${escapeHtml(L("Original rules", "Règles d’origine"))}</button><button class="button secondary" data-atelier-close>${escapeHtml(L("Close", "Fermer"))}</button></div></header>
      <div class="atelier-cols">
        <nav class="atelier-nav" aria-label="${escapeHtml(L("Sections", "Sections"))}">${ATELIER_SECTIONS.map(([id, label]) => `<button data-atelier-section="${id}" class="${id === section ? "active" : ""}">${escapeHtml(itemLabel(label))}${parSection(id) ? `<span class="badge">${parSection(id)}</span>` : ""}</button>`).join("")}</nav>
        <main class="atelier-main">${section === "monnaie" ? "" : `<input type="search" class="atelier-search" value="${escapeHtml(ui.atelierSearch || "")}" placeholder="${escapeHtml(L("Search…", "Chercher…"))}" data-atelier-search>`}${state.history.length && ["services", "equipe", "depart"].includes(section) ? `<p class="callout">${escapeHtml(L("Your game has started: starting values (prices, salaries, treasury, households) apply to a game not yet started — such as your students’.", "Votre partie a commencé : les valeurs de départ (prix, salaires, trésorerie, foyers) s’appliquent à une partie pas encore commencée — comme celle de vos étudiants."))}</p>` : ""}${contenu}</main>
        <aside class="atelier-effect" aria-live="polite"><h2>${escapeHtml(L("What these rules change on your clinic", "Ce que ces règles changent sur votre clinique"))}</h2>${changes.length || cleanRules(state.modelRules) ? `${ligne(L("This year", "Cette année"), effets.cette)}${ligne(L("Next year", "L’an prochain"), effets.suivante)}` : `<p class="muted">${escapeHtml(L("Original rules: change something to see its effect.", "Règles d’origine : changez quelque chose pour voir son effet."))}</p>`}<p class="muted">${escapeHtml(L("Compared with the rules your game uses now, as planned. The workbook’s figures assume the original rules.", "Comparé aux règles de votre partie, telle que planifiée. Les chiffres du carnet supposent les règles d’origine."))}</p></aside>
      </div></div>`;
  }
  function telechargerRegles() {
    const clean = cleanRules(ui.rulesDraft);
    if (!clean) return;
    const fichier = { kind: REGLES_KIND, ...clean, changements: rulesSummary(clean).map(({ section, nom, texteOrigine, texteValeur }) => ({ section, nom, origine: texteOrigine, valeur: texteValeur })) };
    const blob = new Blob([JSON.stringify(fichier, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `regles-${(clean.nom || "clinique").normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "clinique"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast(L("Rules downloaded: give this file to the students, who load it in the game setup.", "Règles téléchargées : donnez ce fichier aux étudiants, qui le chargent dans le paramétrage."), "good");
  }
  function appliquerRegles(rules, source) {
    const clean = cleanRules(rules);
    state.modelRules = clean;
    withStartingValues(state);
    logDecision("rules", `rules:${source}`, clean ? `${clean.nom || ""} (${rulesSummary(clean).length})` : "origine");
    saveState();
    return clean;
  }
  function chargerRegles(texte) {
    let fichier;
    try { fichier = JSON.parse(texte); } catch (e) { toast(L("That file is not readable.", "Ce fichier n’est pas lisible."), "warn"); return false; }
    if (!fichier || fichier.kind !== REGLES_KIND) { toast(L("That is not a rules file from the workshop.", "Ce n’est pas un fichier de règles de l’atelier."), "warn"); return false; }
    if (state.history.length) { toast(L("Rules are loaded before Year 1.", "Les règles se chargent avant l’année 1."), "warn"); return false; }
    const clean = appliquerRegles(fichier, "load");
    render();
    toast(clean ? L(`Rules « ${clean.nom} » loaded: ${rulesSummary(clean).length} changes.`, `Règles « ${clean.nom} » chargées : ${rulesSummary(clean).length} changements.`) : L("Original rules.", "Règles d’origine."), "good");
    return true;
  }

  function renderSetupDrawer() {
    if (!ui.settingsDraft) ui.settingsDraft = { actionLimit: state.rules.unlimited ? "unlimited" : String(state.rules.actionLimit), targetYear: state.rules.targetYear, bankruptcyThreshold: state.rules.bankruptcyThreshold, startingTreasury: state.setup.startingTreasury, forecastPrecision: state.setup.forecastPrecision, classCode: state.setup.classCode, studyGroup: state.setup.studyGroup };
    const settings = ui.settingsDraft;
    return `<p class="setup-note">${escapeHtml(L("Enter the values your instructor gives you before starting Year 1. Every setting and cash adjustment is recorded in the report.", "Saisissez les valeurs données par votre enseignant avant de commencer l’année 1. Chaque paramètre et ajustement de trésorerie figure dans le rapport."))}</p><div class="form-stack"><fieldset><legend>${escapeHtml(L("Given to you by your instructor", "Donné par votre enseignant"))}</legend><div class="setup-fields">
        <label><span>${escapeHtml(L("Starting treasury", "Trésorerie de départ"))}</span><input type="number" min="0" max="2000000" step="5000" value="${settings.startingTreasury}" data-settings-field="startingTreasury" ${state.history.length ? "disabled" : ""}>${state.history.length ? `<small>${escapeHtml(L("Locked after Year 1", "Verrouillée après l’année 1"))}</small>` : ""}</label>
        <label><span>${escapeHtml(L("Forecast precision", "Précision des prévisions"))}</span><select data-settings-field="forecastPrecision">${["exact", "ranges", "costs"].map((mode) => `<option value="${mode}" ${settings.forecastPrecision === mode ? "selected" : ""}>${escapeHtml(precisionLabel(mode))}</option>`).join("")}</select></label>
        <label><span>${escapeHtml(L("Class code", "Code de classe"))}</span><input type="text" maxlength="24" value="${escapeHtml(settings.classCode || "")}" data-settings-field="classCode" placeholder="${escapeHtml(L("Same code = same demand swings", "Même code = mêmes variations de demande"))}"></label>
        <label><span>${escapeHtml(L("Study group", "Groupe d’étude"))}</span><input type="text" maxlength="24" value="${escapeHtml(settings.studyGroup || "")}" data-settings-field="studyGroup" placeholder="${escapeHtml(L("Only if your instructor gives you one", "Seulement si votre enseignant vous en donne un"))}"></label>
      </div></fieldset><fieldset><legend>${escapeHtml(L("Rules of play", "Règles du jeu"))}</legend><div class="setup-fields">
        <label><span>${escapeHtml(t("app.actionLimit"))}</span><select data-settings-field="actionLimit">${Array.from({ length: 12 }, (_, index) => index + 1).map((count) => `<option value="${count}" ${String(settings.actionLimit) === String(count) ? "selected" : ""}>${count} ${escapeHtml(count === 1 ? L("action", "action") : L("actions", "actions"))}</option>`).join("")}<option value="unlimited" ${settings.actionLimit === "unlimited" ? "selected" : ""}>${escapeHtml(t("app.unlimited"))}</option></select></label>
        <label><span>${escapeHtml(t("app.targetYear"))}</span><input type="number" min="${state.year}" max="12" value="${settings.targetYear}" data-settings-field="targetYear"></label>
        <label><span>${escapeHtml(t("app.bankruptcy"))}</span><input type="number" min="-1000000" max="0" step="10000" value="${settings.bankruptcyThreshold}" data-settings-field="bankruptcyThreshold"></label>
      </div></fieldset></div><div class="setup-actions"><button class="button primary" data-save-settings>${escapeHtml(L("Save settings", "Enregistrer les paramètres"))}</button></div>${ui.settingsError ? `<p class="form-error" role="alert">${escapeHtml(ui.settingsError)}</p>` : ""}${renderRulesSection()}${renderCashAdjuster()}<h3>${escapeHtml(L("Scenario", "Scénario"))}</h3><div class="scenario-grid compact">${Object.entries(D.scenarios).map(([id, scenario]) => `<article class="choice-card ${state.scenarioId === id ? "selected" : ""}"><h3>${escapeHtml(itemLabel(scenario.name))}</h3><p>${escapeHtml(itemLabel(scenario.description))}</p><button class="button ${state.scenarioId === id ? "secondary" : "danger"}" data-scenario="${id}" ${state.scenarioId === id ? "disabled" : ""}>${escapeHtml(state.scenarioId === id ? t("common.current") : t("dashboard.chooseScenario"))}</button></article>`).join("")}</div><div class="button-row"><button class="button secondary" data-export>${escapeHtml(t("app.export"))}</button><button class="button danger" data-reset>${escapeHtml(t("app.reset"))}</button></div>`;
  }

  function serviceChip(row) {
    if (!row.active) return ["", L("Closed", "Fermé")];
    if (row.missing?.length) return ["warn", L("Blocked", "Bloqué")];
    if (row.bottleneck.type === "unstaffed") return ["bad", L("Nobody assigned", "Personne d’affecté")];
        return ["good", L("Running", "En service")];
  }

  function renderNav() {
    const areas = [
      ["overview", L("Overview", "Vue d’ensemble"), L("View", "Vue")],
      ["care", L("Care & facilities", "Soins et installations"), L("Care", "Soins")],
      ["team", L("Team & operations", "Équipe et opérations"), L("Team", "Équipe")],
      ["business", L("Business", "Gestion"), L("Business", "Gestion")],
      ["sustainability", L("Sustainability", "Durabilité"), L("Sustainability", "Durabilité")],
      ["results", L("Results", "Résultats"), L("Results", "Résultats")]
    ];
    return `<nav class="domain-nav six" aria-label="${escapeHtml(t("app.title"))}">${areas.map(([id, label, short]) => `<button data-domain="${id}" class="${state.domain === id ? "active" : ""}" aria-label="${escapeHtml(label)}"><span class="nav-full">${escapeHtml(label)}</span><span class="nav-compact" aria-hidden="true">${escapeHtml(short)}</span></button>`).join("")}</nav>`;
  }

  // One source of rows for the desktop panel and the mobile drawer. They had drifted apart: the
  // mobile version reordered them, dropped two, and formatted with raw money()/number()/pct(), so a
  // game set to ranges or costs precision printed exact figures on a phone.
  // The fifth value marks outcomes, which follow the game-setup forecast precision; costs stay exact.
  function planRows(baseline, forecast) {
    return [
      ["forecast.revenue", baseline.financial.revenue, forecast.financial.revenue, "money", true],
      ["forecast.totalCosts", baseline.financial.totalCosts, forecast.financial.totalCosts, "money", false],
      ["forecast.netResult", baseline.financial.netResult, forecast.financial.netResult, "money", true],
      ["forecast.treasury", baseline.financial.treasury, forecast.financial.treasury, "money", true],
      ["forecast.served", baseline.operational.totalHonored, forecast.operational.totalHonored, "number", true],
      ["forecast.staffUse", baseline.operational.staffUse, forecast.operational.staffUse, "percent", true],
      ["carbon.total", baseline.carbon.total, forecast.carbon.total, "carbon", true],
      ["social.clientTrust", baseline.social.after.clientTrust, forecast.social.after.clientTrust, "number", true],
      ["social.staffClimate", baseline.social.after.staffClimate, forecast.social.after.staffClimate, "number", true]
    ];
  }

  // How a problem is framed decides what counts as an improvement. The same plan, judged on four
  // points of view the model already computes, can improve on one and damage another — and nothing
  // in the figures themselves says which view to take. That choice is the student's, and it is the
  // one thing in this software they can be asked to defend. Each frame returns the figure that
  // decided it, so the verdict can be argued with rather than accepted.
  function planFrames(baseline, forecast) {
    const unmetBase = Math.max(0, baseline.operational.totalDemand - baseline.operational.totalHonored) + unmetRequests(baseline);
    const unmetPlan = Math.max(0, forecast.operational.totalDemand - forecast.operational.totalHonored) + unmetRequests(forecast);
    const frames = [
      {
        id: "money",
        label: L("The accounts", "Les comptes"),
        question: L("Does the clinic end the year better off?", "La clinique finit-elle l’année mieux lotie ?"),
        delta: forecast.financial.netResult - baseline.financial.netResult,
        reading: () => L(`Net result ${forecastText(baseline.financial.netResult, "money")} → ${forecastText(forecast.financial.netResult, "money")}`, `Résultat net ${forecastText(baseline.financial.netResult, "money")} → ${forecastText(forecast.financial.netResult, "money")}`)
      },
      {
        id: "access",
        label: L("Access to care", "L’accès aux soins"),
        question: L("Do more animals get treated?", "Soigne-t-on davantage d’animaux ?"),
        delta: forecast.operational.totalHonored - baseline.operational.totalHonored,
        reading: () => L(`${forecastText(forecast.operational.totalHonored, "number")} cases served · ${forecastText(unmetPlan, "number")} requests unanswered, against ${forecastText(unmetBase, "number")}`, `${forecastText(forecast.operational.totalHonored, "number")} cas traités · ${forecastText(unmetPlan, "number")} demandes sans réponse, contre ${forecastText(unmetBase, "number")}`)
      },
      {
        id: "team",
        label: L("The people who do the work", "Les gens qui font le travail"),
        question: L("Is the team able to sustain it?", "L’équipe peut-elle tenir ?"),
        delta: forecast.social.after.staffClimate - baseline.social.after.staffClimate,
        reading: () => L(`Staff climate ${forecastText(baseline.social.after.staffClimate, "number")} → ${forecastText(forecast.social.after.staffClimate, "number")}${forecast.financial.overtimeHours > 0 ? ` · ${forecastText(forecast.financial.overtimeHours, "number")} overtime hours` : ""}`, `Climat de l’équipe ${forecastText(baseline.social.after.staffClimate, "number")} → ${forecastText(forecast.social.after.staffClimate, "number")}${forecast.financial.overtimeHours > 0 ? ` · ${forecastText(forecast.financial.overtimeHours, "number")} h supplémentaires` : ""}`)
      },
      {
        id: "carbon",
        label: L("What it leaves behind", "Ce que cela laisse derrière"),
        question: L("What does the year cost the climate?", "Que coûte l’année au climat ?"),
        delta: baseline.carbon.total - forecast.carbon.total,
        reading: () => L(`Carbon ${forecastText(baseline.carbon.total, "carbon")} → ${forecastText(forecast.carbon.total, "carbon")}`, `Carbone ${forecastText(baseline.carbon.total, "carbon")} → ${forecastText(forecast.carbon.total, "carbon")}`)
      }
    ];
    return frames.map((frame) => {
      const moved = Math.abs(frame.delta) > (frame.id === "carbon" ? .05 : frame.id === "money" ? 1 : .5);
      return { ...frame, verdict: !moved ? "flat" : frame.delta > 0 ? "better" : "worse", detail: frame.reading(frame.delta) };
    });
  }

  function renderPlanFrames(baseline, forecast) {
    const frames = planFrames(baseline, forecast);
    const moved = frames.filter((frame) => frame.verdict !== "flat");
    if (!moved.length) return "";
    const split = moved.some((frame) => frame.verdict === "better") && moved.some((frame) => frame.verdict === "worse");
    const mark = { better: "↑", worse: "↓", flat: "=" };
    return `<details class="plan-frames ${split ? "split" : ""}" data-pli="framesOpen" ${ui.framesOpen ? "open" : ""}>
      <summary><strong>${escapeHtml(L("Better or worse — seen from where?", "Mieux ou moins bien — vu d’où ?"))}</strong><span>${escapeHtml(split ? L("the points of view disagree", "les points de vue divergent") : L("the points of view agree", "les points de vue s’accordent"))}</span></summary>
      ${frames.map((frame) => `<div class="frame-row ${frame.verdict}"><strong>${escapeHtml(frame.label)}</strong><span class="frame-mark" aria-hidden="true">${mark[frame.verdict]}</span><em>${escapeHtml(frame.detail)}</em></div>`).join("")}
      <p class="frame-note">${escapeHtml(split
        ? L("These points of view disagree about this plan. No figure here decides between them: choosing which one counts is the decision, and it is yours to defend.", "Ces points de vue ne disent pas la même chose de ce plan. Aucun chiffre ici ne tranche entre eux : choisir celui qui compte, c’est cela la décision, et c’est à vous de la défendre.")
        : L("These points of view agree about this plan. They will not always — try a plan that makes one of them worse.", "Ces points de vue s’accordent sur ce plan. Ce ne sera pas toujours le cas : essayez un plan qui en dégrade un."))}</p>
    </details>`;
  }

  function planRowLabel(key) {
    if (key === "social.clientTrust") return L("Client trust", "Confiance des clients");
    if (key === "social.staffClimate") return L("Staff climate", "Climat de l’équipe");
    return key === "carbon.total" ? L("Carbon footprint", "Empreinte carbone") : t(key);
  }

  function planValue(type, outcome, value, options = {}) {
    if (outcome) return forecastText(value, type, options);
    return options.signed ? signed(value, type) : formatMetric(value, type);
  }

  // The gap column is the difference of the two figures printed beside it, not of the unrounded
  // values: a student who checks −59 081 − (−64 969) must find the 5 888 on the screen, and the
  // same 5 888 in Analyse différentielle and in the export once rounded.
  function ecartAffiche(type, base, plan) {
    const pas = type === "percent" ? 100 : type === "carbon" ? 10 : 1;
    return (Math.round(plan * pas) - Math.round(base * pas)) / pas;
  }

  function renderPlanPanel(baseline, forecast) {
    const rows = planRows(baseline, forecast);
    return `<aside class="plan-panel" aria-label="${escapeHtml(t("forecast.title"))}">
      <button class="mobile-plan-toggle" data-open-drawer="plan"><strong>${escapeHtml(L("Plan", "Plan"))} · ${pendingActions().length} ${escapeHtml(pendingActions().length === 1 ? t("common.action") : t("common.actions"))}</strong><span>${escapeHtml(t("forecast.treasury"))} ${escapeHtml(forecastText(forecast.financial.treasury, "money"))} <em>(${escapeHtml(forecastText(forecast.financial.treasury - baseline.financial.treasury, "money", { signed: true }))})</em></span></button>
      <div class="panel-heading"><div><h2>${escapeHtml(t("forecast.title"))}</h2><details class="note-repliee" data-pli="noteOpen" ${ui.noteOpen ? "open" : ""}><summary>${escapeHtml(L("How to read this", "Comment lire ceci"))}</summary><p>${escapeHtml(forecastNote())}</p></details></div></div>
      <div class="forecast-table">
        <div class="forecast-head"><span></span><span>${escapeHtml(t("common.baseline"))}</span><span>${escapeHtml(t("common.planned"))}</span><span>${escapeHtml(t("common.delta"))}</span></div>
        ${rows.map(([key, base, plan, type, outcome]) => `<div class="forecast-row"><strong>${escapeHtml(planRowLabel(key))}</strong><span>${escapeHtml(planValue(type, outcome, base))}</span><span>${escapeHtml(planValue(type, outcome, plan))}</span><em>${escapeHtml(planValue(type, outcome, ecartAffiche(type, base, plan), { signed: true }))}</em></div>`).join("")}
      </div>
      <div class="plan-actions">
        ${pendingActions().length ? pendingActions().map((action) => `<div class="plan-action${isFreeAction(action.payload) ? " free-action" : ""}"><span>${escapeHtml(actionLabel(action.payload))}${isFreeAction(action.payload) ? ` <small>${escapeHtml(L("does not use an action", "ne consomme pas d’action"))}</small>` : ""}</span><button data-remove-action="${escapeHtml(action.key)}" aria-label="${escapeHtml(t("common.remove"))}">×</button></div>`).join("") : `<p class="empty">${escapeHtml(t("forecast.noActions"))}</p>`}
      </div>
      <div class="plan-footer"><button class="button primary pass-button" data-pass-year>${escapeHtml(t("app.pass"))}</button></div>
      ${renderPlanFrames(baseline, forecast)}
    </aside>`;
  }

  function forecastPrecision() {
    return state.setup?.forecastPrecision || "exact";
  }

  function precisionLabel(mode) {
    return ({ exact: L("Exact figures", "Chiffres exacts"), ranges: L("Ranges", "Fourchettes"), costs: L("Costs only", "Coûts seulement") })[mode] || mode;
  }

  // Formats a forecast outcome according to the game-setup precision; costs are never passed here.
  function forecastText(value, type, options = {}) {
    const format = (amount) => type === "money" ? (options.signed ? signed(amount, "money") : money(amount))
      : type === "percent" ? (options.signed ? signed(amount, "percent") : pct(amount))
      : type === "carbon" ? `${options.signed && amount > 0 ? "+" : ""}${tonnes(amount, options.digits ?? 1)}`
      : (options.signed ? signed(amount) : number(amount));
    const mode = forecastPrecision();
    if (mode === "costs") return L("Revealed at year end", "Révélé en fin d’année");
    if (mode === "exact" || Math.abs(value) < 1e-6) return format(value);
    const floor = { money: 2000, percent: .02, carbon: .1, number: 20 }[type] ?? 20;
    const band = Math.max(Math.abs(value) * .15, floor);
    return `${format(value - band)} … ${format(value + band)}`;
  }

  function forecastNote() {
    const mode = forecastPrecision();
    if (mode === "costs") return L("Costs are shown; cases and results are revealed at year end. Actual demand varies each year.", "Les coûts sont affichés ; les cas et résultats sont révélés en fin d’année. La demande réelle varie chaque année.");
    if (mode === "ranges") return L("Forecast ranges compared with passing the year without new actions. Actual demand varies each year, so results can land anywhere in the range.", "Fourchettes prévues par rapport au passage de l’année sans nouvelle action. La demande réelle varie chaque année : le résultat peut tomber n’importe où dans la fourchette.");
    return L("Expected result compared with passing the year without new actions. With exact figures this is what the year will produce.", "Résultat attendu par rapport au passage de l’année sans nouvelle action. En chiffres exacts, c’est ce que l’année produira.");
  }

  function absenceNote(row) {
    const parts = [];
    if (row.fatigueAbsenceHours > 1) parts.push(L(`${number(row.fatigueAbsenceHours)} from last year’s overtime`, `${number(row.fatigueAbsenceHours)} dues aux heures sup. de l’an dernier`));
    if (row.moraleAbsenceHours > 1) parts.push(L(`${number(row.moraleAbsenceHours)} from low morale`, `${number(row.moraleAbsenceHours)} dues au climat dégradé`));
    if (row.moraleAbsenceHours < -1) parts.push(L(`${number(-row.moraleAbsenceHours)} fewer thanks to good morale`, `${number(-row.moraleAbsenceHours)} de moins grâce au bon climat`));
    return parts.length ? ` (${parts.join(", ")})` : "";
  }

  function departureText(reason) {
    if (reason === "fired") return L("let go (severance paid)", "départ imposé (indemnité versée)");
    if (reason === "pay") return L("resigned: paid below benchmark while morale was low", "démission : salaire sous la référence avec un climat bas");
    return L("resigned: staff climate fell too low", "démission : climat de l’équipe trop dégradé");
  }

  function cashReasonLabel(reason) {
    return ({ grant: L("Grant", "Subvention"), fine: L("Fine", "Amende"), shock: L("Shock", "Choc"), other: L("Other", "Autre") })[reason] || reason;
  }

  // Applied immediately, never an action, and always recorded for the instructor.
  function adjustCash(amount, reason) {
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || !value) return false;
    state.treasury += value;
    state.cashLog.push({ year: state.year, amount: value, reason: reason || "other", at: new Date().toISOString() });
    saveState();
    return true;
  }

  function setupSummaryRows() {
    const setup = state.setup;
    return [
      [L("Starting treasury", "Trésorerie de départ"), money(setup.startingTreasury)],
      [L("Forecast precision", "Précision des prévisions"), precisionLabel(setup.forecastPrecision)],
      [L("Rules of the model", "Règles du modèle"), (() => { const r = rulesSummary(state.modelRules); return r.length ? `« ${state.modelRules.nom || L("untitled", "sans nom")} » — ${r.map((x) => `${x.nom} : ${x.texteOrigine} → ${x.texteValeur}`).join(" ; ")}` : L("original", "d’origine"); })()],
      [L("Class code", "Code de classe"), setup.classCode || L("Default", "Par défaut")],
      [L("Study group", "Groupe d’étude"), setup.studyGroup || L("Not set", "Non défini")],
      [L("Action limit", "Limite d’actions"), state.rules.unlimited ? L("Unlimited", "Illimitée") : String(state.rules.actionLimit)],
      [L("Target year", "Année cible"), String(state.rules.targetYear)],
      [L("Bankruptcy threshold", "Seuil de faillite"), money(state.rules.bankruptcyThreshold)]
    ];
  }

  function setupLogLines() {
    return [
      ...(state.setupLog || []).map((entry) => `${L("Year", "Année")} ${entry.year}: ${entry.changes.map((change) => `${change.field} ${change.from} → ${change.to}`).join(", ")}`),
      ...(state.cashLog || []).map((entry) => `${L("Year", "Année")} ${entry.year}: ${L("cash", "trésorerie")} ${signed(entry.amount, "money")} · ${cashReasonLabel(entry.reason)}`),
      // An undo is a fact about how the week was played, so it belongs in the record the instructor
      // reads, beside the settings changes and the cash adjustments.
      ...(state.decisionLog || []).filter((entry) => entry.event === "undo-year").map((entry) => `${L("Year", "Année")} ${entry.year}: ${L("year undone", "année annulée")}`)
    ];
  }

  function renderSetupRecord() {
    const lines = setupLogLines();
    return `<details class="card-section setup-record"><summary>${escapeHtml(L("Game setup record", "Relevé du paramétrage"))}</summary><dl class="help-glossary">${setupSummaryRows().map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>${lines.length ? `<ul class="cash-log">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No setting changes or cash adjustments.", "Aucun changement de paramètre ni ajustement de trésorerie."))}</p>`}</details>`;
  }

  function renderCashAdjuster() {
    return `<div class="cash-adjuster"><h3>${escapeHtml(L("Adjust cash", "Ajuster la trésorerie"))}</h3><p>${escapeHtml(L("Use only when your instructor announces a grant, fine, or shock. It is applied immediately, does not use an action, and is recorded in the report.", "À utiliser seulement quand votre enseignant annonce une subvention, une amende ou un choc. L’ajustement est immédiat, n’utilise pas d’action et figure dans le rapport."))}</p><div class="cash-fields"><label><span>${escapeHtml(L("Amount (negative to remove)", "Montant (négatif pour retirer)"))}</span><input type="number" step="1000" data-cash-amount></label><label><span>${escapeHtml(L("Reason", "Motif"))}</span><select data-cash-reason>${["grant", "fine", "shock", "other"].map((reason) => `<option value="${reason}">${escapeHtml(cashReasonLabel(reason))}</option>`).join("")}</select></label><button class="button secondary" data-adjust-cash>${escapeHtml(L("Apply cash adjustment", "Appliquer l’ajustement"))}</button></div>${state.cashLog.length ? `<ul class="cash-log">${state.cashLog.map((entry) => `<li>${escapeHtml(L("Year", "Année"))} ${entry.year}: ${escapeHtml(signed(entry.amount, "money"))} · ${escapeHtml(cashReasonLabel(entry.reason))}</li>`).join("")}</ul>` : ""}</div>`;
  }

  function renderStaffExitDrawer(planned, forecast) {
    const person = planned.staff.find((item) => item.id === ui.drawerContext);
    if (!person) return `<p>${escapeHtml(L("This person is no longer on the planned team.", "Cette personne ne fait plus partie de l’équipe planifiée."))}</p>`;
    const row = forecast.operational.staffRows.find((item) => item.id === person.id);
    const severance = person.salary * D.staffModel.severanceShare;
    const services = normalizeAllocations(person).filter((item) => item.share > 0).map((item) => serviceName(item.serviceId)).join(", ");
    const key = `fire:${person.id}`;
    const payload = { kind: "fire", targetId: person.id };
    return `<div class="staff-editor"><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(L(`Letting ${person.name} go costs ${money(severance)} in severance (3 months’ salary), removes their ${number(row?.availableHours || 0)} available hours this year, and lowers the team’s climate by ${Math.abs(D.staffModel.departureClimate)}. Their annual salary of ${money(person.salary)} stops.`, `Se séparer de ${person.name} coûte ${money(severance)} d’indemnité (3 mois de salaire), retire ses ${number(row?.availableHours || 0)} heures disponibles cette année et baisse le climat de l’équipe de ${Math.abs(D.staffModel.departureClimate)}. Son salaire annuel de ${money(person.salary)} s’arrête.`))}</p><p><strong>${escapeHtml(L("Services they work on", "Services concernés"))}:</strong> ${escapeHtml(services || "—")}</p><p class="no-effect">${escapeHtml(L("Services left without anyone show as “Nobody assigned”. A former applicant cannot be rehired for a year.", "Les services laissés sans personne apparaissent « Personne d’affecté ». Un ancien candidat ne peut pas être réembauché pendant un an."))}</p>${consequencePreview(key, payload)}${reviewButton(key, payload, L("Let go", "Se séparer"))}</div>`;
  }

  function previewAction(key, payload) {
    const without = pendingActions().filter((action) => action.key !== key);
    const before = simulatePlan(without);
    const after = simulatePlan([...without, { key, payload }]);
    if (!hasSettledYear(payload)) return { before, after, settledBefore: null, settledAfter: null };
    return { before, after, settledBefore: settledPlan(without), settledAfter: settledPlan([...without, { key, payload }]) };
  }

  // What a decision adds to each cost line, by name. "Coût ajouté par an" used to fuse all of these
  // into one euro figure, which is why no card's price ever matched its preview: opening a service
  // showed +12 090 € against a card with no price at all, and a hire card said 52 000 € while its
  // preview said 63 440 € — the 22% employer charge appeared nowhere in the app.
  function costBuckets(run) {
    const f = run.financial;
    return {
      variable: f.variableCosts,
      payroll: f.payroll,
      charges: f.socialCharges,
      overtime: f.overtimeCost,
      facilities: f.facilityCosts,
      admin: f.admin,
      operating: f.openingCosts + f.dropoffCost + f.stockCost + f.hrCost + f.marketingCost + f.sustainabilityCost + f.loanInterest
    };
  }

  const COST_LINES = [
    ["variable", () => L("Variable costs", "Coûts variables")],
    ["payroll", () => L("Salaries", "Salaires")],
    ["charges", () => L("Employer charges", "Charges sociales")],
    ["overtime", () => L("Overtime", "Heures supplémentaires")],
    ["facilities", () => L("Facilities", "Installations")],
    ["admin", () => L("Administration", "Frais d’administration")],
    ["operating", () => L("Operating costs", "Coûts d’exploitation")]
  ];

  // What this one choice moves, and nothing else: signed changes, only where something changes. The
  // plan panel carries the whole picture once the choice is added (owner, 2026-10-19).
  // The indicators a kind of decision acts on directly — the reason someone would choose it.
  function directIndicators(payload) {
    const k = payload?.kind;
    if (k === "sustainability" || k === "parking") return new Set(["carbon"]);
    if (k === "location") return new Set(["carbon", "clientTrust"]);
    if (k === "social-action") return new Set(Object.keys(D.socialActions[payload.targetId]?.deltas || {}));
    if (k === "marketing-strategy") return new Set(payload.strategy === "communication" ? ["clientTrust"] : []);
    if (k === "salary" || k === "hr" || k === "opening-period" || k === "fire") return new Set(["staffClimate"]);
    if (k === "price") return new Set(["clientTrust"]);
    if (k === "service-pace") return new Set(["clientTrust", "staffClimate"]);
    if (k === "dropoff") return new Set(["clientTrust"]);
    return new Set();
  }

  function consequencePreview(key, payload, options = {}) {
    const { before, after, settledBefore, settledAfter } = previewAction(key, payload);
    const hidden = forecastPrecision() === "costs";
    const cells = [];
    // Costs, by the line they land on, with the second year when it differs.
    const once = after.financial.oneTimeCosts - before.financial.oneTimeCosts;
    const firstYear = costBuckets(after), baseYear = costBuckets(before);
    const settled = settledAfter ? costBuckets(settledAfter) : null;
    const settledBase = settledBefore ? costBuckets(settledBefore) : null;
    if (Math.abs(once) >= 1) cells.push([L("One-time costs", "Coûts ponctuels"), signed(once, "money"), "", "cost"]);
    COST_LINES.forEach(([id, label]) => {
      const now = firstYear[id] - baseYear[id];
      const later = settled ? settled[id] - settledBase[id] : now;
      if (Math.abs(now) < 1 && Math.abs(later) < 1) return;
      cells.push([label(), signed(now, "money"), Math.abs(later - now) >= 1 ? L(`${money(later)} from year two`, `${money(later)} ensuite`) : "", "cost"]);
    });
    // Outcomes this choice moves.
    const refused = (run) => run.operational.totalDemand - run.operational.totalHonored;
    const refusedCause = () => {
      const was = Object.fromEntries(refusalSplit(before).map((p) => [p.key, p.count]));
      const grew = refusalSplit(after).map((p) => ({ ...p, delta: p.count - (was[p.key] || 0) })).filter((p) => p.delta > 0).sort((a, b) => b.delta - a.delta)[0];
      return grew && grew.key === "stock" ? grew.label : "";
    };
    const outcome = (label, a, b, type, threshold, note = "") => { if (Math.abs(b - a) >= threshold) cells.push([label, type === "carbon" ? `${b - a >= 0 ? "+" : "−"}${tonnes(Math.abs(b - a))}` : type === "percent" ? `${b - a >= 0 ? "+" : "−"}${Math.abs(Math.round((b - a) * 100))} pts` : signed(Math.round(b - a), type), note, "outcome"]); };
    if (!hidden) {
      // What it does to activity — what the choice is for. Money totals, workload and the social
      // indicators are in « Impact du plan »; one is repeated here only when the choice acts on it
      // directly (a meeting on climate, communication on trust, a measure on carbon).
      const direct = directIndicators(payload);
      // Requests = cases + refusals, so one of the three is always redundant. Cases always; refusals
      // only when demand itself moves — otherwise they are just the mirror of the cases (owner,
      // 2026-10-19). The requests line, their sum, is not shown.
      outcome(L("Cases served", "Cas traités"), before.operational.totalHonored, after.operational.totalHonored, "number", .5);
      if (Math.abs(after.operational.totalDemand - before.operational.totalDemand) >= .5) outcome(L("Requests refused", "Demandes refusées"), refused(before), refused(after), "number", .5, refused(after) > refused(before) ? refusedCause() : "");
      outcome(L("Households next year", "Foyers l’an prochain"), before.next.clients, after.next.clients, "number", .5);
      if (direct.has("carbon")) outcome(L("Carbon footprint", "Empreinte carbone"), before.carbon.total, after.carbon.total, "carbon", .05);
      if (direct.has("staffClimate")) outcome(L("Staff climate", "Climat de l’équipe"), before.social.after.staffClimate, after.social.after.staffClimate, "number", .5);
      if (direct.has("clientTrust")) outcome(L("Client trust", "Confiance des clients"), before.social.after.clientTrust, after.social.after.clientTrust, "number", .5);
      if (direct.has("referralSupport")) outcome(itemLabel(D.socialIndicators.referralSupport), before.social.after.referralSupport, after.social.after.referralSupport, "number", .5);
      if (direct.has("communityPressure")) outcome(itemLabel(D.socialIndicators.communityPressure), before.social.after.communityPressure, after.social.after.communityPressure, "number", .5);
    }
    const served = after.operational.totalHonored - before.operational.totalHonored;
    const workload = after.operational.staffUse - before.operational.staffUse;
    const note = options.note === false ? [] : (Math.abs(served) < .5 && Math.abs(workload) < .0001 ? noEffectReason(payload) : []);
    // The duration marker rides with the preview so every decision surface gets it from one place.
    return `<small class="lasts">${escapeHtml(durationLabel(payload))}</small>`
      + (cells.length ? `<div class="consequence-grid delta-list" aria-label="${escapeHtml(L("What this choice changes", "Ce que ce choix change"))}" data-cost-block>${cells.map(([label, value, extra, kind]) => `<div class="${kind}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${extra ? `<em>${escapeHtml(extra)}</em>` : ""}</div>`).join("")}</div>` : `<p class="no-effect">${escapeHtml(L("Changes nothing this year", "Ne change rien cette année"))}</p>`)
      + (hidden ? `<p class="no-effect">${escapeHtml(L("Outcomes revealed at year end", "Effets révélés en fin d’année"))}</p>` : "")
      + needsTags(note);
  }


  // Why a decision leaves cases unchanged, as marks rather than a sentence: per service, each
  // condition still missing. Empty when nothing is missing — the unchanged « Cas traités » row says
  // the rest.
  // Several versions of one decision, compared on one table: a column per version, a row per effect
  // that moves in at least one of them, signed. Replaces one full preview block per version.
  function compareOptions(options) {
    const runs = options.map((o) => ({ ...o, ...previewAction(o.key, o.payload) }));
    const d = (r, get) => get(r.after) - get(r.before);
    const recurring = (run) => run.financial.totalCosts - run.financial.oneTimeCosts;
    const rows = [
      [L("One-time costs", "Coûts ponctuels"), (r) => d(r, (x) => x.financial.oneTimeCosts), "money", false],
      [L("Recurring costs", "Coûts récurrents"), (r) => d(r, recurring), "money", false],
      [L("Net result", "Résultat net"), (r) => d(r, (x) => x.financial.netResult), "money", true],
      [L("End treasury", "Trésorerie finale"), (r) => d(r, (x) => x.financial.treasury), "money", true],
      [L("Cases served", "Cas traités"), (r) => d(r, (x) => x.operational.totalHonored), "number", true],
      [L("Carbon footprint", "Empreinte carbone"), (r) => d(r, (x) => x.carbon.total), "carbon", false]
    ].filter(([, get, , always]) => always || runs.some((r) => Math.abs(get(r)) >= (1)));
    const cell = (v, type) => type === "carbon" ? `${v >= 0 ? "+" : "−"}${tonnes(Math.abs(v))}` : signed(Math.round(v), type);
    if (forecastPrecision() === "costs") return "";
    return `<table class="compare-options"><thead><tr><th></th>${runs.map((r) => `<th>${escapeHtml(r.label)}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, get, type]) => `<tr><th>${escapeHtml(label)}</th>${runs.map((r) => { const v = get(r); return `<td class="${Math.round(v) > 0 && type !== "money" ? "good-text" : ""}">${escapeHtml(cell(v, type))}</td>`; }).join("")}</tr>`).join("")}</tbody><tfoot><tr><th><small class="lasts">${escapeHtml([...new Set(runs.map((r) => durationLabel(r.payload)))].join(" / "))}</small></th>${runs.map((r) => `<td>${reviewButton(r.key, r.payload, r.button)}</td>`).join("")}</tr></tfoot></table>`;
  }

  function needsTags(note) {
    return note && note.length ? `<div class="needs" aria-label="${escapeHtml(L("Still missing", "Manque encore"))}">${note.map((n) => `<p>${n.service ? `<strong>${escapeHtml(serviceName(n.service))}</strong>` : ""}${n.missing.map((m) => `<span class="need-tag">✗ ${escapeHtml(m)}</span>`).join("")}</p>`).join("")}</div>` : "";
  }

  function noEffectReason(payload) {
    const planned = plannedState();
    const serviceKinds = ["price", "service-pace"];
    if (serviceKinds.includes(payload.kind) && !planned.services[payload.targetId]?.active) return [{ service: payload.targetId, missing: [L("service closed", "service fermé")] }];
    const serviceIds = payload.kind === "room-add" ? D.services.filter((service) => service.roomIds.includes(payload.targetId)).map((service) => service.id)
      : payload.kind === "equipment-acquire" ? D.services.filter((service) => service.equipmentIds.includes(payload.targetId)).map((service) => service.id)
      : payload.kind === "training" ? D.services.filter((service) => service.vetSkills.includes(payload.targetId) || service.supportSkills.includes(payload.targetId)).map((service) => service.id)
      : [];
    if (serviceIds.length) {
      const after = clone(planned);
      applyAction(after, { payload }, false);
      return serviceIds.map((id) => {
        const short = (r) => r.type === "missingRoom" ? roomName(r.id) : r.type === "missingEquipment" ? equipmentName(r.id) : r.type === "missingVetSkill" || r.type === "missingSupportSkill" ? L(`skill: ${skillName(r.id)}`, `compétence : ${skillName(r.id)}`) : blockerText(r);
        const missing = missingRequirements(SERVICE_BY_ID[id], after).map(short);
        if (!after.services[id].active) missing.push(L("service open", "service ouvert"));
        return missing.length ? { service: id, missing } : null;
      }).filter(Boolean).slice(0, 3);
    }
    if (payload.kind === "dropoff" && planned.staff.filter((person) => person.role === "support").length < 2) return [{ missing: [L("two support staff", "deux personnes de soutien")] }];
    if (payload.kind === "parking" && !["routine", "budget"].includes(planned.marketFocus) && !planned.services.boarding.active) return [{ missing: [L("routine or budget clients, or boarding", "clients soins courants ou prix, ou pension")] }];
    if (payload.kind === "social-action" && D.socialActions[payload.targetId]?.advancedDemand && !D.services.some((service) => ADVANCED_SERVICES.has(service.id) && planned.services[service.id].active)) return [{ missing: [L("an advanced service open", "un service avancé ouvert")] }];
    return [];
  }

  function encodedPayload(payload) {
    return encodeURIComponent(JSON.stringify(payload));
  }

  // Cards already show their consequences, so their button adds straight to the plan.
  function reviewButton(key, payload, label) {
    const pending = state.pending[key];
    const sameToggle = pending && typeof payload.value === "boolean" && pending.payload.kind === payload.kind && pending.payload.targetId === payload.targetId;
    if (pending && (sameToggle || JSON.stringify(pending.payload) === JSON.stringify(payload))) return `<span class="in-plan">✓ ${escapeHtml(L("In plan", "Dans le plan"))}</span><button class="button secondary" data-remove-action="${escapeHtml(key)}">${escapeHtml(L("Undo", "Annuler"))}</button>`;
    const left = isFreeAction(payload) ? Infinity : actionLimit() - countedActions().length;
    if (!pending && left <= 0) return `<button class="button secondary limit-button" data-open-drawer="plan">${escapeHtml(L("Limit reached — remove one", "Limite atteinte — retirez-en une"))}</button>`;
    const suffix = Number.isFinite(left) ? ` · ${pending ? L("replaces a planned action", "remplace une action prévue") : L(`${left} left`, `${left} restante${left > 1 ? "s" : ""}`)}` : "";
    return `<button class="button primary" data-add-key="${escapeHtml(key)}" data-add-payload="${escapeHtml(encodedPayload(payload))}">${escapeHtml(`${label || L("Add to plan", "Ajouter au plan")}${suffix}`)}</button>`;
  }

  // Every decision says how long it lasts. Students could not tell a one-off purchase from an
  // annual subscription, and five one-year effects were invisible entirely: a new service's 60%
  // first year, the 10% cost of changing market, the 5% cost of moving, a new hire's settling-in
  // quarter, and the year you cannot rehire someone you let go.
  function durationLabel(payload) {
    if (!payload) return "";
    const once = L("Once", "Une fois");
    const annual = L("Every year", "Chaque année");
    const onceThenAnnual = L("Once, then every year", "Une fois, puis chaque année");
    const standing = L("Until you change it", "Jusqu’au prochain changement");
    const rider = (text) => ` · ${text}`;
    const kind = payload.kind;
    if (kind === "loan") return L("Five years", "Cinq ans");
    if (kind === "toggle-service") return payload.value ? standing + rider(L("first year 60% of demand", "première année 60 % de la demande")) : standing;
    if (kind === "market-focus") return standing + rider(L("first year −10% requests", "première année −10 % de demandes"));
    if (kind === "location") return onceThenAnnual + rider(L("first year −5% requests", "première année −5 % de demandes"));
    if (kind === "hire") return annual + rider(L("first year 25% settling in", "première année 25 % d’intégration"));
    if (kind === "fire") return once + rider(L("no rehire for one year", "pas de réembauche pendant un an"));
    if (kind === "equipment-acquire") return payload.mode === "lease" ? annual : onceThenAnnual;
    if (kind === "room-add") return onceThenAnnual;
    if (kind === "parking") return payload.value ? onceThenAnnual : once;
    if (["price", "service-pace", "staff-allocation", "schedule"].includes(kind)) return standing;
    if (["opening-period", "dropoff", "stock-strategy", "hr-strategy", "marketing-strategy", "salary"].includes(kind)) return annual;
    if (kind === "sustainability") return ["energyUpgrade", "heatPump", "solar", "accessPlan", "wasteStrategy"].includes(payload.targetId) ? onceThenAnnual : once;
    return once;
  }

  // The choice already in force is shown as such: no preview, no button. Choosing it again used to
  // be a real action — moving to the neighbourhood you are in cost 20 000 € (owner, 2026-10-19).
  function choiceCard(current, title, description, key, payload, meta = "", id = null) {
    if (!current) return optionCard(title, description, key, payload, meta, id);
    return `<article class="choice-card current"><h3>${escapeHtml(title)} <span class="badge good">${escapeHtml(L("Current", "Actuel"))}</span></h3><p>${escapeHtml(description)}</p>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</article>`;
  }

  function optionCard(title, description, key, payload, meta = "", id = null) {
    return `<article${id ? targetCard(id) : ' class="choice-card"'}><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}${consequencePreview(key, payload)}${reviewButton(key, payload)}</article>`;
  }

  function sourceLabel(id) {
    return ({ building: L("Building and energy", "Bâtiment et énergie"), clinical: L("Clinical care", "Soins cliniques"), waste: L("Materials and waste", "Matériaux et déchets"), travel: L("Client travel", "Déplacements des clients") })[id] || id;
  }

  const DRIVER_LABELS = () => ({
    served: L("requests served", "demandes servies"), communication: L("communication", "communication"), access: L("access plan", "plan d’accès"), pace: L("pace", "rythme"), price: L("prices too high", "prix trop élevés"), refused: L("refusals piling up", "refus accumulés"), carbon: L("footprint per case", "empreinte par cas"), dropoff: L("drop-off", "dépôt"), stockouts: L("stock-outs", "ruptures"),
    hr: L("HR strategy", "stratégie RH"), openingHours: L("opening hours", "horaires"), pay: L("pay", "salaires"), overtime: L("overtime", "heures sup."), workload: L("workload", "charge"), departure: L("departure", "départ")
  });
  // Where each cause is acted on: a drawer, or a work area.
  const DRIVER_TARGET = { price: { drawer: "pricing" }, pace: { drawer: "services" }, refused: { drawer: "rooms" }, served: { drawer: "rooms" }, carbon: { domain: "sustainability" }, access: { domain: "sustainability" }, communication: { drawer: "marketing" }, stockouts: { drawer: "stock" }, dropoff: { drawer: "dropoff" }, hr: { drawer: "hr" }, openingHours: { drawer: "opening" }, pay: { domain: "team" }, overtime: { domain: "team" }, workload: { domain: "team" }, departure: { domain: "team" } };

  // ---------- Where a person's hours went ----------
  // One bar, one ruler: worked hours, then each share of the assigned hours that was not worked,
  // grouped by what stopped it, with a mark at the hours available. Left of the mark is paid; right
  // of it is paid only if worked (overtime). The bar shows it; it does not explain it.


  function capLabel(b) {
    if (b?.type === "roomFull" || b?.type === "equipmentFull") return blockerText(b);
    return "";
  }

  // Refused requests, split by what refused them. One number everywhere, and its parts add up.
  function refusalCause(reason) {
    const r = reason || {};
    if (r.type === "roomFull") return { key: `room:${r.id}`, label: capLabel(r), target: { drawer: "rooms" } };
    if (r.type === "equipmentFull") return { key: `eq:${r.id}`, label: capLabel(r), target: { drawer: "equipment" } };
    if (r.type === "vetHours" || r.type === "supportHours" || r.type === "unstaffed") return { key: r.type === "unstaffed" ? `unstaffed:${r.id}` : r.type, label: blockerText(r), target: { domain: "team" } };
    if (r.type === "stockout") return { key: "stock", label: blockerText(r), target: { drawer: "stock" } };
    return { key: `${r.type}:${r.id || ""}`, label: blockerText(r), target: { drawer: "services" } };
  }

  // Before the year is passed, screens show measurements, not the cause of refusals — finding it is
  // the students' diagnosis, given in Résultats. Stock-outs are the exception: they belong to the
  // stock strategy, not to a constraint, and naming them keeps a first opening understandable.
  function stockoutsFor(report, serviceId) {
    return refusalSplit(report, serviceId).find((p) => p.key === "stock")?.count || 0;
  }

  function refusalSplit(report, serviceId) {
    const parts = {};
    (report.serviceResults || []).filter((r) => r.active && (!serviceId || r.id === serviceId)).forEach((r) => (r.lostBy || []).forEach((l) => {
      const c = refusalCause(l.reason);
      parts[c.key] = parts[c.key] || { ...c, count: 0 };
      parts[c.key].count += l.count;
    }));
    return Object.values(parts).filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
  }

  // The same split as a bar with its legend, on the scale of the refusals themselves.
  function refusalBar(report, serviceId) {
    const parts = refusalSplit(report, serviceId);
    const total = parts.reduce((sum, p) => sum + p.count, 0);
    if (!total) return "";
    const cls = (i) => `hb-lost hb-lost-${Math.min(i, 2)}`;
    return `<div class="hour-bar refusal-bar" role="img" aria-label="${escapeHtml(parts.map((p) => `${p.label} ${number(p.count)}`).join(", "))}"><div class="hb-track">${parts.map((p, i) => `<span class="hb-seg ${cls(i)}" style="width:${(p.count / total * 100).toFixed(2)}%"></span>`).join("")}</div><ul class="hb-legend">${parts.map((p, i) => `<li><b class="${cls(i)}"></b>${p.target ? `<button class="text-button" ${p.target.drawer ? `data-open-drawer="${p.target.drawer}"` : `data-domain="${p.target.domain}"`}>${escapeHtml(p.label)}</button>` : escapeHtml(p.label)} <strong>${number(p.count)}</strong></li>`).join("")}</ul></div>`;
  }

  // Why a person's assigned hours went unworked, split by cause. An assignment's idle hours first go
  // to the requests its service lost to something other than this role's own hours (a full room,
  // the other role, stock-outs) — those requests' time for this role, at this person's share of the
  // service; whatever is left is hours beyond what the requests needed: not enough demand.
  // Before the year, only causes that are not the year's constraint are named (closed service,
  // missing skill, stock-outs, not enough demand); the rest reads « non travaillées ».
  function hourSplit(row, report, attribute = false) {
    const available = row?.availableHours || 0;
    const used = row?.usedHours || 0;
    const role = row?.role;
    const lost = {};
    const add = (cause, hours) => { if (hours < .5) return; const c = attribute || ["closed", "skill", "stock", "demand"].includes(cause.key) ? cause : { key: "unworked", label: L("not worked", "non travaillées") }; lost[c.key] = lost[c.key] || { ...c, hours: 0 }; lost[c.key].hours += hours; };
    const pools = {};
    (report.operational.staffRows || []).filter((r) => r.role === role).forEach((r) => (r.assignments || []).forEach((a) => { pools[a.serviceId] = (pools[a.serviceId] || 0) + (a.effectiveHours || 0); }));
    (row?.assignments || []).forEach((a) => {
      const gap = Math.max(0, (a.qualified ? a.effectiveHours : a.assignedHours || a.effectiveHours) - (a.usedHours || 0));
      if (gap < .5) return;
      if (!a.qualified) return add({ key: "skill", label: L("missing skill", "compétence manquante") }, gap);
      const result = (report.serviceResults || []).find((r) => r.id === a.serviceId);
      if (!result?.active) return add({ key: "closed", label: L("service closed", "service fermé"), target: { drawer: "services" } }, gap);
      const ownHours = role === "vet" ? "vetHours" : "supportHours";
      const perCase = role === "vet" ? (result.vetDuration || result.supportDuration || 0) : (result.supportDuration || 0);
      const share = pools[a.serviceId] ? a.effectiveHours / pools[a.serviceId] : 0;
      let left = gap;
      (result.lostBy || []).filter((l) => l.reason.type !== ownHours).forEach((l) => {
        const hours = Math.min(left, l.count * perCase * share);
        if (hours >= .5) { add(refusalCause(l.reason), hours); left -= hours; }
      });
      add({ key: "demand", label: L("not enough demand", "pas assez de demande") }, left);
    });
    const lostList = Object.values(lost).sort((x, y) => y.hours - x.hours);
    const assigned = used + lostList.reduce((sum, l) => sum + l.hours, 0);
    // A vet's worked hours that went to support tasks (the support staff could not cover them).
    const covered = role === "vet" ? (row?.assignments || []).reduce((sum, a) => { const r = (report.serviceResults || []).find((x) => x.id === a.serviceId); return sum + (r?.vetCoverHours && pools[a.serviceId] ? r.vetCoverHours * a.effectiveHours / pools[a.serviceId] : 0); }, 0) : 0;
    return { available, used, overtime: Math.max(0, used - available), unassigned: Math.max(0, available - assigned), lost: lostList, assigned, covered: Math.min(covered, used) };
  }


  function hourBar(row, report) {
    const h = hourSplit(row, report);
    const scale = Math.max(h.available, h.assigned, h.used, 1);
    const w = (v) => `${(v / scale * 100).toFixed(2)}%`;
    const covered = Math.min(h.covered || 0, Math.min(h.used, h.available));
    const worked = Math.min(h.used, h.available) - covered;
    const seg = (cls, v, label) => v >= .5 ? `<span class="hb-seg ${cls}" style="width:${w(v)}" title="${escapeHtml(`${label} ${number(v)} h`)}"></span>` : "";
    const legend = [
      [`hb-worked`, worked, L("worked", "travaillées")],
      [`hb-covered`, covered, L("support tasks covered", "soutien couvert")],
      [`hb-over`, h.overtime, L("overtime", "heures sup.")],
      ...h.lost.map((l, i) => [`hb-lost hb-lost-${Math.min(i, 2)}`, l.hours, l.label, l.target]),
      [`hb-free`, h.unassigned, L("not assigned", "non affectées")]
    ].filter(([, v]) => v >= .5);
    const aria = `${L("Hours", "Heures")} : ${legend.map(([, v, label]) => `${label} ${number(v)}`).join(", ")} ; ${L("available", "disponibles")} ${number(h.available)}`;
    return `<div class="hour-bar" role="img" aria-label="${escapeHtml(aria)}"><div class="hb-track">${seg("hb-worked", worked, L("worked", "travaillées"))}${seg("hb-covered", covered, L("support tasks covered", "soutien couvert"))}${seg("hb-over", h.overtime, L("overtime", "heures sup."))}${h.lost.map((l, i) => seg(`hb-lost hb-lost-${Math.min(i, 2)}`, l.hours, l.label)).join("")}${seg("hb-free", h.unassigned, L("not assigned", "non affectées"))}<i class="hb-mark ${h.available / scale > .8 ? "end" : ""}" style="left:${w(h.available)}"><em>${number(h.available)} h</em></i></div><ul class="hb-legend">${legend.map(([cls, v, label, target]) => `<li><b class="${cls.split(" ")[0]} ${cls.split(" ")[1] || ""}"></b>${target ? `<button class="text-button" data-open-drawer="${target.drawer}">${escapeHtml(label)}</button>` : escapeHtml(label)} <strong>${number(v)}</strong></li>`).join("")}</ul></div>`;
  }

  function tiredSlowdown(clinic) {
    const sm = D.socialModel || {};
    const climate = Number(clinic.social?.staffClimate ?? 50);
    return climate < (sm.slowBelow ?? 0) ? (sm.slowBelow - climate) * (sm.slowPerPoint || 0) : 0;
  }

  // ---------- The year's signals: what moved, and what it does next ----------
  // Plain lines, each a cause and its effect, with the screen where it is acted on. They are what
  // the next year is diagnosed from; nothing here is a forecast of more than one year.
  function signalLines(report) {
    const op = report.operational;
    const so = report.social;
    const b = so.before || {};
    const a = so.after || {};
    const tm = D.trustModel || {};
    const sm = D.socialModel || {};
    const labels = DRIVER_LABELS();
    const lines = [];
    const add = (tone, cause, effect, target) => lines.push({ tone, cause, effect, target });
    const mainCause = (parts, delta) => {
      const entries = Object.entries(parts || {}).filter(([, v]) => Math.sign(v) === Math.sign(delta) && Math.abs(v) >= .3).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      return entries[0] ? { key: entries[0][0], label: labels[entries[0][0]] || entries[0][0] } : null;
    };
    const refused = Math.max(0, op.totalDemand - op.totalHonored);
    if (refused > 0) add(so.refusedLeft > 0 ? "bad" : "", L(`${number(refused)} requests refused`, `${number(refused)} demandes refusées`), so.refusedLeft > 0 ? L(`${number(so.refusedLeft)} households went elsewhere for good · ${number(report.next.clients)} households next year`, `${number(so.refusedLeft)} foyers partis ailleurs pour de bon · ${number(report.next.clients)} foyers l’an prochain`) : L(`${number(report.next.clients)} households next year`, `${number(report.next.clients)} foyers l’an prochain`), { drawer: "rooms" });
    const climateDelta = (a.staffClimate ?? 0) - (b.staffClimate ?? 0);
    if (Math.abs(climateDelta) >= .5 || (a.staffClimate ?? 50) < (sm.slowBelow ?? 0)) {
      const cause = mainCause(so.climateParts, climateDelta);
      const slow = tiredSlowdown({ social: a });
      const effect = (a.staffClimate ?? 50) < D.staffModel.resignClimate ? L("someone resigns at year end", "quelqu’un démissionne en fin d’année")
        : slow > 0 ? L(`next year every case takes ${pct(slow)} more time, and absences rise`, `l’an prochain, chaque cas prend ${pct(slow)} de temps en plus, et les absences montent`)
        : climateDelta < 0 ? L("still above the line: no cost yet", "encore au-dessus de la ligne : pas encore de coût") : L("absences fall", "les absences baissent");
      add(slow > 0 ? "bad" : climateDelta < 0 ? "warn" : "good", L(`Staff climate ${number(b.staffClimate)} → ${number(a.staffClimate)}`, `Climat de l’équipe ${number(b.staffClimate)} → ${number(a.staffClimate)}`) + (cause ? ` (${cause.label})` : ""), effect, DRIVER_TARGET[cause?.key] || { domain: "team" });
    }
    (op.staffRows || []).forEach((row) => {
      const lost = hourSplit(row, report, true).lost.filter((l) => l.key !== "demand" && l.hours >= 50)[0];
      const name = (state.staff.find((p) => p.id === row.id) || {}).name || row.id;
      if (lost) add("warn", L(`${number(lost.hours)} h of ${name}'s assigned time not worked`, `${number(lost.hours)} h affectées à ${name}, non travaillées`), lost.label, lost.target || { domain: "team" });
    });
    const returns = (report.serviceResults || []).filter((r) => (r.returnVisits || 0) > 0);
    returns.forEach((r) => add("warn", L(`${number(r.returnVisits)} return visits (${serviceName(r.id)}, rushed)`, `${number(r.returnVisits)} retours de visites pressées (${serviceName(r.id)})`), L("unpaid, they take staff and room time, and cost trust", "non payés, ils reprennent du temps d’équipe et de salle, et coûtent de la confiance"), { drawer: "services" }));
    const overpriced = (report.serviceResults || []).filter((r) => r.active && r.acceptedPrice && r.price > r.acceptedPrice + .5);
    const knownAt = (r) => acceptedText(acceptedKnown(SERVICE_BY_ID[r.id], { marketing: report.clinicSnapshot?.marketing || state.marketing }, r.acceptedPrice));
    overpriced.forEach((r) => add("warn", L(`${serviceName(r.id)} at ${money(r.price)}, clients accept ${knownAt(r)}`, `${serviceName(r.id)} à ${money(r.price)}, vos clients acceptent ${knownAt(r)}`), L("fewer requests, and trust falls every year", "moins de demandes, et la confiance baisse chaque année"), { drawer: "pricing" }));
    const overtime = Math.round(report.financial.overtimeHours || 0);
    if (overtime > 0) add("warn", L(`${number(overtime)} overtime hours`, `${number(overtime)} heures supplémentaires`), L("more absences next year", "plus d’absences l’an prochain"), { domain: "team" });
    const trustDelta = (a.clientTrust ?? 0) - (b.clientTrust ?? 0);
    if (Math.abs(trustDelta) >= .5) {
      const cause = mainCause(so.trustParts, trustDelta);
      const effect = (a.clientTrust ?? 50) < (tm.fleeBelow ?? -1) ? L("households leave fast", "les foyers partent vite")
        : (a.clientTrust ?? 50) < (tm.leaveBelow ?? -1) ? L("households leave every year", "des foyers partent chaque année")
        : (a.clientTrust ?? 50) > (tm.referAbove ?? 101) ? L("word of mouth brings households", "le bouche-à-oreille amène des foyers")
        : trustDelta < 0 ? L("clients accept lower prices, and fewer of them come", "vos clients acceptent des prix plus bas, et viennent moins") : L("clients accept higher prices, and more of them come", "vos clients acceptent des prix plus hauts, et viennent plus");
      add(trustDelta < 0 ? "warn" : "good", L(`Client trust ${number(b.clientTrust)} → ${number(a.clientTrust)}`, `Confiance des clients ${number(b.clientTrust)} → ${number(a.clientTrust)}`) + (cause ? ` (${cause.label})` : ""), effect, DRIVER_TARGET[cause?.key] || { drawer: "relations" });
    }
    const pressure = a.communityPressure ?? 0;
    if (pressure > 50) add("warn", L(`Access pressure ${number(pressure)}`, `Pression d’accès ${number(pressure)}`), L(`costs ${decimal((pressure - 50) * (sm.pressureTrustSlope || 0), 1)} trust next year`, `coûte ${decimal((pressure - 50) * (sm.pressureTrustSlope || 0), 1)} de confiance l’an prochain`), { drawer: "rooms" });
    const before = { ...state, history: state.history.filter((r) => r.turn < report.turn) };
    (report.commitments || []).filter((c) => !c.ok).forEach((c) => add("bad", L(`Promise missed: ${stakeholderLabel(c.id)}`, `Promesse manquée : ${stakeholderLabel(c.id)}`), L(`next year: ${commitmentConsequence(c.id, false, before, report)}`, `l’an prochain : ${commitmentConsequence(c.id, false, before, report)}`), c.id === "bank" ? { drawer: "finance" } : c.id === "commune" ? { domain: "sustainability" } : c.id === "peers" ? { drawer: "services" } : c.id === "team" ? { domain: "team" } : { drawer: "rooms" }));
    return lines;
  }

  function renderSignals(report) {
    const lines = signalLines(report);
    const link = (t) => t?.drawer ? `data-open-drawer="${t.drawer}"` : t?.domain ? `data-domain="${t.domain}"` : "";
    return `<section class="card-section signals"><div class="panel-heading"><div><h2>${escapeHtml(L(`Signals from year ${report.turn}`, `Signaux de l’année ${report.turn}`))}</h2><p>${escapeHtml(L("What moved, and what it does next year. Diagnose the next year from here.", "Ce qui a bougé, et ce que cela fait l’an prochain. Diagnostiquez l’année suivante à partir d’ici."))}</p></div></div>
      <ul class="signal-lines">${lines.length ? lines.map((l) => `<li class="${l.tone}"><span class="signal-cause">${escapeHtml(l.cause)}</span><span class="signal-arrow" aria-hidden="true">→</span><span class="signal-effect">${escapeHtml(l.effect)}</span>${link(l.target) ? `<button class="text-button" ${link(l.target)}>${escapeHtml(L("Act", "Agir"))} ›</button>` : ""}</li>`).join("") : `<li><span>${escapeHtml(L("Nothing moved enough to matter.", "Rien n’a assez bougé pour compter."))}</span></li>`}</ul></section>`;
  }

  // ---------- Households → requests → cases served ----------
  function renderClientFlow(forecast, hideOutcomes) {
    const op = forecast.operational;
    const perHousehold = state.clients ? op.totalDemand / state.clients : 0;
    const refused = Math.max(0, op.totalDemand - op.totalHonored);
    const change = forecast.next.clients - state.clients;
    const out = (v, type = "number") => hideOutcomes ? "?" : forecastText(v, type);
    return `<section class="flow-strip" aria-label="${escapeHtml(L("Households, requests and cases served", "Foyers, demandes et cas traités"))}">
      <div class="flow-step"><span>${escapeHtml(L("Client households", "Foyers clients"))}</span><strong>${number(state.clients)}</strong><em>${escapeHtml(L("the families who come to you", "les familles qui viennent chez vous"))}</em></div>
      <div class="flow-arrow" aria-hidden="true">→<small>${escapeHtml(L(`≈ ${decimal(perHousehold, 1)} per household a year`, `≈ ${decimal(perHousehold, 1)} par foyer et par an`))}</small></div>
      <div class="flow-step"><span>${escapeHtml(L("Requests", "Demandes"))}</span><strong>${number(op.totalDemand)}</strong><em>${escapeHtml(L("for the services you offer", "pour vos services"))}</em>${offerableRequests(forecast) ? `<em>+ ${number(offerableRequests(forecast))} ${escapeHtml(L("for services you could open now", "pour des services ouvrables maintenant"))}</em>` : ""}</div>
      <div class="flow-arrow" aria-hidden="true">→<small>${hideOutcomes ? "?" : `${forecastText(op.honoredRate, "percent")} ${escapeHtml(L("of open requests served", "des demandes ouvertes servies"))}`}</small></div>
      <div class="flow-step ${refused > 0 && !hideOutcomes ? "warn" : ""}"><span>${escapeHtml(L("Cases served", "Cas traités"))}</span><strong>${out(op.totalHonored)}</strong><em>${hideOutcomes ? "" : `${number(refused)} ${escapeHtml(L("refused", "refusées"))}${stockoutsFor(forecast) ? ` · ${escapeHtml(L(`incl. ${number(stockoutsFor(forecast))} stock-outs`, `dont ${number(stockoutsFor(forecast))} ruptures de stock`))}` : ""}`}</em></div>
    </section>`;
  }

  // ---------- Promises: who holds the clinic to each goal, and what they do next year ----------
  function stakeholderLabel(id) {
    return ({ bank: L("The bank", "La banque"), clients: L("The clients", "Les clients"), team: L("The team", "L’équipe"), peers: L("Referring vets", "Les confrères"), commune: L("The municipality", "La commune") })[id] || id;
  }

  function commitmentConsequence(id, ok, clinic, run = null) {
    const cm = D.commitmentModel || {};
    if (id === "bank") {
      const misses = ok ? 0 : bankMisses(clinic) + 1;
      const rate = (cm.bankRates || [.06])[Math.min(misses, (cm.bankRates || [.06]).length - 1)];
      return rate === null ? L("new loan refused", "nouvel emprunt refusé") : L(`loans at ${pct(rate)}`, `emprunt à ${pct(rate)}`);
    }
    if (id === "clients") {
      // What the refusals leave behind is the pressure, and above 50 it costs trust whether or not
      // the promise was kept: say what it does, not what the promise suggests.
      const pressure = run?.social?.after?.communityPressure;
      const cost = pressure > 50 ? (pressure - 50) * (D.socialModel?.pressureTrustSlope || 0) : 0;
      if (pressure === undefined) return ok ? L("refusals settle", "les refus retombent") : L("refusals pile up: trust falls", "les refus s’accumulent : la confiance baisse");
      return cost >= .05 ? L(`access pressure ${number(pressure)}: −${decimal(cost, 1)} trust`, `pression d’accès ${number(pressure)} : −${decimal(cost, 1)} de confiance`) : L(`access pressure ${number(pressure)}: no trust lost`, `pression d’accès ${number(pressure)} : pas de confiance perdue`);
    }
    if (id === "team") return ok ? L("climate holds", "le climat tient") : L("climate falls", "le climat baisse");
    if (id === "peers") return ok ? L(`referral support +${cm.referralKept}`, `référents +${cm.referralKept}`) : L(`referral support ${cm.referralMissed}`, `référents ${cm.referralMissed}`);
    if (id === "commune") return ok ? L(`grant of ${money(cm.grant)}`, `prime de ${money(cm.grant)}`) : L("no grant", "pas de prime");
    return "";
  }

  function endEngagements() {
    const ids = [...new Set(state.history.flatMap((r) => (r.commitments || []).map((c) => c.id)))];
    return `<div class="goal-summary engagement-rows">${ids.map((id) => `<div class="engagement-row end"><strong>${escapeHtml(stakeholderLabel(id))}</strong><span class="engagement-track">${state.history.map((r) => { const c = (r.commitments || []).find((x) => x.id === id); return `<i class="${c ? (c.ok ? "ok" : "ko") : ""}">${c ? (c.ok ? "✓" : "✗") : "·"}</i>`; }).join("")}</span></div>`).join("")}</div>`;
  }

  // A goal in its figures, not its sentence.
  function shortGoal(goal) {
    const v = goal.value;
    switch (goal.id) {
      case "served": return L(`≥ ${pct(v)} of requests served`, `≥ ${pct(v)} des demandes servies`);
      case "net": return L("net result ≥ 0", "résultat net ≥ 0");
      case "cash": return L("treasury > 0", "trésorerie > 0");
      case "staff": return L(`workload ${pct(v[0])}–${pct(v[1])}`, `charge ${pct(v[0])}–${pct(v[1])}`);
      case "services": return L(`≥ ${v} services running`, `≥ ${v} services en service`);
      case "climate": return L(`climate ≥ ${v}`, `climat ≥ ${v}`);
      case "margin": return L(`net margin ≥ ${pct(v)}`, `marge nette ≥ ${pct(v)}`);
      case "advanced": return L(`≥ ${number(v)} advanced cases`, `≥ ${number(v)} cas avancés`);
      case "carbon": return L(`−${pct(v)} CO₂ per case, 80 % of volume kept`, `−${pct(v)} de CO₂ par cas, 80 % du volume gardé`);
      default: return itemLabel(goal.label || { en: goal.id, fr: goal.id });
    }
  }

  function renderEngagements(forecast, planned, hideOutcomes) {
    const now = commitmentsFor(forecast, planned);
    const goals = goalChecks(forecast, planned);
    return `<section class="card-section engagements"><div class="panel-heading"><div><h2>${escapeHtml(L("Promises", "Engagements"))}</h2></div></div>
      <div class="engagement-rows">${now.map((c) => {
        const promise = c.goals.map((g) => shortGoal(goals.find((x) => x.id === g.id) || { id: g.id })).join(" · ");
        return `<div class="engagement-row ${hideOutcomes ? "" : c.ok ? "ok" : "ko"}"><span class="engagement-mark" aria-hidden="true">${hideOutcomes ? "○" : c.ok ? "✓" : "✗"}</span><strong>${escapeHtml(stakeholderLabel(c.id))}</strong><span class="engagement-promise">${escapeHtml(promise)}</span><span class="engagement-next">${hideOutcomes ? "" : `→ ${escapeHtml(commitmentConsequence(c.id, c.ok, state, forecast))}`}</span></div>`;
      }).join("")}</div></section>`;
  }

  function renderOverview(planned, forecast) {
    const goals = goalChecks(forecast, planned);
    const passed = goals.filter((goal) => goal.ok).length;
    const carbonDelta = forecast.carbon.total - state.carbonBaseline.total;
    const signals = getBeginnerSignals(forecast, planned);
    const showGuide = (state.year === 1 && !state.uiPreferences.beginnerGuideDismissed) || ui.reopenBeginnerGuide;
    const hideOutcomes = forecastPrecision() === "costs";
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Clinic overview", "Vue d’ensemble de la clinique"))}</h1></div></div>
      ${renderStartBanner()}
      ${showGuide ? `<section class="beginner-guide" aria-labelledby="beginner-guide-title"><div><span>${escapeHtml(L("Year 1 guide", "Guide de l’année 1"))}</span><h2 id="beginner-guide-title">${escapeHtml(L("Your first turn", "Votre premier tour"))}</h2></div><ol><li><strong>${escapeHtml(L("Read the clinic situation", "Comprenez la situation"))}</strong><span>${escapeHtml(L("Start with the signals below.", "Commencez par les signaux ci-dessous."))}</span></li><li><strong>${escapeHtml(L("Choose one priority", "Choisissez une priorité"))}</strong><span>${escapeHtml(L("Open only the area you want to improve.", "Ouvrez uniquement le domaine à améliorer."))}</span></li><li><strong>${escapeHtml(L("Compare before confirming", "Comparez avant de confirmer"))}</strong><span>${escapeHtml(L("Nothing is spent until you add a decision to the plan.", "Rien n’est dépensé avant l’ajout d’une décision au plan."))}</span></li></ol><button class="button secondary" data-dismiss-guide>${escapeHtml(L("Got it", "J’ai compris"))}</button></section>` : ""}
      ${forecastGridNote()}
      ${renderClientFlow(forecast, hideOutcomes)}
      <div class="dashboard-grid compact-three">
        ${metricCard(L("Net result", "Résultat net"), forecastText(forecast.financial.netResult, "money"), forecastText(forecast.financial.margin, "percent"), hideOutcomes ? "" : forecast.financial.netResult >= 0 ? "good" : "bad")}
                ${metricCard(L("Team workload", "Charge de l’équipe"), forecastText(forecast.operational.staffUse, "percent"), "", forecast.operational.staffUse > .94 ? "bad" : "")}
        ${(() => { const goal = goals.find((g) => g.id === "carbon") || { value: .15 }; const base = state.carbonBaseline.perCase || 0; const red = base ? 1 - forecast.carbon.perCase / base : 0; return metricCard(L("Carbon per case", "Carbone par cas"), kilograms(forecast.carbon.perCase), `${red > 0 ? "−" : "+"}${pct(Math.abs(red))} ${L("vs start", "par rapport au départ")} · ${L("target", "objectif")} −${pct(goal.value)}`, hideOutcomes ? "" : red >= goal.value ? "good" : "warn"); })()}
        ${metricCard(L("Staff climate", "Climat de l’équipe"), `${number(state.social.staffClimate)} → ${forecastText(forecast.social.after.staffClimate, "number")}`, L("start → end of year", "début → fin d’année"), hideOutcomes ? "" : forecast.social.after.staffClimate < 50 ? "bad" : forecast.social.after.staffClimate >= 60 ? "good" : "", { drawer: "relations", label: L("Act on this", "Agir là-dessus") })}
        ${metricCard(L("Client trust", "Confiance des clients"), `${number(state.social.clientTrust)} → ${forecastText(forecast.social.after.clientTrust, "number")}`, L("start → end of year", "début → fin d’année"), hideOutcomes ? "" : forecast.social.after.clientTrust < 45 ? "bad" : forecast.social.after.clientTrust >= 65 ? "good" : "", { drawer: "relations", label: L("Act on this", "Agir là-dessus") })}
                              </div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("What needs attention", "Points d’attention"))}</h2></div></div><div class="priority-list">${signals.map((item) => `<article class="signal-${item.status}" data-signal-key="${item.key}"><div><span>${escapeHtml(item.title)}</span><strong>${escapeHtml(item.text)}</strong></div><div class="signal-actions">${signalButton(item.destination, item.action, "primary")}${item.secondary ? signalButton(item.secondary.destination, item.secondary.label, "secondary") : ""}</div></article>`).join("")}</div></section>
      <h2 class="period-label">${escapeHtml(L("Next year", "L’an prochain"))}</h2>
      ${hideOutcomes ? "" : `<div class="dashboard-grid compact-two">${metricCard(L("Client households", "Foyers clients"), `${number(state.clients)} → ${number(forecast.next.clients)}`, forecast.social.refusedLeft ? L(`${number(forecast.social.refusedLeft)} leave after a refusal`, `${number(forecast.social.refusedLeft)} partent après un refus`) : "", forecast.next.clients < state.clients ? "warn" : "")}</div>`}
      ${renderEngagements(forecast, planned, hideOutcomes)}
    </section>`;
  }

  function renderFacilityUse(forecast) {
    const rows = (forecast.operational.facilityRows || []).filter((row) => row.capacity > 0);
    if (!rows.length) return "";
    return `<section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Rooms & equipment use", "Utilisation des salles et équipements"))}</h2><span class="panel-links"><button class="text-button" data-open-drawer="rooms">${escapeHtml(L("Manage rooms", "Gérer les salles"))} ›</button><button class="text-button" data-open-drawer="equipment">${escapeHtml(L("Manage equipment", "Gérer l’équipement"))} ›</button></span><p>${escapeHtml(L("When a room or machine is full, every service using it loses the same share of cases.", "Quand une salle ou un appareil est saturé, chaque service qui l’utilise perd la même part de cas."))}</p></div></div><div class="facility-list">${rows.map((row) => `<article class="${row.rate > .95 ? "full" : ""}"><div class="facility-head"><strong>${escapeHtml(facilityName(row))}</strong><span>${number(row.used)} / ${number(row.capacity)} h · ${pct(row.rate)}</span></div>${meter(row.rate, row.rate > .95 ? "bad" : row.rate > .85 ? "warn" : "good")}<small>${escapeHtml(row.services.length ? row.services.map(serviceName).join(", ") : L("Not used by any open service", "Utilisé par aucun service ouvert"))}</small></article>`).join("")}</div></section>`;
  }

  function renderCare(planned, forecast) {
    const active = D.services.filter((service) => planned.services[service.id].active);
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Care & facilities", "Soins et installations"))}</h1></div></div>
      ${forecastGridNote()}
      <div class="dashboard-grid compact-two">${metricCard(L("Active services", "Services actifs"), number(active.length), `${forecast.operational.readyServices} ${L("ready and staffed", "prêts et dotés en personnel")}`)}${metricCard(L("Cases served", "Cas traités"), forecastText(forecast.operational.totalHonored, "number"), `${forecastText(forecast.operational.honoredRate, "percent")} ${L("of open requests", "des demandes ouvertes")}${offerableRequests(forecast) ? ` · +${number(offerableRequests(forecast))} ${L("for services you could open now", "pour des services ouvrables maintenant")}` : ""}`)}</div>
      ${renderFacilityUse(forecast)}<section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Current services", "Services actuels"))}</h2></div><span class="panel-links"><button class="text-button" data-toggle-closed>${escapeHtml(ui.showClosedServices ? L("Hide closed services", "Masquer les services fermés") : L("Show closed services", "Afficher les services fermés"))}</button><button class="button primary" data-open-drawer="services">${escapeHtml(L("Explore services", "Explorer les services"))}</button></span></div><div class="summary-list">${(ui.showClosedServices ? D.services : active).map((service) => { const row = forecast.serviceResults.find((item) => item.id === service.id); return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong><span>${escapeHtml(serviceStatusLabel(row))}</span></div><span>${row.active ? `${number(row.honored)} / ${number(row.demand)} ${escapeHtml(L("served", "traités"))}${row.rampUp ? ` · ${escapeHtml(L("first year · 60% of demand", "première année · 60 % de la demande"))}` : ""}` : `${number(row.demand)} ${escapeHtml(L("requests if opened", "demandes si ouvert"))}`}</span><em>${row.active ? (stockoutsFor(forecast, service.id) ? `<span class="cause-tag">${escapeHtml(L(`${number(stockoutsFor(forecast, service.id))} stock-outs`, `${number(stockoutsFor(forecast, service.id))} ruptures de stock`))}</span>` : "") : escapeHtml(missingRequirements(service, planned).length ? L("Missing requirements", "Conditions manquantes") : L("Ready to open", "Prêt à ouvrir"))}</em><button class="text-button" data-open-drawer="services" data-service="${service.id}">${escapeHtml(L("Details", "Détails"))} ›</button></article>`; }).join("")}</div></section>

      
    </section>`;
  }

  function renderTeam(planned, forecast) {
    const rows = Object.fromEntries(forecast.operational.staffRows.map((row) => [row.id, row]));
    const openingNames = Object.entries(planned.operations.openingPeriods).filter(([, active]) => active).map(([id]) => itemLabel(D.openingPeriods[id].name));
    const vetHours = forecast.operational.staffRows.filter((row) => row.role === "vet").reduce((sum, row) => sum + row.availableHours, 0);
    const supportHours = forecast.operational.staffRows.filter((row) => row.role === "support").reduce((sum, row) => sum + row.availableHours, 0);
    const unusedHours = forecast.operational.staffRows.reduce((sum, row) => sum + row.unusedHours, 0);
    const signals = [];
    (forecast.resignations || []).forEach((leaver) => signals.push({ icon: "!", text: L(`${leaver.name} is set to resign at year end (${departureText(leaver.reason)}).`, `${leaver.name} va démissionner en fin d’année (${departureText(leaver.reason)}).`) }));
    if (forecast.financial.overtimeHours > 0) signals.push({ icon: "⏱", text: L(`${number(forecast.financial.overtimeHours)} overtime hours forecast: about ${money(forecast.financial.overtimeCost)} extra pay and a lower staff climate.`, `${number(forecast.financial.overtimeHours)} heures supplémentaires prévues : environ ${money(forecast.financial.overtimeCost)} de salaire en plus et un climat d’équipe plus faible.`) });
    const shortage = forecast.operational.serviceHourRows.filter((row) => planned.services[row.serviceId].active && row.shortageHours > 5).sort((a, b) => b.shortageHours - a.shortageHours)[0];
    if (shortage) signals.push({ icon: "!", text: L(`${serviceName(shortage.serviceId)} is short of ${number(shortage.shortageHours)} ${shortage.role === "vet" ? "veterinary" : "support"} hours.`, `${serviceName(shortage.serviceId)} manque de ${number(shortage.shortageHours)} heures ${shortage.role === "vet" ? "vétérinaires" : "de soutien"}.`) });
    const unusedPerson = forecast.operational.staffRows.filter((row) => row.unusedHours > 100).sort((a, b) => b.unusedHours - a.unusedHours)[0];
    if (unusedPerson) signals.push({ icon: "○", text: L(`${planned.staff.find((person) => person.id === unusedPerson.id)?.name} has ${number(unusedPerson.unusedHours)} forecast unused hours.`, `${planned.staff.find((person) => person.id === unusedPerson.id)?.name} a ${number(unusedPerson.unusedHours)} heures inutilisées prévues.`) });
    const blocked = forecast.operational.staffRows.filter((row) => row.blockedHours > 0).sort((a, b) => b.blockedHours - a.blockedHours)[0];
    if (blocked) signals.push({ icon: "△", text: L(`${number(blocked.blockedHours)} hours are blocked until training or another requirement is ready.`, `${number(blocked.blockedHours)} heures sont bloquées jusqu’à ce qu’une formation ou une autre condition soit prête.`) });
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Team & operations", "Équipe et opérations"))}</h1><p>${escapeHtml(L("See the team first; reveal applicants and operational alternatives only when needed.", "Voyez d’abord l’équipe ; affichez les candidats et les options uniquement si nécessaire."))}</p></div><button class="button primary" data-open-drawer="recruitment">${escapeHtml(L("Post a vacancy", "Publier une offre"))}</button></div>
      ${forecastGridNote()}
      <div class="dashboard-grid compact-four">${metricCard(L("Veterinary hours available", "Heures vétérinaires disponibles"), number(vetHours))}${metricCard(L("Support hours available", "Heures de soutien disponibles"), number(supportHours))}${metricCard(L("Team workload", "Charge de l’équipe"), forecastText(forecast.operational.staffUse, "percent"))}${metricCard(L("Paid hours not worked", "Heures payées non travaillées"), number(unusedHours))}</div>
      ${signals.length ? `<section class="hour-signals" aria-label="${escapeHtml(L("Hours needing attention", "Heures à surveiller"))}">${signals.slice(0, 3).map((signal) => `<p><span aria-hidden="true">${signal.icon}</span>${escapeHtml(signal.text)}${signal.tag ? ` <span class="cause-tag">${escapeHtml(signal.tag)}</span>` : ""}</p>`).join("")}</section>` : ""}
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Current team", "Équipe actuelle"))}</h2><span class="panel-links"><button class="text-button" data-open-drawer="capabilities">${escapeHtml(L("Who can do what", "Qui peut faire quoi"))} ›</button><button class="text-button" data-open-drawer="hoursByService">${escapeHtml(L("See hours by service", "Voir les heures par service"))} ›</button></span></div><button class="button secondary" data-open-drawer="training">${escapeHtml(L("Plan training", "Planifier une formation"))}</button><button class="button secondary" data-open-drawer="relations">${escapeHtml(L("Act on climate and trust", "Agir sur le climat et la confiance"))}</button></div>${(() => { const partage = D.services.filter((service) => service.vetShare > 0 && service.supportShare > 0 && planned.services[service.id].active).map((service) => serviceName(service.id)); if (!partage.length) return ""; return `<details class="panel-note note-repliee"><summary>${escapeHtml(L("Cases carried: why they do not add up", "Cas portés : pourquoi ils ne s’additionnent pas"))}</summary>${escapeHtml(L(`A case needing both a vet and a support worker is carried by both: ${partage.join(", ")}. Cases carried do not add up across the team — the clinic treated ${forecastText(forecast.operational.totalHonored, "number")} cases in total.`, `Un cas qui demande à la fois un vétérinaire et du soutien est porté par les deux : ${partage.join(", ")}. Les cas portés ne s’additionnent donc pas d’une personne à l’autre — la clinique traite ${forecastText(forecast.operational.totalHonored, "number")} cas au total.`))}</details>`; })()}<div class="staff-grid">${planned.staff.map((person) => { const row = rows[person.id]; const summary = normalizeAllocations(person).map((allocation) => `${serviceName(allocation.serviceId)} ${Math.round(allocation.share * 100)}%`).join(" · "); return `<article class="staff-card"><div class="staff-head"><div><h3>${escapeHtml(person.name)}</h3><span>${escapeHtml(person.role === "vet" ? L("Veterinarian", "Vétérinaire") : L("Support", "Soutien"))}</span></div><strong class="staff-workload"><small>${escapeHtml(L("workload", "charge"))}</small>${pct(row?.workload || 0)}</strong></div><div class="chips" aria-label="${escapeHtml(L("Skills", "Compétences"))}">${person.skills.length ? person.skills.map((skill) => `<span class="chip">${escapeHtml(skillName(skill))}</span>`).join("") : `<span class="chip">${escapeHtml(L("No specialist skills", "Aucune compétence spécialisée"))}</span>`}</div><p class="allocation-summary">${escapeHtml(summary)}</p>${(() => { const zone = allocationZone(row?.assignedShare ?? 1); const tone = zone.tone === "bad" && (row?.overtimeHours || 0) < 1 ? "warn" : zone.tone; return `<p class="staff-zone ${tone}">${escapeHtml(zone.text)}</p>`; })()}${hourBar(row, forecast)}${(() => { const carried = casesCarried(forecast, person.id); if (carried.total < .5) return ""; return `<div class="staff-hours-line"><span>${escapeHtml(L("Cases carried", "Cas portés"))}</span><strong>${escapeHtml(forecastText(carried.total, "number"))}</strong></div>`; })()}<div class="button-row"><button class="button primary" data-open-drawer="staffAllocation" data-context="${person.id}">${escapeHtml(L("Change time allocation", "Modifier l’affectation du temps"))}</button><button class="button secondary" data-open-drawer="staffPerson" data-context="${person.id}">${escapeHtml(L("Pay", "Salaire"))}</button>${pendingActions().some((action) => (action.payload.kind === "hire" && action.payload.targetId === person.id) || (action.payload.kind === "training" && action.payload.personId === person.id)) ? "" : `<button class="button secondary" data-open-drawer="staffExit" data-context="${person.id}">${escapeHtml(L("Let go", "Se séparer"))}</button>`}</div></article>`; }).join("")}</div></section>
      <section class="card-section"><div class="panel-heading"><h2>${escapeHtml(L("How the clinic operates", "Fonctionnement de la clinique"))}</h2></div><div class="operation-rows">
        <button data-open-drawer="opening"><span>${escapeHtml(L("Opening schedule", "Horaires d’ouverture"))}</span><strong>${escapeHtml(openingNames.join(", ") || L("Standard daytime", "Journée standard"))}</strong><em>›</em></button>
        <button data-open-drawer="dropoff"><span>${escapeHtml(L("Drop-off workflow", "Parcours de dépôt"))}</span><strong>${escapeHtml(planned.operations.dropoff ? L("Enabled", "Activé") : L("Disabled", "Désactivé"))}</strong><em>›</em></button>
        <button data-open-drawer="stock"><span>${escapeHtml(L("Stock strategy", "Stratégie de stock"))}</span><strong>${escapeHtml(itemLabel(D.stockStrategies[planned.operations.stockStrategy].name))}</strong><em>›</em></button>
        <button data-open-drawer="hr"><span>${escapeHtml(L("HR strategy", "Stratégie RH"))}</span><strong>${escapeHtml(itemLabel(D.hrStrategies[planned.hr.strategy].name))}</strong><em>›</em></button>
      </div></section>
    </section>`;
  }

  // Two bars, two quantities, and they must not be read off the same ruler. The assignment bar is
  // drawn on the 0–130% scale, because that is the range a student can choose. The workload bar is
  // drawn on 0–100%, because it reports what was actually worked. Both tones come from here so a
  // state cannot be green on one screen and orange on the other.
  function assignedTone(share) {
    const percent = Math.round(share * 100);
    if (percent > 100) return "bad";
    if (percent === 100) return "good";
    return "warn";
  }

  // Workload 0 used to be painted green: a person who produced nothing looked healthy. Low
  // utilisation is the Monday problem, so it reads as a problem.
  function workloadTone(workload) {
    if (workload > 1.0001) return "bad";
    if (workload >= .85) return "good";
    if (workload >= .5) return "warn";
    return "bad";
  }

  function allocationZone(share) {
    const percent = Math.round(share * 100);
    const tone = assignedTone(share);
    if (percent > 100) return { tone, text: L(`${percent}% assigned`, `${percent} % affectés`) };
    if (percent < 100) return { tone, text: L(`${percent}% assigned · ${100 - percent}% idle but paid`, `${percent} % affectés · ${100 - percent} % inoccupés mais payés`) };
    return { tone, text: L("100% assigned", "100 % affectés") };
  }

  function roleLabel(role) {
    return role === "vet" ? L("Veterinarian", "Vétérinaire") : L("Support", "Soutien");
  }

  function renderCapabilitiesDrawer(planned) {
    const services = D.services.slice().sort((a, b) => Number(planned.services[b.id].active) - Number(planned.services[a.id].active) || a.priority - b.priority);
    const cell = (person, service) => {
      const share = normalizeAllocations(person).find((row) => row.serviceId === service.id)?.share || 0;
      const assigned = share ? `<small>${escapeHtml(L("Assigned", "Affecté"))} ${Math.round(share * 100)}%</small>` : "";
      if (!roleCompatible(person, service)) return `<td class="cap-none"><span title="${escapeHtml(L("This service needs no work from this role", "Ce service ne demande pas de travail de cette fonction"))}">— ${escapeHtml(L("Not this role", "Pas cette fonction"))}</span></td>`;
      if (personQualified(person, service)) return `<td class="cap-yes">✓ ${escapeHtml(L("Can do", "Peut le faire"))}${vetCoversSupport(person, service) ? `<small>${escapeHtml(L("support tasks at vet cost", "tâches de soutien au coût vétérinaire"))}</small>` : ""}${assigned}</td>`;
      const skill = (person.role === "vet" ? service.vetSkills : service.supportSkills).find((id) => !person.skills.includes(id));
      return `<td class="cap-train"><button class="text-button" data-open-drawer="person" data-context="${escapeHtml(person.id)}" data-tab="training">△ ${escapeHtml(L("Train", "Former"))}: ${escapeHtml(skillName(skill))}</button>${assigned}</td>`;
    };
    const facilityNote = (service) => missingRequirements(service, planned).filter((reason) => !reason.type.includes("Skill")).map((reason) => blockerText(reason)).join(" · ");
    return `<details class="note-repliee"><summary>${escapeHtml(L("How qualifications work", "Comment lire ce tableau"))}</summary><p>${escapeHtml(L("Each service needs work from a veterinarian, support staff, or both, and sometimes a specific skill. Allocate people only where they show ✓; △ hours stay blocked until that person is trained. Vets can also cover support tasks, but their hours cost more.", "Chaque service demande du travail vétérinaire, de soutien, ou les deux, et parfois une compétence précise. Affectez les personnes là où elles ont ✓ ; les heures △ restent bloquées jusqu’à la formation de cette personne. Les vétérinaires peuvent aussi assurer les tâches de soutien, mais leurs heures coûtent plus cher."))}</p></details><p class="cap-legend"><span class="cap-yes">✓ ${escapeHtml(L("qualified now", "qualifié maintenant"))}</span><span class="cap-train">△ ${escapeHtml(L("needs training", "formation nécessaire"))}</span><span class="cap-none">— ${escapeHtml(L("role not used by this service", "fonction non utilisée par ce service"))}</span></p><div class="table-scroll"><table class="capability-table"><thead><tr><th scope="col">${escapeHtml(L("Service", "Service"))}</th>${planned.staff.map((person) => `<th scope="col">${escapeHtml(person.name)}<small>${escapeHtml(roleLabel(person.role))}</small></th>`).join("")}</tr></thead><tbody>${services.map((service) => { const note = facilityNote(service); return `<tr><th scope="row">${escapeHtml(serviceName(service.id))}<small>${escapeHtml(planned.services[service.id].active ? L("Open", "Ouvert") : L("Closed", "Fermé"))}${note ? ` · ${escapeHtml(note)}` : ""}</small></th>${planned.staff.map((person) => cell(person, service)).join("")}</tr>`; }).join("")}</tbody></table></div>`;
  }

  function renderTrainingDrawer(planned, embedded = false) {
    const person = planned.staff.find((item) => item.id === ui.drawerContext);
    if (!person) return `<p>${escapeHtml(L("Training is given to one person at a time. Choose who to train.", "La formation concerne une personne à la fois. Choisissez qui former."))}</p><div class="drawer-menu">${planned.staff.map((item) => `<button data-drawer-context="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(roleLabel(item.role))} · ${escapeHtml(item.skills.map(skillName).join(", ") || L("No specialist skills", "Aucune compétence spécialisée"))}</span><em>›</em></button>`).join("")}</div>`;
    const options = focusFirst(Object.entries(D.trainings).filter(([, training]) => training.role === person.role));
    return `${embedded ? "" : `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Choose another person", "Choisir une autre personne"))}</button>`}<p>${escapeHtml(L(`Training takes hours from ${person.name} only, this year only.`, `La formation prend des heures à ${person.name} uniquement, cette année seulement.`))}</p><div class="drawer-cards">${options.map(([id, training]) => { const has = person.skills.includes(id); const unlocks = D.services.filter((service) => (person.role === "vet" ? service.vetSkills : service.supportSkills).includes(id)).map((service) => serviceName(service.id)).join(", "); const key = `training:${id}:${person.id}`; const payload = { kind: "training", targetId: id, personId: person.id }; return `<article${targetCard(id)}><h3>${escapeHtml(itemLabel(training.name))}</h3><p>${money(training.cost)} ${escapeHtml(L("once", "une fois"))} · ${number(training.hours)} ${escapeHtml(L("training hours", "heures de formation"))}</p><small>${escapeHtml(L("Unlocks", "Débloque"))}: ${escapeHtml(unlocks)}</small>${has ? `<strong>✓ ${escapeHtml(L("Already has this skill", "Possède déjà cette compétence"))}</strong>` : `${consequencePreview(key, payload)}${reviewButton(key, payload)}`}</article>`; }).join("")}</div>`;
  }

  function allocationDraftFor(person) {
    if (!ui.allocationDrafts[person.id]) ui.allocationDrafts[person.id] = clone(normalizeAllocations(person));
    return ui.allocationDrafts[person.id];
  }

  // The hours a person actually has this year, under the plan as it stands. Every control that
  // writes a share converts through this one number, so hours typed, hours stepped and hours shown
  // are the same hours.
  function availableHoursFor(personId) {
    return simulatePlan(pendingActions()).operational.staffRows.find((row) => row.id === personId)?.availableHours || 0;
  }

  function allocationDraftForecast(personId, allocations) {
    const key = `staff-allocation:${personId}`;
    const actions = pendingActions().filter((action) => action.key !== key);
    const clinic = clone(state);
    const effects = emptyEffects();
    actions.forEach((action) => combineEffects(effects, applyAction(clinic, action, true)));
    const before = simulateYear(clone(clinic), state, effects, actions);
    const person = clinic.staff.find((item) => item.id === personId);
    if (person) person.allocations = clone(allocations);
    const after = simulateYear(clinic, state, effects, actions);
    return { before, after };
  }

  // Tells the student whether hours on this service will actually be used.
  function allocationRowNote(person, service, report, planned) {
    if (!planned.services[service.id].active) return `<small class="bad-text">△ ${escapeHtml(L("Service closed — these hours produce nothing until it opens.", "Service fermé — ces heures ne produisent rien tant qu’il n’est pas ouvert."))}</small>`;
    const row = report.operational.serviceHourRows.find((item) => item.serviceId === service.id && item.role === person.role);
    const parts = [];
    const cap = (report.serviceResults || []).find((r) => r.id === service.id)?.bottleneck || {};
    const capTag = "";
    if (row) {
      parts.push(L(`needs ${number(row.neededHours)} h`, `demande ${number(row.neededHours)} h`));
      if (row.shortageHours > 1 && !capTag) parts.push(L(`${number(row.shortageHours)} h short`, `${number(row.shortageHours)} h manquantes`));
      // Qui fournit le reste : sans cela on sait qu'il manque des heures sans savoir à qui les prendre.
      const others = report.operational.staffRows.filter((item) => item.role === person.role && item.id !== person.id)
        .map((item) => ({ item, hours: item.assignments.filter((assignment) => assignment.serviceId === service.id).reduce((sum, assignment) => sum + assignment.effectiveHours, 0) }))
        .filter((entry) => entry.hours > 1);
      if (others.length) parts.push(L(`also on this service: ${others.map((entry) => `${planned.staff.find((item) => item.id === entry.item.id)?.name || entry.item.id} ${number(entry.hours)} h`).join(", ")}`, `aussi sur ce service : ${others.map((entry) => `${planned.staff.find((item) => item.id === entry.item.id)?.name || entry.item.id} ${number(entry.hours)} h`).join(", ")}`));
      const carried = casesCarriedFor(report, person.id, service.id);
      if (carried >= .5) parts.push(L(`these hours carry ${number(carried)} cases`, `ces heures portent ${number(carried)} cas`));
    }
    if (vetCoversSupport(person, service)) {
      const supportStaff = planned.staff.filter((item) => item.role === "support");
      const supportRate = supportStaff.length ? supportStaff.reduce((sum, item) => sum + item.salary / item.capacity, 0) / supportStaff.length : 20;
      parts.push(L(`covering support work at vet cost (${money(person.salary / person.capacity)}/h vs about ${money(supportRate)}/h for support staff)`, `tâches de soutien au coût vétérinaire (${money(person.salary / person.capacity)}/h contre environ ${money(supportRate)}/h pour le soutien)`));
    }
    return parts.length || capTag ? `<small>${escapeHtml(parts.join(" · "))}</small>${capTag}` : "";
  }

  // These four cells read from the DRAFT, not from the saved allocation: they used to show the same
  // figures whatever the student was dragging, and contradicted the workload line three rows below.
  // `unused` is derived from available hours alone — the model's own unusedHours falls back to
  // assigned hours above 100%, which made the cells stop adding up. The invariant held here is
  // available + overtime = used + unused + blocked, at every share including 130%.
  // Un cas n'appartient à personne. Une chirurgie consomme une durée vétérinaire entière ET une
  // durée de soutien entière : le même cas est porté par deux personnes, et additionner les deux
  // côtés le compterait deux fois. Ces nombres répondent à « combien de cas les heures de cette
  // personne ont-elles portés », à l'intérieur d'un rôle — jamais à « combien de cas sont les siens ».
  // Les cas honorés du service se répartissent au prorata des heures réellement utilisées, ce qui
  // reste juste même quand un vétérinaire couvre du travail de soutien faute de personnel.
  function casesCarried(report, personId) {
    const row = report.operational.staffRows.find((item) => item.id === personId);
    if (!row) return { lines: [], total: 0, shared: false };
    const poolUsed = {};
    report.operational.staffRows.forEach((other) => {
      if (other.role !== row.role) return;
      other.assignments.forEach((assignment) => { poolUsed[assignment.serviceId] = (poolUsed[assignment.serviceId] || 0) + assignment.usedHours; });
    });
    let shared = false;
    const lines = row.assignments.map((assignment) => {
      const result = report.serviceResults.find((item) => item.id === assignment.serviceId);
      const pool = poolUsed[assignment.serviceId] || 0;
      const cases = result && pool > 0 ? result.honored * assignment.usedHours / pool : 0;
      const service = SERVICE_BY_ID[assignment.serviceId];
      if (cases >= .5 && service.vetShare > 0 && service.supportShare > 0) shared = true;
      return { serviceId: assignment.serviceId, hours: assignment.usedHours, cases, serviceHonored: result?.honored || 0 };
    }).filter((line) => line.cases >= .5);
    return { lines, total: lines.reduce((sum, line) => sum + line.cases, 0), shared };
  }

  function casesCarriedFor(report, personId, serviceId) {
    return casesCarried(report, personId).lines.find((line) => line.serviceId === serviceId)?.cases || 0;
  }

  // Cinq réglages prélèvent des heures de soutien avant toute affectation. Leur total arrivait
  // sur la fiche sous le nom « autres tâches », sans cause et sans chemin vers le réglage.
  // Where each reservation is set, and what to call it. The hours come from the model.
  const RESERVATION_ROUTES = {
    stock: { drawer: "stock", label: () => L("Stock strategy", "Stratégie de stock") },
    geomarketing: { drawer: "marketing", label: () => L("Market study", "Étude de marché") },
    waste: { drawer: "sustainability", label: () => L("Waste strategy", "Gestion des déchets") },
    accessPlan: { drawer: "sustainability", label: () => L("Access plan", "Offre d’accès") },
    planned: { drawer: "plan", label: () => L("Decisions already in the plan", "Décisions déjà au plan") }
  };

  function supportReservations(row) {
    return (row?.nonClinicalParts || []).filter((part) => part.hours >= .5).map((part) => ({
      hours: part.hours,
      label: (RESERVATION_ROUTES[part.id] || { label: () => part.id }).label(),
      drawer: (RESERVATION_ROUTES[part.id] || { drawer: "plan" }).drawer
    }));
  }

  function reservationNote(person, planned, row) {
    if (person.role !== "support" || !(row?.nonClinicalHours > 1)) return "";
    const items = supportReservations(row);
    if (!items.length) return "";
    return `<p class="reservation-note"><strong>${escapeHtml(L(`The ${number(row.nonClinicalHours)} h of other duties are taken by:`, `Les ${number(row.nonClinicalHours)} h d’autres tâches sont prises par :`))}</strong> ${items.map((item) => `<button class="text-button" data-open-drawer="${item.drawer}">${escapeHtml(`${item.label} · ${number(item.hours)} h`)} ›</button>`).join(" ")}</p>`;
  }

  // The figures the student reads, in whole hours, from the model and nowhere else. Rounding each
  // one on its own broke the column by an hour — 900 used and 522 unused against 1 421 available —
  // so the last figure is taken as the remainder of the others. It is the same subtraction the
  // model does, performed after rounding instead of before, and a guard holds it to within an hour
  // of the model's own value.
  function displayedHours(row) {
    const available = Math.round(row?.availableHours || 0);
    const used = Math.round(row?.usedHours || 0);
    const overtime = Math.round(row?.overtimeHours || 0);
    return { available, used, overtime, unused: Math.max(0, available + overtime - used), blocked: Math.round(row?.blockedHours || 0) };
  }

  // A fresh clinic starts with its support person fully assigned to services that are not open, and
  // the drawer's own headline called that "100% assigned" while the workload underneath read 0%.
  // The situation is the Monday lesson and stays; what changes is that the drawer says so first,
  // instead of leaving a student to infer it from a row note further down.
  function closedHoursWarning(person, clinic, availableHours) {
    const closed = closedAssignments(person, clinic);
    if (!closed.length) return "";
    const hours = Number(availableHours || 0);
    const names = closed.map((item) => serviceName(item.serviceId)).join(", ");
    const share = closed.reduce((sum, item) => sum + item.share, 0);
    return `<p class="callout closed-hours">△ ${escapeHtml(L(`${number(Math.round(hours * share))} h of ${person.name}'s time is assigned to services that are not open (${names}). Those hours are paid and produce nothing until you open the service or move the hours.`, `${number(Math.round(hours * share))} h du temps de ${person.name} sont affectées à des services qui ne sont pas ouverts (${names}). Ces heures sont payées et ne produisent rien tant que le service n’est pas ouvert ou que les heures ne sont pas déplacées.`))}</p>`;
  }

  function renderAllocationDrawer(planned, forecast) {
    const person = planned.staff.find((item) => item.id === ui.drawerContext);
    if (!person) return "";
    const draft = allocationDraftFor(person);
    const total = draft.reduce((sum, row) => sum + row.share, 0);
    const valid = validAllocations(person, draft.filter((row) => row.share > 0));
    const comparison = allocationDraftForecast(person.id, draft);
    const currentRow = comparison.before.operational.staffRows.find((row) => row.id === person.id);
    const draftRow = comparison.after.operational.staffRows.find((row) => row.id === person.id);
    const chosen = new Set(draft.map((row) => row.serviceId));
    const compatible = D.services.filter((service) => roleCompatible(person, service) && !chosen.has(service.id));
    const ordered = compatible.slice().sort((a, b) => Number(planned.services[b.id].active) - Number(planned.services[a.id].active) || Number(personQualified(person, b)) - Number(personQualified(person, a)));
    const optionGroup = (label, services) => services.length ? `<optgroup label="${escapeHtml(label)}">${services.map((service) => `<option value="${service.id}">${escapeHtml(serviceName(service.id))}</option>`).join("")}</optgroup>` : "";
    const activeOptions = ordered.filter((service) => planned.services[service.id].active && personQualified(person, service));
    const otherOptions = ordered.filter((service) => !planned.services[service.id].active && personQualified(person, service));
    const trainingOptions = ordered.filter((service) => !personQualified(person, service));
    const serviceDeltas = comparison.after.serviceResults.map((after) => ({ id: after.id, cases: after.honored - comparison.before.serviceResults.find((row) => row.id === after.id).honored })).filter((row) => row.cases).sort((a, b) => Math.abs(b.cases) - Math.abs(a.cases)).slice(0, 3);
    const blockerMap = new Map();
    draft.forEach((allocation) => missingRequirements(SERVICE_BY_ID[allocation.serviceId], planned).forEach((reason) => blockerMap.set(`${allocation.serviceId}:${reason.type}:${reason.id || ""}`, { serviceId: allocation.serviceId, reason })));
    const remainingBlockers = [...blockerMap.values()].slice(0, 3);
    const percent = Math.round(total * 100);
    // These are the hours the rows print, and the total prints their sum: a student who adds the
    // column gets the figure on the total line.
    const availableHours = currentRow?.availableHours || 0;
    const rowHours = draft.map((allocation) => Math.round(availableHours * allocation.share));
    const totalHours = rowHours.reduce((sum, value) => sum + value, 0);
    const draftOvertimeCost = (draftRow?.overtimePay || 0) * (1 + D.financeModel.socialChargeRate);
    const draftHours = displayedHours(draftRow);
    const draftBlocked = draftHours.blocked;
    const draftUsed = draftHours.used;
    const draftUnused = draftHours.unused;
    const meterText = percent === 0 ? L("0% assigned — give this person at least one service", "0 % affectés — donnez au moins un service à cette personne")
      : draftBlocked >= 1 && draftUsed < 1 ? L(`${percent}% assigned, but all ${number(draftBlocked)} h are blocked until training — no cases can be handled`, `${percent} % affectés, mais les ${number(draftBlocked)} h sont bloquées jusqu’à la formation — aucun cas ne peut être traité`)
      : draftBlocked >= 1 ? L(`${percent}% assigned · ${number(draftBlocked)} h blocked until training`, `${percent} % affectés · ${number(draftBlocked)} h bloquées jusqu’à la formation`)
      : percent > 100 ? L(`${percent}% assigned, maximum ${Math.round(D.staffModel.maxAllocation * 100)}% · overtime forecast: ${number(draftRow?.overtimeHours || 0)} h ≈ ${money(draftOvertimeCost)}`, `${percent} % affectés, maximum ${Math.round(D.staffModel.maxAllocation * 100)} % · heures supplémentaires prévues : ${number(draftRow?.overtimeHours || 0)} h ≈ ${money(draftOvertimeCost)}`)
      : draftUnused >= 1 ? L(`${percent}% assigned · ${number(draftUnused)} h paid and unused`, `${percent} % affectés · ${number(draftUnused)} h payées sans emploi`)
      : L("100% assigned — fully booked, no overtime", "100 % affectés — temps plein, sans heures supplémentaires");
    const zoneClass = !valid ? "warn" : (draftRow?.overtimeHours || 0) >= 1 ? "overtime" : total > 1.0001 ? "idle" : { good: "ready", warn: "idle", bad: "overtime" }[assignedTone(total)];
    const hoursFlow = currentRow ? L(`${number(currentRow.contractedHours)} contracted − ${number(currentRow.expectedAbsenceHours)} expected absence${absenceNote(currentRow)} − ${number(currentRow.trainingHours)} training${currentRow.onboardingHours > 1 ? ` − ${number(currentRow.onboardingHours)} onboarding` : ""} −${number(currentRow.nonClinicalHours)} other duties = ${number(currentRow.availableHours)} available hours`, `${number(currentRow.contractedHours)} contractuelles − ${number(currentRow.expectedAbsenceHours)} d’absence prévue${absenceNote(currentRow)} − ${number(currentRow.trainingHours)} de formation${currentRow.onboardingHours > 1 ? ` − ${number(currentRow.onboardingHours)} d’intégration` : ""} −${number(currentRow.nonClinicalHours)} d’autres tâches = ${number(currentRow.availableHours)} heures disponibles`) : "";
    return `<div class="allocation-editor">${closedHoursWarning(person, planned, currentRow?.availableHours)}<details class="note-repliee regle-affectation" data-pli="regleOpen" ${ui.regleOpen ? "open" : ""}><summary>${escapeHtml(L("How the percentages work", "Comment fonctionnent les pourcentages"))}</summary><p>${escapeHtml(L(`Up to 100%, changing percentages moves existing hours; it does not create new hours. Above 100% is paid overtime (${D.staffModel.overtimePremium}× pay, maximum ${Math.round(D.staffModel.maxAllocation * 100)}%) and lowers staff climate. Below 100% is paid idle time.`, `Jusqu’à 100 %, modifier les pourcentages déplace des heures existantes ; cela ne crée pas de nouvelles heures. Au-delà de 100 %, ce sont des heures supplémentaires payées (${String(D.staffModel.overtimePremium).replace(".", ",")}× le salaire, ${Math.round(D.staffModel.maxAllocation * 100)} % maximum) qui dégradent le climat d’équipe. En dessous, le temps payé reste inoccupé.`))}</p></details>${hoursFlow ? `<p class="hours-flow">${escapeHtml(hoursFlow)}</p>` : ""}${reservationNote(person, planned, currentRow)}<div class="allocation-total marque-cent ${zoneClass}"><strong>${escapeHtml(meterText)}</strong><span class="total-heures">${escapeHtml(L(`${number(totalHours)} h assigned of ${number(availableHours)} h available`, `${number(totalHours)} h affectées sur ${number(availableHours)} h disponibles`))}</span>${hourBar(draftRow, comparison.after)}<p class="draft-delta">${[[L("Cases served", "Cas traités"), comparison.before.operational.totalHonored, comparison.after.operational.totalHonored, "number"], [L("Net result", "Résultat net"), comparison.before.financial.netResult, comparison.after.financial.netResult, "money"]].map(([label, b, a, type]) => `<span>${escapeHtml(label)} <strong class="${Math.round(a - b) > 0 ? "good-text" : Math.round(a - b) < 0 ? "bad-text" : ""}">${escapeHtml(forecastText(a - b, type, { signed: true }))}</strong></span>`).join("")}</p></div><div class="allocation-rows">${draft.map((allocation, index) => { const service = SERVICE_BY_ID[allocation.serviceId]; const qualified = personQualified(person, service); const hours = rowHours[index]; return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong>${qualified ? "" : `<span class="qualification-warning">△ ${escapeHtml(L("Needs training", "Formation nécessaire"))}</span>`}${qualified ? "" : `<small>${number(hours)} ${escapeHtml(L("hours blocked until training", "heures bloquées jusqu’à la formation"))}</small>`}${allocationRowNote(person, service, comparison.after, planned)}${allocationRemainder(draft, index) > 0 ? `<button class="text-button" data-allocation-fill="${index}">${escapeHtml(L(`Use remaining ${number((currentRow?.availableHours || 0) * allocationRemainder(draft, index))} h`, `Utiliser les ${number((currentRow?.availableHours || 0) * allocationRemainder(draft, index))} h restantes`))}</button>` : ""}</div><div class="stepper" role="group" aria-label="${escapeHtml(serviceName(service.id))}"><button data-allocation-adjust="-5" data-allocation-index="${index}" aria-label="${escapeHtml(L(`Reduce by ${number(availableHours * .05)} hours`, `Réduire de ${number(availableHours * .05)} heures`))}">−</button><span class="pas-heures"><input type="text" inputmode="numeric" autocomplete="off" value="${hours}" data-allocation-hours="${index}" aria-label="${escapeHtml(L(`Hours on ${serviceName(service.id)}`, `Heures sur ${serviceName(service.id)}`))}"><em>h</em></span><button data-allocation-adjust="5" data-allocation-index="${index}" ${total >= D.staffModel.maxAllocation - .0001 ? "disabled" : ""} aria-label="${escapeHtml(L(`Add ${number(availableHours * .05)} hours`, `Ajouter ${number(availableHours * .05)} heures`))}">+</button><button class="remove-allocation" data-remove-allocation="${index}" aria-label="${escapeHtml(L("Remove service", "Retirer le service"))}">×</button></div></article>`; }).join("")}</div>${ordered.length ? `<div class="add-allocation"><label><span>${escapeHtml(L("Add another service", "Ajouter un autre service"))}</span><select data-allocation-service>${optionGroup(L("Active and planned services", "Services actifs et planifiés"), activeOptions)}${optionGroup(L("Other services", "Autres services"), otherOptions)}${optionGroup(L("Needs training", "Formation nécessaire"), trainingOptions)}</select></label><button class="button secondary" data-add-allocation>${escapeHtml(L("Add at 0%", "Ajouter à 0 %"))}</button></div>` : ""}${remainingBlockers.length ? `<div class="requirement-list"><strong>${escapeHtml(L("Other blockers still apply", "D’autres blocages restent à résoudre"))}</strong>${remainingBlockers.map((item) => `<div><span>△ ${escapeHtml(serviceName(item.serviceId))}: ${escapeHtml(blockerText(item.reason))}</span></div>`).join("")}</div>` : ""}<section class="allocation-impact"><h3>${escapeHtml(L("Live impact", "Impact en direct"))}</h3><div class="comparison-list"><div><strong>${escapeHtml(L("This person’s workload", "Charge de cette personne"))}</strong><span>${pct(currentRow?.workload || 0)}</span><em>→ ${pct(draftRow?.workload || 0)}</em></div><div><strong>${escapeHtml(L("Cases this person carries", "Cas portés par cette personne"))}</strong><span>${escapeHtml(forecastText(casesCarried(comparison.before, person.id).total, "number"))}</span><em>→ ${escapeHtml(forecastText(casesCarried(comparison.after, person.id).total, "number"))}</em></div><div><strong>${escapeHtml(L("Team workload", "Charge de l’équipe"))}</strong><span>${escapeHtml(forecastText(comparison.before.operational.staffUse, "percent"))}</span><em>→ ${escapeHtml(forecastText(comparison.after.operational.staffUse, "percent"))}</em></div><div><strong>${escapeHtml(L("Cases served", "Cas traités"))}</strong><span>${escapeHtml(forecastText(comparison.before.operational.totalHonored, "number"))}</span><em>→ ${escapeHtml(forecastText(comparison.after.operational.totalHonored, "number"))}</em></div><div><strong>${escapeHtml(L("Net result", "Résultat net"))}</strong><span>${escapeHtml(forecastText(comparison.before.financial.netResult, "money"))}</span><em>→ ${escapeHtml(forecastText(comparison.after.financial.netResult, "money"))}</em></div>${comparison.before.financial.overtimeCost >= 1 || comparison.after.financial.overtimeCost >= 1 ? `<div><strong>${escapeHtml(L("Overtime cost", "Coût des heures supplémentaires"))}</strong><span>${money(comparison.before.financial.overtimeCost)}</span><em>→ ${money(comparison.after.financial.overtimeCost)}</em></div>` : ""}<div><strong>${escapeHtml(L("Staff climate", "Climat de l’équipe"))}</strong><span>${escapeHtml(forecastText(comparison.before.social.after.staffClimate, "number"))}</span><em>→ ${escapeHtml(forecastText(comparison.after.social.after.staffClimate, "number"))}</em></div><div><strong>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</strong><span>${escapeHtml(forecastText(comparison.before.carbon.total, "carbon"))}</span><em>→ ${escapeHtml(forecastText(comparison.after.carbon.total, "carbon"))}</em></div></div>${serviceDeltas.length ? `<ul>${serviceDeltas.map((row) => `<li><strong>${escapeHtml(serviceName(row.id))}:</strong> ${escapeHtml(row.cases > 0 ? L(`${row.cases} additional cases possible`, `${row.cases} cas supplémentaires possibles`) : L(`${Math.abs(row.cases)} fewer cases possible`, `${Math.abs(row.cases)} cas possibles en moins`))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No change in cases served with this draft.", "Aucun changement des cas traités avec ce brouillon."))}</p>`}</section><button class="button primary" data-review-allocation="${person.id}" ${valid ? "" : "disabled"}>${escapeHtml(L("Review allocation", "Examiner l’affectation"))}</button></div>`;
  }

  function renderHoursByService(forecast) {
    const rows = forecast.operational.serviceHourRows.filter((row) => state.services[row.serviceId]?.active || row.assignedHours > 0);
    return `<p>${escapeHtml(L("Hours assigned to a service remain there even when another room, skill, or equipment requirement blocks care.", "Les heures affectées à un service y restent même si une salle, une compétence ou un équipement bloque les soins."))}</p><div class="hours-table" role="table"><div role="row"><strong>${escapeHtml(L("Service", "Service"))}</strong><strong>${escapeHtml(L("Role", "Fonction"))}</strong><strong>${escapeHtml(L("Assigned", "Affectées"))}</strong><strong>${escapeHtml(L("Needed", "Nécessaires"))}</strong><strong>${escapeHtml(L("Worked", "Travaillées"))}</strong><strong>${escapeHtml(L("Balance", "Solde"))}</strong></div>${rows.map((row) => `<div role="row"><span>${escapeHtml(serviceName(row.serviceId))}</span><span>${escapeHtml(row.role === "vet" ? L("Vet", "Vét.") : L("Support", "Soutien"))}</span><span>${number(row.assignedHours)}</span><span>${number(row.neededHours)}</span><span>${number(row.usedHours)}</span><strong class="${row.shortageHours > 0 ? "bad-text" : "good-text"}">${row.shortageHours > 0 ? `−${number(row.shortageHours)}` : `+${number(row.surplusHours)}`}</strong></div>`).join("")}</div>`;
  }

  // Chaque rapport porte deja, par service, les cas honores, les recettes, les couts variables et
  // la marge par cas. Rien ne les montrait. La marge par heure se divise par UNE ressource —
  // jamais par la somme : une promotion a classe l'echographie a 89 €/h au lieu de 138 en
  // additionnant les heures veterinaires et de soutien.
  // Rounds a column so that it still adds up to its own rounded total: the leftover euro goes to
  // the largest figure, where it is least visible. A table a student is asked to add up has to add
  // up — rounding each cell on its own left the services at 32 721 € against a total of 32 720 €.
  function roundToTotal(values, total) {
    const rounded = values.map((value) => Math.round(value));
    const residual = Math.round(total) - rounded.reduce((sum, value) => sum + value, 0);
    if (residual && rounded.length) {
      let index = 0;
      rounded.forEach((value, position) => { if (Math.abs(value) > Math.abs(rounded[index])) index = position; });
      rounded[index] += residual;
    }
    return rounded;
  }

  function renderServiceLedger() {
    const latest = state.history.at(-1);
    if (!latest) return `<p>${escapeHtml(L("No completed year yet.", "Aucune année terminée."))}</p>`;
    const lignes = (latest.serviceResults || []).filter((row) => row.active && row.honored > 0);
    if (!lignes.length) return `<p>${escapeHtml(L("No service treated a case this year.", "Aucun service n’a traité de cas cette année."))}</p>`;
    const totalRecettes = lignes.reduce((sum, row) => sum + row.revenue, 0);
    const totalVariables = lignes.reduce((sum, row) => sum + row.variableCosts, 0);
    const totalCas = lignes.reduce((sum, row) => sum + row.honored, 0);
    const ecartStock = latest.financial.variableCosts - totalVariables;
    const montreStock = Math.abs(ecartStock) > 1;
    const recettesAffichees = roundToTotal(lignes.map((row) => row.revenue), totalRecettes);
    // The stock adjustment is one of the figures in the column, so it takes the rounding with the
    // rest and the column still ends on the clinic's own total.
    const variablesAffichees = roundToTotal([...lignes.map((row) => row.variableCosts), ...(montreStock ? [ecartStock] : [])], latest.financial.variableCosts);
    const cellule = (row, index) => {
      const vet = row.vetDuration > 0 ? money(row.contributionPerCase / row.vetDuration) : "—";
      const sout = row.supportDuration > 0 ? money(row.contributionPerCase / row.supportDuration) : "—";
      return `<div role="row"><span>${escapeHtml(serviceName(row.id))}</span><span>${number(row.honored)}</span><span>${money(recettesAffichees[index])}</span><span>${money(variablesAffichees[index])}</span><span>${money(row.contributionPerCase)}</span><span>${escapeHtml(vet)}</span><span>${escapeHtml(sout)}</span></div>`;
    };
    return `<p>${escapeHtml(L("Year", "Année"))} ${latest.turn}. ${escapeHtml(L("Margin per hour divides by one resource at a time — never by the two added together, which are not interchangeable.", "La marge par heure se divise par une seule ressource à la fois — jamais par les deux additionnées, qui ne sont pas interchangeables."))}</p>
      <div class="hours-table ledger" role="table">
        <div role="row"><strong>${escapeHtml(L("Service", "Service"))}</strong><strong>${escapeHtml(t("common.cases"))}</strong><strong>${escapeHtml(t("forecast.revenue"))}</strong><strong>${escapeHtml(L("Variable costs", "Coûts variables"))}</strong><strong>${escapeHtml(L("Margin / case", "Marge / cas"))}</strong><strong>${escapeHtml(L(`${currencySymbol()} / vet hour`, `${currencySymbol()} / h vét.`))}</strong><strong>${escapeHtml(L(`${currencySymbol()} / support hour`, `${currencySymbol()} / h soutien`))}</strong></div>
        ${lignes.map(cellule).join("")}
        ${montreStock ? `<div role="row" class="ajustement"><span>${escapeHtml(L("Stock strategy, applied to the whole", "Stratégie de stock, appliquée à l’ensemble"))}</span><span>—</span><span>—</span><span>${money(variablesAffichees[variablesAffichees.length - 1])}</span><span>—</span><span>—</span><span>—</span></div>` : ""}
        <div role="row" class="total"><strong>${escapeHtml(L("Total", "Total"))}</strong><strong>${number(totalCas)}</strong><strong>${money(totalRecettes)}</strong><strong>${money(latest.financial.variableCosts)}</strong><strong>${money(totalCas ? (totalRecettes - latest.financial.variableCosts) / totalCas : 0)}</strong><strong>—</strong><strong>—</strong></div>
      </div>`;
  }

  function renderExportDrawer() {
    return `<p>${escapeHtml(L("Enter your team code, then choose a readable report or the full analysis file.", "Saisissez votre code d’équipe, puis choisissez un rapport lisible ou le fichier d’analyse complet."))}</p><div class="form-stack"><label><span>${escapeHtml(L("Team code", "Code d’équipe"))}</span><input type="text" maxlength="24" value="${escapeHtml(state.playerTeam.teamCode || "")}" data-team-code placeholder="${escapeHtml(L("For example G-07", "Par exemple G-07"))}"><small>${escapeHtml(L("Use the code your instructor gives you, not names.", "Utilisez le code donné par votre enseignant, pas des noms."))}</small></label></div><div class="export-choices sauvegarde"><article><h3>${escapeHtml(L("Save this clinic", "Enregistrer cette clinique"))}</h3><p>${escapeHtml(L("A file that restores the clinic exactly — to carry it to another computer, or to come back to it later. It is not the analytical file.", "Un fichier qui restaure la clinique à l’identique — pour l’emporter sur un autre ordinateur, ou y revenir plus tard. Ce n’est pas le fichier d’analyse."))}</p><button class="button primary" data-sauver-clinique>${escapeHtml(L("Save the clinic", "Enregistrer la clinique"))}</button></article><article><h3>${escapeHtml(L("Load a clinic", "Charger une clinique"))}</h3><p>${escapeHtml(L("Replaces the clinic in this browser. Save the current one first if you want to keep it.", "Remplace la clinique de ce navigateur. Enregistrez l’actuelle d’abord si vous voulez la garder."))}</p><label class="bouton-fichier"><input type="file" accept="application/json,.json" data-charger-clinique><span class="button secondary">${escapeHtml(L("Choose a save file", "Choisir une sauvegarde"))}</span></label></article></div><div class="export-choices"><article><h3>${escapeHtml(L("Printable report", "Rapport imprimable"))}</h3><p>${escapeHtml(L("A detailed report for every completed year, including actions, hours, carbon results, and the team’s written reflections.", "Un rapport détaillé pour chaque année terminée, avec les actions, les heures, les résultats carbone et les réflexions écrites de l’équipe."))}</p><button class="button primary" data-print-report>${escapeHtml(L("Print / Save as PDF", "Imprimer / Enregistrer en PDF"))}</button></article><article><h3>${escapeHtml(L("Analytical data", "Données analytiques"))}</h3><p>${escapeHtml(L("The complete structured clinic state and reports for further analysis.", "L’état complet et structuré de la clinique et les rapports pour une analyse ultérieure."))}</p><button class="button secondary" data-download-json>${escapeHtml(L("Download analytical JSON", "Télécharger le JSON analytique"))}</button></article></div>`;
  }

  // Variable costs are the one cost that moves with how many animals you treat. The note is the
  // point of the card: not the euro total, but the fact that it rises when the clinic does more.
  function variableCostNote(forecast) {
    const served = forecast.operational.totalHonored;
    const revenue = forecast.financial.revenue;
    const parts = [];
    if (served > 0) parts.push(L(`≈ ${money(forecast.financial.variableCosts / served)} per case treated`, `≈ ${money(forecast.financial.variableCosts / served)} par cas traité`));
    if (revenue > 0) parts.push(L(`${pct(forecast.financial.variableCosts / revenue)} of revenue`, `${pct(forecast.financial.variableCosts / revenue)} des recettes`));
    return parts.join(" · ");
  }

  // Overtime sits in neither the variable nor the fixed bucket, so `total − variable` is fixed costs
  // plus overtime. It is zero in almost every game; disclosing it only when it exists keeps the
  // subtraction honest exactly when it would otherwise be wrong, and silent the rest of the time.
  function overtimeNote(forecast) {
    const overtime = forecast.financial.overtimeCost || 0;
    if (overtime < 1) return "";
    return L(`incl. ${money(overtime)} of overtime`, `dont ${money(overtime)} d’heures supplémentaires`);
  }

  // Your price against the price your clients accept (or the range the clinic knows it to be in):
  // the band is the uncertainty, the shaded zone is above it.
  function priceScale(price, known) {
    const top = Math.max(price, known.high) * 1.25 || 1;
    const x = (v) => `${(v / top * 100).toFixed(1)}%`;
    const state = price > known.high + .5 ? "over" : price > known.low + .5 ? "maybe" : "";
    return `<div class="price-scale" role="img" aria-label="${escapeHtml(L(`Your price ${money(price)}, accepted ${acceptedText(known)}`, `Votre prix ${money(price)}, accepté ${acceptedText(known)}`))}"><span class="ps-over" style="left:${x(known.high)}"></span>${known.exact ? "" : `<span class="ps-band" style="left:${x(known.low)};width:${((known.high - known.low) / top * 100).toFixed(1)}%"></span>`}<i class="ps-accepted" style="left:${x(known.exact ? known.low : known.high)}"></i><b class="ps-price ${state}" style="left:${x(price)}"><em>${money(price)}</em></b></div>`;
  }

  // Where the year's money goes. Two bars on one scale: what came in (revenue), and under it what it
  // paid for — variable costs, fixed costs, tax — and what is left. A loss is the cost bar running
  // past the revenue bar. A bracket marks the margin, the part of revenue left to cover fixed costs.
  function moneyBar(run) {
    const f = run.financial;
    const revenue = f.revenue + (f.grant || 0);
    const variable = f.variableCosts;
    const fixed = f.totalCosts - f.variableCosts;
    const tax = Math.max(0, revenue - f.totalCosts - f.netResult);
    const result = f.netResult;
    const scale = Math.max(revenue, variable + fixed + tax, 1);
    const pctOf = (v) => Math.max(0, v) / scale * 100;
    const seg = (cls, v, label, extra = "") => v >= .5 ? `<span class="mb-seg ${cls} ${pctOf(v) < 16 ? "narrow" : ""}" style="width:${pctOf(v).toFixed(2)}%" title="${escapeHtml(`${label} ${money(v)}`)}"><em>${escapeHtml(label)}<b>${money(v)}</b>${extra}</em></span>` : "";
    const margin = revenue - variable;
    const narrow = [["mb-var", L("Variable costs", "Coûts variables"), variable], ["mb-fixed", L("Fixed costs", "Coûts fixes"), fixed], ["mb-tax", L("Tax", "Impôt"), tax], ["mb-result", L("Net result", "Résultat net"), Math.max(0, result)]].filter(([, , v]) => v >= .5 && pctOf(v) < 16);
    const aria = `${L("Revenue", "Recettes")} ${money(revenue)}. ${L("Variable costs", "Coûts variables")} ${money(variable)}, ${L("Fixed costs", "Coûts fixes")} ${money(fixed)}, ${L("Tax", "Impôt")} ${money(tax)}, ${result >= 0 ? L("Net result", "Résultat net") : L("Loss", "Perte")} ${money(result)}. ${L("Contribution margin", "Marge sur coûts variables")} ${money(margin)}.`;
    return `<section class="card-section money-bar" role="img" aria-label="${escapeHtml(aria)}">
      <div class="mb-row"><span class="mb-label">${escapeHtml(L("Revenue", "Recettes"))}</span><div class="mb-track">${seg("mb-rev", revenue, L("Revenue", "Recettes"))}</div></div>
      <div class="mb-row"><span class="mb-label">${escapeHtml(L("Where it goes", "Où elle va"))}</span><div class="mb-track">${seg("mb-var", variable, L("Variable costs", "Coûts variables"))}${seg("mb-fixed", fixed, L("Fixed costs", "Coûts fixes"))}${seg("mb-tax", tax, L("Tax", "Impôt"))}${result > 0 ? seg("mb-result", result, L("Net result", "Résultat net")) : ""}${result < 0 ? `<i class="mb-loss" style="left:${pctOf(revenue).toFixed(2)}%;width:${pctOf(-result).toFixed(2)}%"><em>${escapeHtml(L("Loss", "Perte"))} ${money(result)}</em></i>` : ""}</div></div>
      <div class="mb-row"><span class="mb-label"></span><div class="mb-track mb-bracket-track"><i class="mb-bracket" style="left:${pctOf(variable).toFixed(2)}%;width:${pctOf(Math.max(0, margin)).toFixed(2)}%"><em>${escapeHtml(L("Contribution margin", "Marge sur coûts variables"))} <b>${money(margin)}</b></em></i></div></div>
      <ul class="hb-legend">${narrow.map(([cls, label, v]) => `<li><b class="${cls}"></b>${escapeHtml(label)} <strong>${money(v)}</strong></li>`).join("")}<li>${escapeHtml(L("Total costs", "Coûts totaux"))} <strong>${money(f.totalCosts)}</strong></li>${f.variableCosts > 0 ? `<li><small>${escapeHtml(L("Variable costs", "Coûts variables"))} : ${escapeHtml(variableCostNote(run))}</small></li>` : ""}${overtimeNote(run) ? `<li><small>${escapeHtml(L("Fixed costs", "Coûts fixes"))} : ${escapeHtml(overtimeNote(run))}</small></li>` : ""}</ul>
    </section>`;
  }

  function renderBusiness(planned, forecast) {
    const location = D.locations[planned.location.sectorId];
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Business", "Gestion"))}</h1><p>${escapeHtml(L("Prices, financing, market position, and location—opened one decision at a time.", "Prix, financement, marché et implantation — une décision à la fois."))}</p></div></div>
      ${forecastGridNote()}
      ${forecastPrecision() === "costs" ? "" : moneyBar(forecast)}<div class="dashboard-grid compact-two">${metricCard(L("Net result", "Résultat net"), forecastText(forecast.financial.netResult, "money"), forecastText(forecast.financial.margin, "percent"), forecast.financial.netResult >= 0 ? "good" : "bad")}${metricCard(L("End treasury", "Trésorerie finale"), forecastText(forecast.financial.treasury, "money"))}</div>
      <section class="card-section action-menu"><button data-open-drawer="pricing"><span>${escapeHtml(L("Service prices", "Prix des services"))}</span><strong>${escapeHtml(L(`Your clients: ${itemLabel(D.segments[planned.marketFocus].name)} · accepted prices and sensitivity`, `Vos clients : ${itemLabel(D.segments[planned.marketFocus].name)} · prix acceptés et sensibilité`))}</strong><em>›</em></button><button data-open-drawer="finance"><span>${escapeHtml(L("Financing", "Financement"))}</span><strong>${escapeHtml(planned.finance.loan ? money(planned.finance.loan.remaining) : L("No outstanding loan", "Aucun emprunt"))}</strong><em>›</em></button><button data-open-drawer="market"><span>${escapeHtml(L("Market focus", "Marché cible"))}</span><strong>${escapeHtml(itemLabel(D.segments[planned.marketFocus].name))}</strong><em>›</em></button><button data-open-drawer="location"><span>${escapeHtml(L("Location and parking", "Implantation et parking"))}</span><strong>${escapeHtml(itemLabel(location.name))}</strong><em>›</em></button><button data-open-drawer="marketing"><span>${escapeHtml(L("Communication and market study", "Communication et étude de marché"))}</span><strong>${escapeHtml(`${itemLabel(D.marketingStrategies.communication[planned.marketing.communication]?.name || { en: "", fr: "" })} · ${itemLabel((D.marketingStrategies.geomarketing[planned.marketing.geomarketing] || D.marketingStrategies.geomarketing.none).name)}`)}</strong><em>›</em></button></section>
    </section>`;
  }

  function renderSustainability(planned, forecast) {
    const baseline = state.carbonBaseline;
    const delta = forecast.carbon.total - baseline.total;
    const reduction = baseline.perCase ? 1 - forecast.carbon.perCase / baseline.perCase : 0;
    const carbonGoal = goalChecks(forecast, planned).find((g) => g.id === "carbon") || { value: .15 };
    const sources = ["building", "clinical", "waste", "travel"];
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Sustainability", "Durabilité"))}</h1><p>${escapeHtml(L("Choose a source, see the trade-off, and decide whether it fits the clinic.", "Choisissez une source, observez le compromis et décidez s’il convient à la clinique."))}</p></div></div>
      ${forecastGridNote()}
      <div class="dashboard-grid compact-two">${metricCard(L("Carbon footprint", "Empreinte carbone"), forecastText(forecast.carbon.total, "carbon"), `${forecastText(delta, "carbon", { signed: true })} ${L("vs start", "par rapport au départ")}`, delta <= 0 ? "good" : "warn")}${metricCard(L("Largest source", "Source principale"), sourceLabel(forecast.carbon.primaryDrivers[0]), tonnes(forecast.carbon.bySource[forecast.carbon.primaryDrivers[0]]))}</div>
      ${(() => {
        const volumeMin = Math.ceil((baseline.totalCases || 0) * .8);
        const perCaseOk = reduction >= carbonGoal.value;
        const volumeOk = forecast.operational.totalHonored >= volumeMin;
        const invests = investsInSustainability(planned);
        const needs = D.commitmentModel?.grantNeedsInvestment;
        const kept = commitmentsFor(forecast, planned).find((c) => c.id === "commune")?.ok;
        const row = (ok, label, detail) => `<li class="${ok ? "ok" : "ko"}"><span aria-hidden="true">${ok ? "✓" : "✗"}</span><strong>${escapeHtml(label)}</strong><span>${detail}</span></li>`;
        return `<section class="card-section promise-check"><h2>${escapeHtml(kept ? L("Promise to the municipality: kept", "Promesse à la commune : tenue") : L("Promise to the municipality: not kept", "Promesse à la commune : non tenue"))}</h2><ul>
          ${row(perCaseOk, L("Carbon per case", "Carbone par cas"), escapeHtml(`${kilograms(forecast.carbon.perCase)} · ${reduction > 0 ? "−" : "+"}${pct(Math.abs(reduction))} ${L("vs start", "par rapport au départ")} · ${L("target", "objectif")} −${pct(carbonGoal.value)}`))}
          ${row(volumeOk, L("Volume kept", "Volume gardé"), escapeHtml(`${number(forecast.operational.totalHonored)} ${L("cases", "cas")} · ${L("minimum", "minimum")} ${number(volumeMin)} (${L("80% of the start", "80 % du départ")})`))}
          ${needs ? row(invests, L("A sustainability measure", "Une mesure de durabilité"), invests ? escapeHtml(L("in the plan", "dans le plan")) : `${escapeHtml(L("none", "aucune"))} · <a href="#sources-empreinte">${escapeHtml(L("choose one from a source below", "en choisir une parmi les sources ci-dessous"))}</a>`) : ""}
        </ul><p class="promise-next">→ ${escapeHtml(commitmentConsequence("commune", kept, state, forecast))} ${escapeHtml(L("next year", "l’an prochain"))}</p></section>`;
      })()}
      <section class="card-section" id="sources-empreinte"><div class="panel-heading"><div><h2>${escapeHtml(L("Where the footprint comes from", "Origine de l’empreinte"))}</h2><p>${escapeHtml(L("Select one source to see only the relevant choices.", "Sélectionnez une source pour ne voir que les choix pertinents."))}</p></div></div><div class="source-list">${sources.map((id) => { const value = forecast.carbon.bySource[id]; const share = forecast.carbon.total ? value / forecast.carbon.total : 0; return `<article><div><strong>${escapeHtml(sourceLabel(id))}</strong><span>${tonnes(value)} · ${pct(share)}</span></div>${meter(share, id === forecast.carbon.primaryDrivers[0] ? "warn" : "good")}<button class="button secondary" data-open-drawer="sustainability" data-context="${id}">${escapeHtml(L("See options", "Voir les options"))}</button></article>`; }).join("")}</div></section>
      <details class="card-section methodology"><summary>${escapeHtml(L("How is this calculated?", "Comment ce calcul est-il réalisé ?"))}</summary><p>${escapeHtml(L("The model combines building electricity and heating, volatile anaesthetic, waste treatment, and client travel. Official conversion factors are kept separate from the clinic activity assumptions used to make the simulation playable.", "Le modèle combine l’électricité et le chauffage du bâtiment, l’anesthésique volatil, le traitement des déchets et les déplacements des clients. Les facteurs de conversion officiels sont séparés des hypothèses d’activité qui rendent la simulation jouable."))}</p><dl><div><dt>${escapeHtml(L("Model version", "Version du modèle"))}</dt><dd>${escapeHtml(D.carbonModel.version)}</dd></div>${Object.values(D.carbonModel.factorRegistry).map((factor) => `<div><dt>${escapeHtml(itemLabel(factor.detail))}</dt><dd>${preciseNumber(factor.value)} ${escapeHtml(factor.unit)} · ${escapeHtml(String(factor.year))}<br>${escapeHtml(factor.source)}</dd></div>`).join("")}<div><dt>${escapeHtml(L("Simulation assumptions", "Hypothèses de simulation"))}</dt><dd>${escapeHtml(L("Energy and waste per service, building demand, room demand, client-trip patterns, and selected treatment routes.", "Énergie et déchets par service, besoins du bâtiment et des salles, déplacements des clients et filières de traitement retenues."))}</dd></div><div><dt>${escapeHtml(L("Not included", "Non inclus"))}</dt><dd>${escapeHtml(L("Medicines and other supply chains, staff commuting, equipment manufacture, construction, and refrigerants.", "Médicaments et autres chaînes d’approvisionnement, trajets du personnel, fabrication des équipements, construction et fluides frigorigènes."))}</dd></div></dl><p class="source-links"><a href="https://vetsustain.org/resources/the-veterinary-carbon-calculator-getting-started" target="_blank" rel="noreferrer">Vet Sustain</a><a href="https://www.eea.europa.eu/en/analysis/indicators/greenhouse-gas-emission-intensity-of-1-1751032678/greenhouse-gas-emission-intensity-of-electricity-generation-country-level" target="_blank" rel="noreferrer">EEA</a><a href="https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025" target="_blank" rel="noreferrer">UK 2025 factors</a><a href="https://www.gov.uk/guidance/fluorinated-gases-f-gases" target="_blank" rel="noreferrer">UK F-gas table</a><a href="https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=d27da7db-5c2c-4b9f-bf14-a4d18d3e6d4e" target="_blank" rel="noreferrer">DailyMed</a><a href="https://www.england.nhs.uk/long-read/nhs-clinical-waste-strategy/" target="_blank" rel="noreferrer">NHS clinical waste</a><a href="https://ghgprotocol.org/corporate-standard-frequently-asked-questions" target="_blank" rel="noreferrer">GHG Protocol</a></p></details>
    </section>`;
  }

  // A missing skill is only actionable once a person is chosen, so the link carries the person too:
  // one click should land on the thing you are about to buy, not on a list to scroll through.
  function trainee(reason, clinic) {
    const training = D.trainings[reason.id];
    if (!reason.type.includes("Skill") || !training) return "";
    const person = clinic.staff.find((item) => item.role === training.role && !(item.skills || []).includes(reason.id));
    return person ? ` data-context="${escapeHtml(person.id)}"` : "";
  }

  // The item you came to buy goes first and is marked, so "Agir" lands on it instead of on the top
  // of a list you then have to scan. Everything else keeps its order.
  function focusFirst(entries) {
    if (!ui.focusItem) return entries;
    const wanted = entries.filter(([id]) => id === ui.focusItem);
    return wanted.length ? [...wanted, ...entries.filter(([id]) => id !== ui.focusItem)] : entries;
  }

  function targetCard(id) {
    return id === ui.focusItem ? ' data-target-card class="choice-card is-target"' : ' class="choice-card"';
  }

  function requirementList(service, clinic) {
    const missing = missingRequirements(service, clinic);
    if (!missing.length) return `<p class="ready-note">✓ ${escapeHtml(L("All requirements are ready.", "Toutes les conditions sont réunies."))}</p>`;
    const target = (reason) => reason.type === "missingRoom" ? "rooms" : reason.type === "missingEquipment" ? "equipment" : reason.type === "opening" ? "opening" : reason.type.includes("Skill") ? "training" : "services";
    return `<div class="requirement-list"><strong>${escapeHtml(L("Missing requirements", "Conditions manquantes"))}</strong>${missing.map((reason) => `<div><span>○ ${escapeHtml(blockerText(reason))}</span><button class="text-button" data-open-drawer="${target(reason)}" data-focus="${escapeHtml(reason.id || "")}"${trainee(reason, clinic)}>${escapeHtml(L("Address this", "Agir"))} ›</button></div>`).join("")}</div>`;
  }

  function renderConfirmation() {
    const { key, payload } = ui.confirm;
    return `<div class="drawer-confirm"><button class="text-button" data-cancel-review>‹ ${escapeHtml(L("Back to choices", "Retour aux choix"))}</button><p class="eyebrow">${escapeHtml(L("Review before planning", "Vérifier avant de planifier"))}</p><h2 id="drawer-title">${escapeHtml(actionLabel(payload))}</h2><p>${escapeHtml(L("This will use one action. The forecast below compares the plan immediately before and after this decision.", "Cette décision utilisera une action. La prévision compare le plan juste avant et juste après cette décision."))}</p>${consequencePreview(key, payload)}<div class="button-row"><button class="button primary" data-confirm-review>${escapeHtml(L("Add to plan", "Ajouter au plan"))}</button><button class="button secondary" data-cancel-review>${escapeHtml(t("app.cancel"))}</button></div></div>`;
  }

  function renderRecruitmentDrawer(planned) {
    if (ui.drawerStep === 1) {
      const roleSkills = {
        vet: ["general", "ultrasound", "dentistry", "orthopedics"],
        support: ["preventive", "surgery", "lab", "imaging", "emergency", "inpatient", "pharmacy", "animalCare"]
      };
      const requirementType = ui.vacancy.role === "vet" ? "missingVetSkill" : "missingSupportSkill";
      const suggested = new Set(D.services.filter((service) => planned.services[service.id].active).flatMap((service) => missingRequirements(service, planned).filter((reason) => reason.type === requirementType).map((reason) => reason.id)));
      const skills = roleSkills[ui.vacancy.role].slice().sort((a, b) => Number(suggested.has(b)) - Number(suggested.has(a)));
      return `<p>${escapeHtml(L("Describe the need before seeing applicants.", "Décrivez le besoin avant de voir les candidats."))}</p><div class="form-stack"><label><span>${escapeHtml(L("Role", "Fonction"))}</span><select data-vacancy-role><option value="vet" ${ui.vacancy.role === "vet" ? "selected" : ""}>${escapeHtml(L("Veterinarian", "Vétérinaire"))}</option><option value="support" ${ui.vacancy.role === "support" ? "selected" : ""}>${escapeHtml(L("Support staff", "Personnel de soutien"))}</option></select></label><fieldset><legend>${escapeHtml(L("Desired skills (maximum two)", "Compétences recherchées (deux maximum)"))}</legend><div class="check-grid">${skills.map((id) => `<label class="${suggested.has(id) ? "suggested-skill" : ""}"><input type="checkbox" data-vacancy-skill="${id}" ${ui.vacancy.skills.includes(id) ? "checked" : ""}><span>${escapeHtml(skillName(id))}${suggested.has(id) ? `<small>${escapeHtml(L("Suggested: needed by a blocked service", "Suggérée : nécessaire à un service bloqué"))}</small>` : ""}</span></label>`).join("")}</div></fieldset><label><span>${escapeHtml(L("Maximum annual salary", "Salaire annuel maximal"))}</span><input type="number" min="25000" max="120000" step="500" value="${ui.vacancy.budget}" data-vacancy-budget></label><button class="button primary" data-view-applicants>${escapeHtml(L("View applicants", "Voir les candidatures"))}</button></div>`;
    }
    const applicants = D.candidates.filter((candidate) => candidate.role === ui.vacancy.role && candidate.expectedSalary <= ui.vacancy.budget && ui.vacancy.skills.every((skill) => candidate.skills.includes(skill)));
      return `<button class="text-button" data-edit-vacancy>‹ ${escapeHtml(L("Revise vacancy", "Modifier l’offre"))}</button><p>${escapeHtml(L("Applicants are shown only after the role, skills, and budget are defined.", "Les candidats apparaissent uniquement après la définition du poste, des compétences et du budget."))}</p>${applicants.length ? `<div class="candidate-list">${applicants.slice(0, ui.candidateLimit).map((candidate) => { const hired = planned.staff.some((person) => person.id === candidate.id); const blockedUntil = Number(planned.rehireBlocked?.[candidate.id] || 0); const blocked = blockedUntil > state.year; const offer = ui.decisionDrafts[`offer:${candidate.id}`] ?? candidate.expectedSalary; return `<article class="choice-card"><h3>${escapeHtml(candidate.name)}</h3><div class="chips">${candidate.skills.map((skill) => `<span class="chip">${escapeHtml(skillName(skill))}</span>`).join("")}</div><p>${escapeHtml(itemLabel(candidate.pitch))}</p><small>${escapeHtml(L("Expected salary", "Salaire attendu"))}: ${money(candidate.expectedSalary)} · ${money(candidate.postingFee)} ${escapeHtml(L("posting fee", "de frais de publication"))}</small><label><span>${escapeHtml(L("Your offer", "Votre offre"))}</span><input type="number" min="${candidate.expectedSalary}" max="${Math.round(candidate.expectedSalary * 1.3)}" step="500" value="${offer}" data-applicant-offer="${candidate.id}" data-draft-key="offer:${candidate.id}"></label><button class="button primary" data-review-hire="${candidate.id}" ${hired || blocked ? "disabled" : ""}>${escapeHtml(hired ? L("Already on staff", "Déjà dans l’équipe") : blocked ? L(`Can’t be rehired before Year ${blockedUntil}`, `Réembauche impossible avant l’année ${blockedUntil}`) : L("Review offer", "Examiner l’offre"))}</button></article>`; }).join("")}</div>${applicants.length > ui.candidateLimit ? `<button class="button secondary" data-more-applicants>${escapeHtml(L("Show more applicants", "Afficher plus de candidats"))}</button>` : ""}` : `<div class="empty-state"><strong>${escapeHtml(L("No applicant matches this vacancy.", "Aucun candidat ne correspond à cette offre."))}</strong><p>${escapeHtml(L("Increase the budget or revise the requested skills. No action or fee has been created.", "Augmentez le budget ou modifiez les compétences demandées. Aucune action ni aucun frais n’a été créé."))}</p></div>`}`;
  }

  function renderStaffPersonDrawer(planned) {
    const person = planned.staff.find((item) => item.id === ui.drawerContext);
    if (!person) return "";
    const draft = ui.decisionDrafts[`salary:${person.id}`] ?? person.salary;
    return `<div class="staff-editor"><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(L("Salary changes payroll, available work hours, and staff climate. Time allocation is managed separately.", "Le salaire modifie la masse salariale, les heures de travail disponibles et le climat de l’équipe. L’affectation du temps se gère séparément."))}</p><div class="form-stack"><label><span>${escapeHtml(L("Annual salary", "Salaire annuel"))}</span><input type="number" min="${Math.round(person.baseSalary * .8)}" max="${Math.round(person.baseSalary * 1.3)}" step="500" value="${draft}" data-draft-salary data-draft-key="salary:${person.id}"></label><small>${escapeHtml(L("Benchmark salary", "Salaire de référence"))}: ${money(person.baseSalary)}</small><button class="button primary" data-review-salary="${person.id}">${escapeHtml(L("Review salary change", "Examiner le changement de salaire"))}</button></div></div>`;
  }

  // Every service on one screen, grouped by family; the chosen one expands in place.
  function renderServiceDrawer(planned, forecast) {
    const groups = [
      ["core", L("Core care", "Soins essentiels"), ["consult", "vaccination", "preventive", "emergency"]],
      ["diagnostics", L("Diagnostics & imaging", "Diagnostic et imagerie"), ["lab", "ultrasound", "radiography"]],
      ["surgery", L("Surgery & dentistry", "Chirurgie et dentisterie"), ["surgery", "dentistry", "orthopedic"]],
      ["hospital", L("Hospital care", "Soins hospitaliers"), ["hospital"]],
      ["commercial", L("Pharmacy, retail & boarding", "Pharmacie, vente et pension"), ["pharmacy", "retail", "boarding"]]
    ];
    const order = groups.flatMap(([, , ids]) => ids);
    const selectedId = order.includes(ui.selectedServiceId) ? ui.selectedServiceId : null;
    return `<p>${escapeHtml(L("Select one service to see its requirements and consequences.", "Sélectionnez un service pour voir ses conditions et ses conséquences."))}</p><div class="service-list">${groups.map(([id, label, ids]) => `<section class="service-family" data-family="${id}"><h3>${escapeHtml(label)} <small>${escapeHtml(plural(ids.length, L("service", "service"), L("services", "services")))}</small></h3>${ids.map((serviceId) => { const row = forecast.serviceResults.find((item) => item.id === serviceId); const [tone, chip] = serviceChip(row); const open = serviceId === selectedId; return `<button class="service-row ${open ? "open" : ""}" data-select-service="${serviceId}" aria-expanded="${open}"><strong>${escapeHtml(serviceName(serviceId))}</strong><em class="status-word ${tone}">${escapeHtml(chip)}</em><span>${escapeHtml(plural(row.demand, L("request", "demande"), L("requests", "demandes")))}</span><span>${money(planned.services[serviceId].price)}</span><em aria-hidden="true">${open ? "▾" : "›"}</em></button>${open ? renderServiceDetail(planned, forecast, serviceId, order) : ""}`; }).join("")}</section>`).join("")}</div>`;
  }

  function renderServiceDetail(planned, forecast, selectedId, order) {
    const service = SERVICE_BY_ID[selectedId];
    const row = forecast.serviceResults.find((item) => item.id === selectedId);
    const active = planned.services[selectedId].active;
    const payload = { kind: "toggle-service", targetId: selectedId, value: !active };
    const next = order[(order.indexOf(selectedId) + 1) % order.length];
    return `<article class="selected-service"><div class="card-status"><h3>${escapeHtml(serviceName(selectedId))}</h3><span>${escapeHtml(active ? L("Open", "Ouvert") : L("Closed", "Fermé"))}</span></div><div class="service-stats"><div><span>${escapeHtml(L("Expected requests", "Demandes prévues"))}</span><strong>${number(row.demand)}</strong></div><div><span>${escapeHtml(L("Current price", "Prix actuel"))}</span><strong>${money(planned.services[selectedId].price)}</strong><button class="text-button" data-open-drawer="pricing">${escapeHtml(L("Change prices", "Modifier les prix"))} ›</button></div><div><span>${escapeHtml(L("Money left after direct supplies", "Argent restant après les fournitures directes"))}</span><strong>${money(row.contributionPerCase)} · ${escapeHtml(L(`supplies ${pct(service.variableCost)}`, `fournitures ${pct(service.variableCost)}`))}</strong></div>${(() => { const v = vetDuration(service, planned), su = supportDuration(service, planned), tot = v + su || 1; return `<div class="case-split"><span>${escapeHtml(L("One case", "Un cas"))}</span><div class="cs-track">${v > 0 ? `<i class="cs-vet" style="width:${(v / tot * 100).toFixed(1)}%"></i>` : ""}${su > 0 ? `<i class="cs-support" style="width:${(su / tot * 100).toFixed(1)}%"></i>` : ""}</div><ul class="hb-legend"><li><b class="cs-vet"></b>${escapeHtml(L("Vet time per case", "Temps vétérinaire par cas"))} <strong>${decimal(v, 2)} h</strong></li><li><b class="cs-support"></b>${escapeHtml(L("Support time per case", "Temps de soutien par cas"))} <strong>${decimal(su, 2)} h</strong></li>${su > 0 ? `<li><small>${escapeHtml(L(`a vet can do the whole case: ${decimal(v + su, 2)} h of vet time`, `un vétérinaire peut faire tout le cas : ${decimal(v + su, 2)} h de temps vétérinaire`))}</small></li>` : ""}</ul></div>`; })()}${service.roomIds.length ? `<div><span>${escapeHtml(L("Room time per case", "Temps de salle par cas"))}</span><strong>${decimal(caseDuration(service, planned), 2)} h · ${escapeHtml(service.roomIds.map((id) => itemLabel(D.rooms[id].name)).join(", "))}</strong></div>` : ""}${row.returnVisits > 0 ? `<div><span>${escapeHtml(L("Return visits from rushed care", "Retours de visites pressées"))}</span><strong>${number(row.returnVisits)} ${escapeHtml(L("cases, unpaid", "cas, non payés"))}</strong></div>` : ""}</div><p class="service-time-note">${escapeHtml(L("Each case uses both at the same time. A vet can cover the support part; support staff cannot cover the vet part. Room time is how long the case occupies its room, whoever treats it.", "Chaque cas consomme les deux en même temps. Un vétérinaire peut assurer la partie soutien ; le personnel de soutien ne peut pas assurer la partie vétérinaire. Le temps de salle est la durée pendant laquelle le cas occupe sa salle, quelle que soit la personne qui le traite."))}</p>${(() => { const staffers = planned.staff.filter((person) => roleCompatible(person, service)); const text = staffers.length ? staffers.map((person) => `${person.name} (${roleLabel(person.role).toLowerCase()}${personQualified(person, service) ? "" : `, ${L("needs training", "formation nécessaire")}`})`).join(", ") : L("Nobody on the current team", "Personne dans l’équipe actuelle"); return `<p class="who-can"><strong>${escapeHtml(L("Who can staff this", "Qui peut assurer ce service"))}:</strong> ${escapeHtml(text)}</p>`; })()}${requirementList(service, planned)}${consequencePreview(`service:${selectedId}:active`, payload)}${reviewButton(`service:${selectedId}:active`, payload, active ? L("Close service", "Fermer le service") : L("Open service", "Ouvrir le service"))}${renderPaceOptions(service, planned)}<button class="text-button next-service" data-select-service="${next}">${escapeHtml(L(`Next service: ${serviceName(next)}`, `Service suivant : ${serviceName(next)}`))} ›</button></article>`;
  }

  function renderPaceOptions(service, planned) {
    const current = planned.services[service.id].pace || "standard";
    const active = planned.services[service.id].active;
    return `<section class="pace-options"><h4>${escapeHtml(L("Pace: time per appointment", "Rythme : temps par rendez-vous"))}</h4>${active ? "" : `<p class="disabled-note">${escapeHtml(L("Open the service first — pace has no effect while it is closed.", "Ouvrez d’abord le service — le rythme n’a aucun effet tant qu’il est fermé."))}</p>`}${Object.entries(D.servicePaces).map(([id, pace]) => `<article class="${id === current ? "current" : ""}"><div><strong>${escapeHtml(itemLabel(pace.name))} · ${decimal(service.duration * pace.duration, 1)} h</strong><p>${escapeHtml(itemLabel(pace.note))}</p></div>${id === current ? `<span class="status-word good">${escapeHtml(t("common.current"))}</span>` : active ? reviewButton(`service:${service.id}:pace`, { kind: "service-pace", targetId: service.id, value: id }, L("Use this pace", "Adopter ce rythme")) : ""}</article>`).join("")}</section>`;
  }

  function renderDrawerBody(planned, forecast) {
    if (ui.confirm) return renderConfirmation();
    if (ui.drawer === "recruitment") return renderRecruitmentDrawer(planned);
    if (ui.drawer === "plan") {
      const rows = planRows(simulatePlan([]), forecast);
      return `<div class="mobile-plan-details"><div class="comparison-list">${rows.map(([key, base, plan, type, outcome]) => `<div><strong>${escapeHtml(planRowLabel(key))}</strong><span>${escapeHtml(planValue(type, outcome, base))}</span><em>→ ${escapeHtml(planValue(type, outcome, plan))}</em></div>`).join("")}</div><div class="plan-actions">${pendingActions().length ? pendingActions().map((action) => `<div class="plan-action"><span>${escapeHtml(actionLabel(action.payload))}</span><button data-remove-action="${escapeHtml(action.key)}" aria-label="${escapeHtml(t("common.remove"))}">×</button></div>`).join("") : `<p class="empty">${escapeHtml(t("forecast.noActions"))}</p>`}</div><button class="button primary pass-button" data-pass-year>${escapeHtml(t("app.pass"))}</button></div>`;
    }
    if (ui.drawer === "person") return renderPersonDrawer(planned, forecast);
    if (ui.drawer === "setup") return renderSetupDrawer();
    if (ui.drawer === "staffPerson") return renderStaffPersonDrawer(planned);
    if (ui.drawer === "staffExit") return renderStaffExitDrawer(planned, forecast);
    if (ui.drawer === "staffAllocation") return renderAllocationDrawer(planned, forecast);
    if (ui.drawer === "hoursByService") return renderHoursByService(forecast);
    if (ui.drawer === "serviceLedger") return renderServiceLedger();
    if (ui.drawer === "capabilities") return renderCapabilitiesDrawer(planned);
    if (ui.drawer === "export") return renderExportDrawer();
    if (ui.drawer === "services") return renderServiceDrawer(planned, forecast);
    if (ui.drawer === "rooms") return `<div class="drawer-cards">${focusFirst(Object.entries(D.rooms)).map(([id, room]) => { const qty = planned.rooms[id]; const add = { kind: "room-add", targetId: id }; return `<article${targetCard(id)}><h3>${escapeHtml(itemLabel(room.name))} <span class="badge">${qty ? L(`${qty} in use`, `${qty} en service`) : L("none", "aucune")}</span></h3><p>${money(room.fitout)} ${escapeHtml(L("once", "une fois"))} · ${money(room.annualRent)}/${escapeHtml(L("year", "an"))}</p>${consequencePreview(`room:${id}`, add)}<div class="button-row">${reviewButton(`room:${id}`, add, L("Fit out a room", "Aménager une salle"))}${qty > room.baseIncluded ? reviewButton(`room:${id}`, { kind: "room-close", targetId: id }, L("Close a room", "Fermer une salle")) : ""}</div></article>`; }).join("")}</div>`;
    if (ui.drawer === "equipment") return `<div class="drawer-cards">${focusFirst(Object.entries(D.equipment)).map(([id, item]) => { const counts = planned.equipment[id]; const buy = { kind: "equipment-acquire", targetId: id, mode: "buy" }; const lease = { kind: "equipment-acquire", targetId: id, mode: "lease" }; return `<article${targetCard(id)}><h3>${escapeHtml(itemLabel(item.name))}</h3><p>${escapeHtml(L("Owned", "Acheté"))}: ${counts.owned} · ${escapeHtml(L("Leased", "Loué"))}: ${counts.leased}</p>${compareOptions([{ label: L("Buy", "Acheter"), key: `equipment:${id}:buy`, payload: buy, button: L("Buy", "Acheter") }, { label: L("Lease", "Louer"), key: `equipment:${id}:lease`, payload: lease, button: L("Lease", "Louer") }])}${needsTags(noEffectReason(buy))}<div class="button-row">${counts.owned ? reviewButton(`equipment:${id}:buy`, { kind: "equipment-remove", targetId: id, mode: "buy" }, L("Sell one", "Vendre une unité")) : ""}${counts.leased ? reviewButton(`equipment:${id}:lease`, { kind: "equipment-remove", targetId: id, mode: "lease" }, L("Return one", "Restituer une unité")) : ""}</div></article>`; }).join("")}</div>`;
    if (ui.drawer === "training") return renderTrainingDrawer(planned);
    if (ui.drawer === "opening") return `<div class="drawer-cards">${focusFirst(Object.entries(D.openingPeriods)).map(([id, period]) => { const active = planned.operations.openingPeriods[id]; const payload = { kind: "opening-period", targetId: id, value: !active }; return optionCard(itemLabel(period.name), `${number(period.hours)} ${L("available room/equipment hours; no staff hours added", "heures de salle/équipement disponibles ; aucune heure de personnel ajoutée")}`, `opening:${id}`, payload, `${money(period.cost)}/${L("year", "an")}`, id); }).join("")}</div>`;
    if (ui.drawer === "dropoff") { const payload = { kind: "dropoff", value: !planned.operations.dropoff }; return optionCard(L("Drop-off workflow", "Parcours de dépôt"), L("Animals left for the day · vaccination, preventive care, lab, pharmacy: −30% room time, −10% vet time, +10% support · +1 trust · two support staff.", "Animaux déposés pour la journée · vaccination, prévention, laboratoire, pharmacie : −30 % de temps de salle, −10 % de temps vétérinaire, +10 % de soutien · +1 de confiance · deux personnes de soutien."), "operations:dropoff", payload, `${money(4000)}/${L("year", "an")}`); }
    if (ui.drawer === "stock") return `<div class="drawer-cards">${Object.entries(D.stockStrategies).map(([id, choice]) => { const change = Math.round((choice.multiplier - 1) * 100); const spending = change === 0 ? L("No change in supply spending", "Aucun changement des dépenses de fournitures") : change > 0 ? L(`${change}% more supply spending`, `${change} % de dépenses de fournitures en plus`) : L(`${Math.abs(change)}% less supply spending`, `${Math.abs(change)} % de dépenses de fournitures en moins`); return choiceCard(id === planned.operations.stockStrategy, itemLabel(choice.name), `${spending} · ${L(`about ${pct(choice.stockoutRate || 0)} of cases in pharmacy, surgery, orthopedics, hospital, dentistry, vaccination and preventive care lost to stock-outs`, `environ ${pct(choice.stockoutRate || 0)} des cas en pharmacie, chirurgie, orthopédie, hospitalisation, dentisterie, vaccination et prévention perdus par rupture de stock`)}`, "operations:stock", { kind: "stock-strategy", targetId: id }, `${number(choice.supportHours)} ${L("support hours", "heures de soutien")} · ${money(choice.cost)}/${L("year", "an")}`); }).join("")}</div>`;
    // These four were fully built — costs, effects, a reducer, an action label, a click handler —
    // and no screen ever rendered a button for them. They are the only direct answer to "how do I
    // change staff climate or client trust?", so without them the two indicators are read-only.
    if (ui.drawer === "relations") return `<p class="drawer-link"><button class="text-button" data-open-drawer="marketing">${escapeHtml(L("Communication with clients", "Communication avec les clients"))} ›</button></p><div class="drawer-cards">${Object.entries(D.socialActions).map(([id, action]) => optionCard(itemLabel(action.name), itemLabel(action.note), `social:${id}`, { kind: "social-action", targetId: id }, `${money(action.cost)} ${L("once", "une fois")}${action.supportHours ? ` · ${number(action.supportHours)} ${L("support hours", "heures de soutien")}` : ""}`, id)).join("")}</div>`;
    if (ui.drawer === "hr") return `<details class="note-repliee"><summary>${escapeHtml(L("Climate thresholds", "Seuils du climat"))}</summary><p>${escapeHtml(L("Staff climate changes absence and resignations: below 50 people are absent more, below 30 someone resigns at year end, and below 45 anyone paid under 95% of their benchmark resigns. Resignation protection counts as extra climate for those checks.", "Le climat de l’équipe modifie l’absence et les démissions : sous 50 les absences augmentent, sous 30 une personne démissionne en fin d’année, et sous 45 toute personne payée sous 95 % de sa référence démissionne. La protection contre les départs compte comme du climat en plus pour ces seuils."))}</p></details><div class="drawer-cards">${Object.entries(D.hrStrategies).map(([id, choice]) => choiceCard(id === planned.hr.strategy, itemLabel(choice.name), `${pct(choice.absenteeism)} ${L("expected work time lost to absence", "de temps de travail susceptible d’être perdu pour absence")} · ${L("staff climate", "climat de travail")} ${signed(choice.climate)} · ${L("resignation protection", "protection contre les départs")} +${choice.retention || 0}`, "hr:strategy", { kind: "hr-strategy", targetId: id }, `${money(choice.cost)}/${L("year", "an")}`)).join("")}</div>`;
    if (ui.drawer === "pricing") return `<p><strong>${escapeHtml(L("Your clients", "Vos clients"))}: ${escapeHtml(itemLabel(D.segments[planned.marketFocus].name))}</strong> — ${escapeHtml(L("the price they accept depends on the type of client and on their trust in the clinic.", "le prix qu’ils acceptent dépend du type de clients et de leur confiance dans la clinique."))}</p><details class="note-repliee"><summary>${escapeHtml(L("Price sensitivity", "Sensibilité au prix"))}</summary><p>${escapeHtml(L("Price sensitivity shows how strongly requests may change when the price changes. Only open services are listed: open a service first to price it.", "La sensibilité au prix indique dans quelle mesure les demandes peuvent changer lorsque le prix évolue. Seuls les services ouverts sont listés : ouvrez d’abord un service pour fixer son prix."))}</p></details><div class="price-editor">${D.services.filter((service) => planned.services[service.id].active).map((service) => { const current = ui.decisionDrafts[`price:${service.id}`] ?? planned.services[service.id].price; const accepte = acceptedPrice(service, planned); const known = acceptedKnown(service, planned, accepte); const au_dessus = Number(current) > known.high + .5; return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong><span class="${au_dessus ? "warn-text" : ""}">${escapeHtml(L("Price your clients accept", "Prix accepté par vos clients"))}: ${escapeHtml(acceptedText(known))}</span>${priceScale(Number(current), known)}<span>${escapeHtml(L("Price sensitivity", "Sensibilité au prix"))}: ${escapeHtml(priceSensitivity(service.elasticity))}</span><span>${escapeHtml(L("Money left after direct supplies", "Argent restant après les fournitures directes"))}: ${money(current * (1 - service.variableCost))} · ${escapeHtml(L(`supplies ${pct(service.variableCost)}`, `fournitures ${pct(service.variableCost)}`))}</span></div><label><span>${escapeHtml(L("Price", "Prix"))}</span><input type="number" min="1" max="5000" value="${current}" data-draft-price="${service.id}" data-draft-key="price:${service.id}"></label><button class="button primary" data-review-price="${service.id}">${escapeHtml(L("Review price", "Examiner le prix"))}</button></article>`; }).join("")}</div>`;
    if (ui.drawer === "finance") { const loan = planned.finance.loan; const rate = loanRate(state); const misses = bankMisses(state); const bankLine = `<p class="bank-standing ${misses ? "warn-text" : ""}"><strong>${escapeHtml(L("The bank", "La banque"))}</strong> : ${escapeHtml(misses === 0 ? L("promise kept last year", "promesse tenue l’an dernier") : L(`promise broken ${misses} year${misses > 1 ? "s" : ""} in a row`, `promesse non tenue ${misses} an${misses > 1 ? "s" : ""} de suite`))} — ${escapeHtml(rate === null ? L("no new loan", "aucun nouvel emprunt") : L(`loans at ${pct(rate)}`, `emprunt à ${pct(rate)}`))}.</p>`; if (!loan && rate === null) return bankLine; return bankLine + (loan ? `${optionCard(L("Repay loan early", "Rembourser l’emprunt par anticipation"), `${money(loan.remaining)} ${L("remaining principal", "de capital restant")}`, "finance:loan", { kind: "repay-loan" })}` : `<div class="drawer-cards"><article class="choice-card"><h3>${escapeHtml(L("Five-year loan", "Emprunt sur cinq ans"))}</h3><p>${escapeHtml(L(`${pct(rate)} a year on the remaining principal · one loan at a time`, `${pct(rate)} par an sur le capital restant · un emprunt à la fois`))}</p>${compareOptions([30000, 50000, 100000].map((amount) => ({ label: money(amount), key: "finance:loan", payload: { kind: "loan", value: amount }, button: L("Borrow", "Emprunter") })))}</article></div>`); }
    if (ui.drawer === "market") return `<div class="drawer-cards">${Object.entries(D.segments).map(([id, segment]) => choiceCard(id === planned.marketFocus, itemLabel(segment.name), segmentAppetite(segment), "market:focus", { kind: "market-focus", targetId: id })).join("")}</div>`;
    if (ui.drawer === "location") return `<div class="drawer-cards">${Object.entries(D.locations).map(([id, location]) => { const moving = id !== planned.location.sectorId; const note = moving && planned.location.parking ? ` ${L("Moving removes the current parking.", "Le déménagement supprime le parking actuel.")}` : ""; return choiceCard(id === planned.location.sectorId, itemLabel(location.name), itemLabel(location.description) + note, "location:sector", { kind: "location", targetId: id }, `${moving ? `${money(location.moveCost)} ${L("once to move", "une fois pour déménager")} · ` : ""}${money(location.rent)}/${L("year", "an")} · ${decimal(location.averageRoundTripKm, 0)} km ${L("average return trip", "aller-retour moyen")}`); }).join("")}${optionCard(planned.location.parking ? L("Remove parking", "Supprimer le parking") : L("Add parking", "Ajouter un parking"), L("Parking improves access and some demand, but increases the modelled share of car travel.", "Le parking améliore l’accès et une partie de la demande, mais augmente la part modélisée des déplacements en voiture."), "location:parking", { kind: "parking", value: !planned.location.parking }, planned.location.parking ? "" : `${money(D.locations[planned.location.sectorId].parkingCost)} ${L("once", "une fois")} · ${money(D.locations[planned.location.sectorId].parkingMaintenance)}/${L("year", "an")}`)}</div>`;
    if (ui.drawer === "marketing") {
      const ladder = (strategy, describe) => `<h3 class="drawer-section">${escapeHtml(strategy === "communication" ? L("Communication with clients", "Communication avec les clients") : L("Local market study", "Étude du marché local"))}</h3><div class="drawer-cards">${Object.entries(D.marketingStrategies[strategy]).map(([id, choice]) => choiceCard(planned.marketing[strategy] === id, itemLabel(choice.name), describe(choice), `marketing:${strategy}`, { kind: "marketing-strategy", strategy, targetId: id }, `${money(choice.cost)}/${L("year", "an")}${choice.supportHours ? ` · ${number(choice.supportHours)} ${L("support hours", "heures de soutien")}` : ""}`)).join("")}</div>`;
      const comm = (c) => c.trust ? [L(`+${c.trust} trust the first year, then ×${decimal(D.socialModel?.repeatDecay ?? 1, 1)} each year kept`, `+${c.trust} de confiance la première année, puis ×${decimal(D.socialModel?.repeatDecay ?? 1, 1)} chaque année maintenue`), `${signed(c.demand, "percent")} ${L("requests", "demandes")}`, `${signed(c.willingness || 0, "percent")} ${L("accepted price", "prix accepté")}`].join(" · ") : L("No programme", "Aucun programme");
      const study = (c) => c.precision > 0 ? L(`Accepted prices known to within about ±${pct(c.precision)}`, `Prix acceptés connus à ±${pct(c.precision)} environ`) : L("Accepted prices known exactly", "Prix acceptés connus exactement");
      return `${ladder("communication", comm)}${ladder("geomarketing", study)}<p class="drawer-link"><button class="text-button" data-open-drawer="market">${escapeHtml(L("Market focus", "Marché cible"))} ›</button></p>`;
    }
    if (ui.drawer === "sustainability") return renderSustainabilityOptions(planned);
    return "";
  }

  function renderSustainabilityOptions(planned) {
    const source = ui.drawerContext;
    if (!source) return `<p>${escapeHtml(L("Choose the source you want to address.", "Choisissez la source sur laquelle agir."))}</p><div class="drawer-menu">${["building", "clinical", "waste", "travel"].map((id) => `<button data-drawer-context="${id}"><strong>${escapeHtml(sourceLabel(id))}</strong><em>›</em></button>`).join("")}</div>`;
    if (source === "building") {
      const upgrades = Object.entries(D.sustainability.energyUpgrades).filter(([id]) => id !== "none").map(([id, choice]) => optionCard(itemLabel(choice.name), `${pct(1 - choice.electricityMultiplier)} ${L("less electricity;", "d’électricité en moins ;")} ${pct(1 - choice.heatingMultiplier)} ${L("less heating", "de chauffage en moins")}`, "sustainability:energy", { kind: "sustainability", targetId: "energyUpgrade", value: id }, `${money(choice.once)} ${L("once", "une fois")} · ${money(choice.annual)}/${L("year", "an")}`)).join("");
      const heat = D.sustainability.interventions.heatPump; const solar = D.sustainability.interventions.solar;
      return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Sources", "Sources"))}</button><div class="drawer-cards">${upgrades}${optionCard(itemLabel(heat.name), L("Replaces 80% of fuel heating with efficient electric heating.", "Remplace 80 % du chauffage au combustible par un chauffage électrique efficace."), "sustainability:heatPump", { kind: "sustainability", targetId: "heatPump", value: !planned.sustainability.heatPump }, `${money(heat.once)} ${L("once", "une fois")} · ${money(heat.annual)}/${L("year", "an")}`)}${optionCard(itemLabel(solar.name), L("Supplies up to 25% of annual electricity use.", "Fournit jusqu’à 25 % de l’électricité annuelle."), "sustainability:solar", { kind: "sustainability", targetId: "solar", value: !planned.sustainability.solar }, `${money(solar.once)} ${L("once", "une fois")} · ${money(solar.annual)}/${L("year", "an")}`)}</div>`;
    }
    if (source === "clinical") { const low = D.sustainability.interventions.lowFlow; return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Sources", "Sources"))}</button>${optionCard(itemLabel(low.name), L("Uses 40% less volatile anaesthetic for eligible procedures. Clinical suitability and animal safety always take priority.", "Utilise 40 % de gaz anesthésique volatil en moins pour les actes adaptés. La pertinence clinique et la sécurité animale restent prioritaires."), "sustainability:anaesthesia", { kind: "sustainability", targetId: "anaesthesiaProtocol", value: planned.sustainability.anaesthesiaProtocol === "lowFlow" ? "standard" : "lowFlow" }, `${money(low.once)} ${L("once", "une fois")} · ${number(low.vetHours)} ${L("vet training hours", "heures de formation vétérinaire")}`)}`; }
    if (source === "waste") return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Sources", "Sources"))}</button><div class="drawer-cards">${Object.entries(D.sustainability.wasteStrategies).map(([id, choice]) => optionCard(itemLabel(choice.name), id === "segregated" ? L("Moves only eligible non-infectious material out of the clinical-waste stream.", "Retire uniquement les matières non infectieuses admissibles du flux de déchets cliniques.") : id === "circular" ? L("Reduces eligible disposable purchases and waste by 15%.", "Réduit de 15 % les achats jetables admissibles et les déchets.") : L("Retains current waste handling.", "Conserve la gestion actuelle des déchets."), "sustainability:waste", { kind: "sustainability", targetId: "wasteStrategy", value: id }, `${money(choice.once)} ${L("once", "une fois")} · ${money(choice.annual)}/${L("year", "an")}`)).join("")}</div>`;
    const access = D.sustainability.interventions.accessPlan;
    return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Sources", "Sources"))}</button>${optionCard(itemLabel(access.name), L("Reduces modelled client-travel emissions by 8%, raises trust by 2, and demand by 1%.", "Réduit de 8 % les émissions modélisées des déplacements, augmente la confiance de 2 et la demande de 1 %."), "sustainability:access", { kind: "sustainability", targetId: "accessPlan", value: !planned.sustainability.accessPlan }, `${money(access.annual)}/${L("year", "an")} · ${number(access.supportHours)} ${L("support hours", "heures de soutien")}`)}`;
  }

  function drawerTitles() {
    const titles = { atelier: L("Teacher’s workshop", "Atelier de l’enseignant"), relations: L("Team and clients", "Équipe et clients"), person: L("Team member", "Membre de l’équipe"), setup: L("Game setup", "Paramétrage de la partie"), plan: L("Current plan", "Plan actuel"), recruitment: L("Post a vacancy", "Publier une offre"), staffPerson: L("Manage pay", "Gérer le salaire"), staffExit: L("Let someone go", "Se séparer d’une personne"), staffAllocation: L("Change time allocation", "Modifier l’affectation du temps"), hoursByService: L("Hours by service", "Heures par service"), serviceLedger: L("What each service brings in", "Ce que rapporte chaque service"), export: L("Export report", "Exporter le rapport"), services: L("Explore services", "Explorer les services"), rooms: L("Manage rooms", "Gérer les salles"), equipment: L("Manage equipment", "Gérer l’équipement"), training: L("Plan training", "Planifier une formation"), capabilities: L("Who can do what", "Qui peut faire quoi"), opening: L("Opening schedule", "Horaires d’ouverture"), dropoff: L("Drop-off workflow", "Parcours de dépôt"), stock: L("Stock strategy", "Stratégie de stock"), hr: L("HR strategy", "Stratégie RH"), pricing: L("Service prices", "Prix des services"), finance: L("Financing", "Financement"), market: L("Market focus", "Marché cible"), location: L("Location and parking", "Implantation et parking"), marketing: L("Communication and market study", "Communication et étude de marché"), sustainability: L("Transition options", "Options de transition") };
    return titles;
  }

  function drawerTitle() {
    return drawerTitles()[ui.drawer] || "";
  }


  function renderDrawer(planned, forecast) {
    if (!ui.drawer) return "";
    return `<div class="drawer-backdrop" data-close-drawer><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-head"><div><button class="breadcrumb" data-close-drawer>${escapeHtml(drawerBreadcrumb(planned))}</button>${ui.confirm ? "" : `<h2 id="drawer-title">${escapeHtml(drawerTitle())}</h2>`}</div><button data-close-drawer aria-label="${escapeHtml(t("app.close"))}">×</button></div><div class="drawer-body">${renderDrawerBody(planned, forecast)}</div></aside></div>`;
  }

  function renderWhyChanged(latest, previous) {
    const top = (entries) => entries.filter(([, value]) => Math.abs(value) >= .05).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
    const points = (value) => `${value > 0 ? "+" : ""}${decimal(value, 1)}`;
    const operating = (f) => (f.fixedCosts || 0) - (f.payroll || 0) - (f.socialCharges || 0) - (f.facilityCosts || 0) - (f.oneTimeCosts || 0);
    const staffCost = (f) => (f.payroll || 0) + (f.socialCharges || 0) + (f.overtimeCost || 0);
    const f = latest.financial;
    const p = previous?.financial;
    // The money rows are a closed set: revenue minus each cost bucket equals the headline. Cutting
    // them to the three largest hid three lines — including variable costs, which is how that figure
    // stayed invisible for so long — and left an arithmetic the reader could not check.
    const allMoney = (entries) => entries.filter(([, value]) => Math.abs(value) >= .5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const moneyItems = allMoney(p
      ? [[L("Revenue", "Recettes"), f.revenue - p.revenue], [L("Payroll, charges and overtime", "Salaires, charges et heures supplémentaires"), -(staffCost(f) - staffCost(p))], [L("Facilities", "Installations"), -(f.facilityCosts - p.facilityCosts)], [L("Variable costs", "Coûts variables"), -(f.variableCosts - p.variableCosts)], [L("Operating costs", "Coûts d’exploitation"), -(operating(f) - operating(p))], [L("One-time costs", "Coûts ponctuels"), -(f.oneTimeCosts - p.oneTimeCosts)]]
      : [[L("Revenue", "Recettes"), f.revenue], [L("Payroll, charges and overtime", "Salaires, charges et heures supplémentaires"), -staffCost(f)], [L("Facilities", "Installations"), -f.facilityCosts], [L("Variable costs", "Coûts variables"), -f.variableCosts], [L("Operating costs", "Coûts d’exploitation"), -operating(f)], [L("One-time costs", "Coûts ponctuels"), -f.oneTimeCosts]]
    ).map(([label, value]) => [label, signed(value, "money"), value]);
    const caseItems = (p
      ? latest.serviceResults.map((row) => [row, row.honored - (previous.serviceResults.find((item) => item.id === row.id)?.honored || 0)]).filter(([, delta]) => delta).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      : latest.serviceResults.filter((row) => row.active).map((row) => [row, row.honored]).sort((a, b) => b[1] - a[1])
    ).slice(0, 3).map(([row, value]) => [serviceName(row.id), signed(value), value]);
    const variance = latest.operational.demandVariance;
    if (latest.operational.stockoutLost > 0) caseItems.push([L("Lost to stock-outs", "Perdus par rupture de stock"), signed(-latest.operational.stockoutLost), -latest.operational.stockoutLost]);
    const climateLabels = { hr: L("HR strategy", "Stratégie RH"), openingHours: L("Extra opening hours", "Horaires étendus"), pay: L("Pay vs benchmark", "Salaire vs référence"), overtime: L("Overtime", "Heures supplémentaires"), workload: L("Workload level", "Niveau de charge"), pace: L("Rushed pace", "Rythme pressé"), departure: L("Someone was let go", "Départ imposé") };
    const trustLabels = { served: L("Share of requests served", "Part des demandes traitées"), communication: L("Client communication", "Communication client"), access: L("Low-carbon access plan", "Plan d’accès bas carbone"), pace: L("Service pace", "Rythme des services"), price: L("Prices judged too high", "Prix jugés trop élevés"), refused: L("Refused clients piling up", "Clients refusés qui s’accumulent"), carbon: L("Footprint per case", "Empreinte par cas"), dropoff: L("Drop-off convenience", "Commodité du dépôt"), stockouts: L("Stock-outs", "Ruptures de stock") };
    const partItems = (parts, labels) => top(Object.entries(parts || {}).map(([id, value]) => [labels[id] || id, value])).map(([label, value]) => [label, points(value), value]);
    const blocks = [
      [L("Net result", "Résultat net"), money(f.netResult), moneyItems],
      [L("Cases served", "Cas traités"), number(latest.operational.totalHonored), caseItems],
    ];
    return `<section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(p ? L("Why each number changed", "Pourquoi chaque indicateur a changé") : L("How the result is built", "Comment le résultat se forme"))}</h2><p>${escapeHtml(p ? L("Largest contributions compared with the previous year.", "Principales contributions par rapport à l’année précédente.") : L("Largest contributions this year.", "Principales contributions cette année."))}</p></div></div><div class="why-grid">${blocks.map(([title, value, items]) => `<article><h3>${escapeHtml(title)}</h3><strong>${escapeHtml(value)}</strong><ul>${items.length ? items.map(([label, shown, raw]) => `<li><span>${escapeHtml(label)}</span><em class="${raw >= 0 ? "good-text" : "bad-text"}">${escapeHtml(shown)}</em></li>`).join("") : `<li><span>${escapeHtml(L("No notable change", "Aucun changement notable"))}</span></li>`}</ul></article>`).join("")}</div></section>`;
  }

  // One year back, and only the most recent one — the snapshot is replaced every time a year is
  // passed. It is deliberately in the students' hands: Wednesday is worked alone at home, where a
  // ruined year otherwise costs the whole week. What stops it becoming trial-and-error is that it is
  // recorded, not that it is locked: every undo lands in the decision log and in the setup record
  // the instructor reads.
  function undoButton() {
    if (!state.undo) return "";
    return `<button class="button secondary" data-undo-year>${escapeHtml(L(`← Undo Year ${state.undo.year}`, `← Revenir à l’année ${state.undo.year}`))}</button>`;
  }

  function renderPlayableResults() {
    if (!state.history.length) return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Results", "Résultats"))}</h1><p>${escapeHtml(L("Pass a year to see what changed and why.", "Passez une année pour voir ce qui a changé et pourquoi."))}</p></div></div><section class="card-section empty-state">${escapeHtml(t("results.noHistory"))}</section></section>`;
    const latest = state.history[state.history.length - 1];
    const previous = state.history[state.history.length - 2];
    const carbon = latest.carbon;
    const changes = [
      { label: L("Net result", "Résultat net"), value: money(latest.financial.netResult), good: latest.financial.netResult >= 0, delta: previous ? signed(latest.financial.netResult - previous.financial.netResult, "money") : "" },
      { label: L("Cases served", "Cas traités"), value: `${number(latest.operational.totalHonored)} / ${number(latest.operational.totalDemand)}`, good: latest.operational.honoredRate >= .82, delta: previous ? signed(latest.operational.totalHonored - previous.operational.totalHonored) : "" },
      // Judged on the rounded figure the card actually shows: a half-point drift that rounds to the
      // same number must not carry a warning badge, or the badge contradicts the value beside it.
      { label: L("Staff climate", "Climat de l’équipe"), value: number(latest.social.after.staffClimate), good: Math.round(latest.social.after.staffClimate) >= Math.round(latest.social.before.staffClimate), delta: signed(Math.round(latest.social.after.staffClimate) - Math.round(latest.social.before.staffClimate)) },
      { label: L("Carbon footprint", "Empreinte carbone"), value: carbon ? tonnes(carbon.total) : L("Not available for migrated year", "Non disponible pour l’année migrée"), good: carbon ? (!previous?.carbon || carbon.total <= previous.carbon.total) : false, delta: carbon && previous?.carbon ? `${carbon.total - previous.carbon.total >= 0 ? "+" : "−"}${tonnes(Math.abs(carbon.total - previous.carbon.total))}` : "" },
      // These two shift demand every year and previously had no surface anywhere in the interface.
      { label: itemLabel(D.socialIndicators.referralSupport), value: number(latest.social.after.referralSupport), good: Math.round(latest.social.after.referralSupport) >= Math.round(latest.social.before.referralSupport), delta: signed(Math.round(latest.social.after.referralSupport) - Math.round(latest.social.before.referralSupport)) },
      { label: itemLabel(D.socialIndicators.communityPressure), value: number(latest.social.after.communityPressure), good: Math.round(latest.social.after.communityPressure) <= Math.round(latest.social.before.communityPressure), delta: signed(Math.round(latest.social.after.communityPressure) - Math.round(latest.social.before.communityPressure)) }
    ];
    const costDrivers = [
      [L("Payroll and charges", "Salaires et charges"), latest.financial.payroll + latest.financial.socialCharges],
      [L("Facilities", "Installations"), latest.financial.facilityCosts],
      [L("Variable costs", "Coûts variables"), latest.financial.variableCosts],
      [L("Operating costs", "Coûts d’exploitation"), latest.financial.openingCosts + latest.financial.dropoffCost + latest.financial.stockCost + latest.financial.hrCost + latest.financial.marketingCost + (latest.financial.sustainabilityCost || 0) + latest.financial.admin],
      ...(latest.financial.loanInterest > 0 ? [[L("Loan interest", "Intérêts d’emprunt"), latest.financial.loanInterest]] : []),
      [L("One-time costs", "Coûts ponctuels"), latest.financial.oneTimeCosts]
    ].sort((a, b) => b[1] - a[1]);
    const mainCarbon = carbon?.primaryDrivers[0];
    // A verdict that only says "you were wrong" trains deference to the model, which is the habit
    // this course exists to break. So it hands back what the clinic was counting, where the
    // student's own answer came in, and how close the ranking was — and it says plainly that
    // disagreeing with the model on grounds the model does not count is a finding, not an error.
    const verdict = latest.prediction ? (() => {
      const label = (key) => { const [type, id] = String(key).split(":"); return blockerText({ type, id: id || undefined }); };
      const ranking = constraintBreakdown(latest);
      const top = ranking[0];
      const runnerUp = ranking.find((row) => row.key !== latest.prediction.actual && row.unserved > 0);
      const mine = ranking.find((row) => row.key === latest.prediction.predicted);
      const basis = top && top.services.length
        ? L(`Because ${top.services.map((row) => `${serviceName(row.id)} (${number(row.unserved)} requests unserved)`).join(", ")} ran out of it before anything else.`, `Parce que ${top.services.map((row) => `${serviceName(row.id)} (${number(row.unserved)} demandes non traitées)`).join(", ")} en a manqué avant toute autre chose.`)
        : L("No service ran short this year: everything the clinic offers was served.", "Aucun service n’a manqué cette année : tout ce que la clinique propose a été traité.");
      const yours = latest.prediction.match ? "" : mine && mine.unserved > 0
        ? L(`Your answer was real but smaller: ${label(latest.prediction.predicted)} left ${number(mine.unserved)} requests unserved, against ${number(top?.unserved || 0)}.`, `Votre réponse était réelle mais plus petite : ${label(latest.prediction.predicted)} a laissé ${number(mine.unserved)} demandes non traitées, contre ${number(top?.unserved || 0)}.`)
        : L(`No service was held back by ${label(latest.prediction.predicted)} this year.`, `Aucun service n’a été retenu par ${label(latest.prediction.predicted)} cette année.`);
      const margin = runnerUp && top && top.unserved > 0
        ? L(`The answer is a ranking, not a verdict: ${label(runnerUp.key)} came second with ${number(runnerUp.unserved)} unserved. Change the year a little and the clinic answers differently.`, `La réponse est un classement, pas un verdict : ${label(runnerUp.key)} arrive deuxième avec ${number(runnerUp.unserved)} demandes non traitées. Modifiez un peu l’année et la clinique répond autrement.`)
        : "";
      return `<section class="card-section prediction-verdict ${latest.prediction.match ? "matched" : "missed"}"><div class="panel-heading"><h2>${escapeHtml(L("What you expected, and what the clinic counted", "Ce que vous attendiez, et ce que la clinique a compté"))}</h2></div><div class="comparison-list"><div><strong>${escapeHtml(L("You predicted", "Vous aviez prédit"))}</strong><span>${escapeHtml(label(latest.prediction.predicted))}</span><em>→ ${escapeHtml(label(latest.prediction.actual))}</em></div></div><p><strong>${escapeHtml(L("Why the clinic answers this", "Pourquoi la clinique répond cela"))}</strong> ${escapeHtml(basis)}</p>${yours ? `<p>${escapeHtml(yours)}</p>` : ""}${margin ? `<p>${escapeHtml(margin)}</p>` : ""}<p class="arguable">${escapeHtml(L("The clinic counts requests, hours, rooms and equipment. It does not count what a case asks of the person treating it, what a refused client tells a neighbour, or what the work is for. If your reasoning rested on something in that second list, you are not wrong — you have found an edge of the model. Write it down with the figure that exposed it.", "La clinique compte des demandes, des heures, des salles et de l’équipement. Elle ne compte pas ce qu’un cas exige de la personne qui le traite, ce qu’un client refusé raconte autour de lui, ni ce à quoi sert le travail. Si votre raisonnement portait sur cette seconde liste, vous n’avez pas tort — vous avez trouvé une limite du modèle. Écrivez-la, avec le chiffre qui l’a révélée."))}</p><p class="no-effect">${escapeHtml(L("Nothing here is scored.", "Rien ici n’est noté."))}</p></section>`;
    })() : "";
    const causeRows = `<article><span>${escapeHtml(L("Main constraint", "Contrainte principale"))}</span><strong>${escapeHtml(blockerText(latest.operational.mainConstraint))}</strong></article><article><span>${escapeHtml(L("Largest cost", "Coût principal"))}</span><strong>${escapeHtml(costDrivers[0][0])}: ${money(costDrivers[0][1])}</strong></article>${carbon ? `<article><span>${escapeHtml(L("Largest carbon source", "Principale source de carbone"))}</span><strong>${escapeHtml(sourceLabel(mainCarbon))}: ${tonnes(carbon.bySource[mainCarbon])}</strong></article>` : ""}`;
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Year results", "Résultats de l’année"))}</h1><p>${escapeHtml(L("The year as played: its figures, its signals, its causes.", "L’année telle que jouée : ses chiffres, ses signaux, ses causes."))}</p></div><div class="button-row"><strong>${escapeHtml(t("app.year", { year: latest.turn, target: state.rules.targetYear }))}</strong><button class="button primary" data-domain="overview">${escapeHtml(L(`Plan Year ${state.year} →`, `Planifier l’année ${state.year} →`))}</button></div></div>
      ${resolvedGridNote(latest.turn)}
      <div class="dashboard-grid compact-three">${changes.map((item) => metricCard(item.label, item.value, item.delta ? L(`${item.delta} in a year`, `${item.delta} sur un an`) : "", item.good ? "good" : "warn")).join("")}</div>
      ${verdict}
      ${renderSignals(latest)}
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("What drove the result", "Origine du résultat"))}</h2></div><span class="panel-links"><button class="text-button" data-open-drawer="serviceLedger">${escapeHtml(L("What each service brings in", "Ce que rapporte chaque service"))} ›</button></span></div><div class="cause-list">${causeRows}</div>${latest.operational.totalDemand > latest.operational.totalHonored ? `<h3>${escapeHtml(L(`${number(latest.operational.totalDemand - latest.operational.totalHonored)} requests refused, by cause`, `${number(latest.operational.totalDemand - latest.operational.totalHonored)} demandes refusées, par cause`))}</h3>${refusalBar(latest)}` : ""}<h3>${escapeHtml(L("Actions taken", "Actions réalisées"))}</h3><div class="chips">${latest.actions?.length ? latest.actions.map((action) => `<span class="chip">${escapeHtml(actionLabel(action))}</span>`).join("") : `<span class="chip">${escapeHtml(t("results.noAction"))}</span>`}</div>${(latest.departures || []).length ? `<div class="recruitment-results">${latest.departures.map((item) => `<p class="bad-text">${escapeHtml(item.name)}: ${escapeHtml(departureText(item.reason))}</p>`).join("")}</div>` : ""}${latest.recruitment?.length ? `<div class="recruitment-results">${latest.recruitment.map((row) => `<p class="${row.accepted ? "good-text" : "bad-text"}">${escapeHtml(candidateById(row.candidateId)?.name || row.candidateId)}: ${escapeHtml(row.accepted ? t("staff.accepted") : t("staff.refused"))}</p>`).join("")}</div>` : ""}</section>
      ${renderWhyChanged(latest, previous)}
      ${renderSetupRecord()}
      <section class="card-section"><div class="panel-heading"><h2>${escapeHtml(L("Earlier years", "Années précédentes"))}</h2></div><div class="history-accordions">${state.history.slice().reverse().map((report) => `<details ${report.turn === latest.turn ? "open" : ""}><summary><strong>${escapeHtml(t("app.year", { year: report.turn, target: state.rules.targetYear }))}</strong><span>${money(report.financial.netResult)} · ${number(report.operational.totalHonored)} ${escapeHtml(t("common.cases"))}${report.carbon ? ` · ${tonnes(report.carbon.total)}` : ""}</span></summary><p>${escapeHtml(blockerText(report.operational.mainConstraint))}</p></details>`).join("")}</div></section>
      <div class="next-year">${undoButton()}<button class="button primary" data-domain="overview">${escapeHtml(L(`Plan Year ${state.year} →`, `Planifier l’année ${state.year} →`))}</button></div>
    </section>`;
  }

  function renderHelp() {
    if (!state.helpOpen) return "";
    const sections = ["requests", "actions", "forecast", "goals", "costs", "sustainability", "reflection"];
    return `<div class="modal-backdrop"><section class="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="modal-head"><h2 id="help-title">${escapeHtml(t("help.title"))}</h2><button data-close-help aria-label="${escapeHtml(t("app.close"))}">×</button></div><p class="lead">${escapeHtml(t("help.intro"))}</p><article class="help-example"><h3>${escapeHtml(L("A first-turn example", "Exemple de premier tour"))}</h3><ol><li>${escapeHtml(L("The overview says the clinic is losing money and that much team time is unused.", "La vue d’ensemble indique que la clinique perd de l’argent et qu’une grande partie du temps de l’équipe est inutilisée."))}</li><li>${escapeHtml(L("You explore a compatible service and read its five consequences.", "Vous explorez un service compatible et lisez ses cinq conséquences."))}</li><li>${escapeHtml(L("You add it to the plan only if the trade-off makes sense. Looking and cancelling cost no action.", "Vous ne l’ajoutez au plan que si le compromis vous convient. Consulter et annuler ne coûte aucune action."))}</li></ol><button class="button secondary" data-reopen-guide>${escapeHtml(L("Show the Year 1 guide", "Afficher le guide de l’année 1"))}</button></article>${sections.map((id) => `<article><h3>${escapeHtml(t(`help.${id}Title`))}</h3><p>${escapeHtml(t(`help.${id}Text`))}</p></article>`).join("")}<article><h3>${escapeHtml(L("Short glossary", "Petit glossaire"))}</h3><dl class="help-glossary"><div><dt>${escapeHtml(L("Requests", "Demandes"))}</dt><dd>${escapeHtml(L("Potential cases from clients this year, counted for open services only.", "Cas potentiels demandés par les clients cette année, comptés pour les services ouverts uniquement."))}</dd></div><div><dt>${escapeHtml(L("Cases served", "Cas traités"))}</dt><dd>${escapeHtml(L("Requests the clinic has enough people, rooms, equipment, and skills to complete.", "Demandes que la clinique peut traiter avec son équipe, ses salles, son équipement et ses compétences."))}</dd></div><div><dt>${escapeHtml(L("Net result", "Résultat net"))}</dt><dd>${escapeHtml(L("Annual income minus all annual and one-time costs.", "Recettes annuelles moins tous les coûts annuels et ponctuels."))}</dd></div><div><dt>${escapeHtml(L("Ready vs staffed", "Prêt ou doté en personnel"))}</dt><dd>${escapeHtml(L("A service is ready when its rooms, equipment, and skills exist. It only serves cases when someone is also assigned to it.", "Un service est prêt quand ses salles, équipements et compétences existent. Il ne traite des cas que si quelqu’un y est aussi affecté."))}</dd></div><div><dt>${escapeHtml(L("Overtime and idle time", "Heures supplémentaires et temps inoccupé"))}</dt><dd>${escapeHtml(L("Assigning more than 100% of a person’s hours creates paid overtime (up to 130%) that lowers staff climate; less than 100% leaves paid idle time.", "Affecter plus de 100 % des heures d’une personne crée des heures supplémentaires payées (jusqu’à 130 %) qui dégradent le climat ; moins de 100 % laisse du temps payé inoccupé."))}</dd></div><div><dt>${escapeHtml(L("Shared rooms", "Salles partagées"))}</dt><dd>${escapeHtml(L("When a room or machine is full, every service using it loses the same share of cases.", "Quand une salle ou un appareil est saturé, chaque service qui l’utilise perd la même part de cas."))}</dd></div><div><dt>${escapeHtml(L("Vets covering support work", "Vétérinaires en soutien"))}</dt><dd>${escapeHtml(L("Vets can do the support part of any service, but a vet hour costs more than a support hour.", "Les vétérinaires peuvent assurer la partie soutien de tout service, mais une heure vétérinaire coûte plus cher."))}</dd></div><div><dt>${escapeHtml(L("Carbon per treated case", "Carbone par cas traité"))}</dt><dd>${escapeHtml(L("The clinic’s modelled footprint divided by completed cases.", "L’empreinte modélisée de la clinique divisée par les cas traités."))}</dd></div></dl></article><button class="button primary" data-close-help>${escapeHtml(t("app.close"))}</button></section></div>`;
  }

  function renderEndModal() {
    if (!state.endState) return "";
    const latest = state.history.find((report) => report.turn === state.endState.reportTurn) || state.history[state.history.length - 1];
    const failed = state.endState.type === "failure";
    const strained = state.endState.type === "strained";
    const tone = failed ? "bad" : strained ? "warn" : "good";
    const symbol = failed ? "!" : strained ? "△" : "✓";
    const titleKey = failed ? "end.failureTitle" : strained ? "end.strainedTitle" : "end.successTitle";
    const textKey = failed ? "end.failureText" : strained ? "end.strainedText" : "end.successText";
    // The symbol is decorative; the verdict has to reach a screen reader as text, and the treasury
    // that produced it was shown nowhere at all.
    return `<div class="modal-backdrop"><section class="modal end-modal" role="dialog" aria-modal="true" aria-labelledby="end-title"><div class="end-symbol ${tone}" aria-hidden="true">${symbol}</div><h2 id="end-title">${escapeHtml(t(titleKey))}</h2><p>${escapeHtml(t(textKey))}</p><p class="end-treasury ${tone}"><strong>${escapeHtml(t("end.endTreasury"))}: ${money(latest.financial.treasury)}</strong></p><strong>${(() => { const kept = latest.commitments || []; return escapeHtml(L(`${kept.filter((c) => c.ok).length} of ${kept.length} promises kept in the last year`, `${kept.filter((c) => c.ok).length} engagements tenus sur ${kept.length} la dernière année`)); })()}</strong>${endEngagements()}<div class="button-row"><button class="button primary" data-continue>${escapeHtml(t("app.continue"))}</button><button class="button secondary" data-export>${escapeHtml(t("app.export"))}</button><button class="button danger" data-reset>${escapeHtml(t("app.restart"))}</button></div></section></div>`;
  }

  function renderDomain(planned, forecast) {
    if (state.domain === "care") return renderCare(planned, forecast);
    if (state.domain === "team") return renderTeam(planned, forecast);
    if (state.domain === "business") return renderBusiness(planned, forecast);
    if (state.domain === "sustainability") return renderSustainability(planned, forecast);
    if (state.domain === "results") return renderPlayableResults();
    return renderOverview(planned, forecast);
  }

  function render() {
    applyModelRules(state.modelRules);
    ensureCarbonBaseline();
    t = I18N.createTranslator(state.language);
    document.documentElement.lang = state.language;
    document.title = t("app.title");
    if (ui.atelierView && ui.atelierUnlocked) {
      document.querySelector("#app").innerHTML = renderAtelierPage();
      restoreAtelierScroll();
      return;
    }
    const planned = plannedState();
    const { baseline, forecast } = forecastPair();
    document.querySelector("#app").innerHTML = `${renderHeader(planned)}${renderNav()}<div class="workspace"><main class="content">${renderDomain(planned, forecast)}</main>${renderPlanPanel(baseline, forecast)}</div>${renderHelp()}${renderEndModal()}${renderDrawer(planned, forecast)}${renderPassCheck(planned, forecast)}`;
    const drawer = document.querySelector(".drawer");
    if (drawer && ui.restore) {
      const restore = ui.restore;
      ui.restore = null;
      window.setTimeout(() => {
        const body = drawer.querySelector(".drawer-body");
        if (body) body.scrollTop = restore.scrollTop;
        const cible = restore.selector ? drawer.querySelector(restore.selector) : null;
        if (!cible) return;
        cible.focus();
        if (!restore.champ || typeof cible.setSelectionRange !== "function") return;
        // Keep what was typed only while it still means the figure the model now holds, so a value
        // the ceiling clamped is corrected on screen instead of being quietly kept.
        const saisi = String(restore.champ.value ?? "");
        const garde = Number(saisi || 0) === Number(cible.value || 0);
        if (garde) cible.value = saisi;
        // When a ceiling rewrote the figure, the caret goes to the end of the figure that won.
        const position = garde ? Math.min(restore.champ.caret ?? cible.value.length, cible.value.length) : cible.value.length;
        cible.setSelectionRange(position, position);
      }, 0);
    } else if (drawer && ui.focusItem && drawer.querySelector("[data-target-card]")) {
      ui.autoFocusDrawer = false;
      window.setTimeout(() => {
        const card = drawer.querySelector("[data-target-card]");
        card?.scrollIntoView({ block: "nearest" });
        (card?.querySelector("[data-add-key], [data-review-allocation], button.button") || card?.querySelector("button"))?.focus();
      }, 0);
    } else if (drawer && ui.autoFocusDrawer) {
      ui.autoFocusDrawer = false;
      window.setTimeout(() => drawer.querySelector("button, input, select, textarea")?.focus(), 0);
    }
    syncRoute();
  }



  function syncPlayerTeam() {
    const teamCode = document.querySelector("[data-team-code]");
    if (teamCode) state.playerTeam.teamCode = teamCode.value.trim().slice(0, 24);
    saveState();
  }

  function buildExportPayload() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      locale: locale(),
      scenario: { id: state.scenarioId, label: itemLabel(D.scenarios[state.scenarioId].name) },
      rules: clone(state.rules),
      // The rules the game was played with: the original ones, or a teacher's changes, setting by setting.
      modelRules: (() => { const c = cleanRules(state.modelRules); const r = rulesSummary(state.modelRules); return c ? { nom: c.nom || "", monnaie: c.monnaie ? c.monnaie.code : "EUR", regles: c, reglages: r.map(({ section, chemin, nom, origine, valeur, texteOrigine, texteValeur }) => ({ section, chemin: chemin || null, nom, origine: origine ?? texteOrigine, valeur: valeur ?? texteValeur })) } : { nom: "origine", monnaie: "EUR", reglages: [] }; })(),
      setup: clone(state.setup),
      setupLog: clone(state.setupLog || []),
      cashLog: clone(state.cashLog || []),
      decisionLog: clone(state.decisionLog || []),
      runArchive: clone(state.runArchive || []),
      uiPreferences: clone(state.uiPreferences),
      playerTeam: clone(state.playerTeam),
      carbonMethod: { version: D.carbonModel.version, context: D.carbonModel.context, factors: Object.fromEntries(Object.entries(D.carbonModel.factorRegistry).map(([id, factor]) => [id, { value: factor.value, unit: factor.unit, year: factor.year, detail: itemLabel(factor.detail), source: factor.source }])), sources: D.carbonModel.sources, assumptions: D.carbonModel.assumptions, excluded: D.carbonModel.excluded },
      carbonBaseline: clone(state.carbonBaseline),
      clinic: { year: state.year, treasury: state.treasury, clients: state.clients, reputation: state.reputation, services: state.services, staff: state.staff, operations: state.operations, hr: state.hr, location: state.location, marketing: state.marketing, finance: state.finance, sustainability: state.sustainability },
      years: state.history.map((report) => ({
        year: report.turn,
        passedAt: report.passedAt || null,
        commitments: clone(report.commitments || []),
        signals: signalLines(report).map((l) => ({ tone: l.tone, cause: l.cause, effect: l.effect })),
        grant: report.financial.grant || 0,
        actionIds: report.actions || [],
        actionLabels: (report.actions || []).map(actionLabel),
        legacyActions: report.legacyActions || [],
        revenue: report.financial.revenue,
        totalCosts: report.financial.totalCosts,
        netResult: report.financial.netResult,
        treasury: report.financial.treasury,
        demand: report.operational.totalDemand,
        served: report.operational.totalHonored,
        carbon: report.carbon || null,
        constraintId: report.operational.mainConstraint,
        constraintLabel: blockerText(report.operational.mainConstraint),
        predictedConstraint: report.prediction?.predicted || null,
        predictionMatched: report.prediction ? report.prediction.match : null,
        forecastShown: clone(report.forecastShown || null),
        financial: clone(report.financial),
        operational: clone(report.operational),
        serviceResults: clone(report.serviceResults).map((row) => ({ ...row, ...(row.acceptedPrice ? { acceptedPriceShown: acceptedText(acceptedKnown(SERVICE_BY_ID[row.id], { marketing: report.clinicSnapshot?.marketing || {} }, row.acceptedPrice)) } : {}) })),
        social: clone(report.social),
        recruitment: clone(report.recruitment || []),
        actionRecords: clone(report.actionRecords || []),
        clinicSnapshot: clone(report.clinicSnapshot || null),
        detailAvailability: report.clinicSnapshot ? "complete" : "historical-summary-only"
      }))
    };
  }

  const SAUVEGARDE_KIND = "clinique-sauvegarde";

  function resumeEssai(clinic) {
    const archivedAt = new Date().toISOString();
    return {
      id: `${archivedAt}-${clinic.year}-${clinic.history.length}`,
      archivedAt,
      scenario: clinic.scenarioId,
      teamCode: clinic.playerTeam?.teamCode || "",
      yearReached: clinic.year,
      years: clinic.history.map((report) => ({
        year: report.turn,
        netResult: report.financial.netResult,
        treasury: report.financial.treasury,
        demand: report.operational.totalDemand,
        served: report.operational.totalHonored,
        constraintId: report.operational.mainConstraint,
        actionLabels: (report.actions || []).map(actionLabel),
        forecastShown: clone(report.forecastShown || null)
      })),
      decisionLog: clone(clinic.decisionLog || [])
    };
  }

  function sauvegarderClinique() {
    saveState(); syncPlayerTeam();
    const fichier = { kind: SAUVEGARDE_KIND, schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), state: clone(state) };
    const blob = new Blob([JSON.stringify(fichier)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const code = (state.playerTeam.teamCode || "").replace(/[^A-Za-z0-9_-]/g, "") || "sans-code";
    link.download = `clinique-${code}-annee-${state.year}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast(L("Clinic saved. Keep the file: it is the only copy outside this browser.", "Clinique enregistrée. Gardez le fichier : c’est la seule copie hors de ce navigateur."), "good");
  }

  // Un fichier qui n'est pas une sauvegarde de ce jeu ne doit rien remplacer : on verifie avant
  // de toucher a quoi que ce soit, et on refuse en entier plutot que de charger a moitie.
  function chargerClinique(texte) {
    let fichier;
    try { fichier = JSON.parse(texte); }
    catch (e) { toast(L("That file is not readable.", "Ce fichier n’est pas lisible."), "warn"); return false; }
    if (!fichier || fichier.kind !== SAUVEGARDE_KIND || !fichier.state) {
      toast(L("That is not a clinic save file. The analytical export cannot be loaded back.", "Ce n’est pas une sauvegarde de clinique. Le fichier d’analyse ne se recharge pas."), "warn");
      return false;
    }
    if (Number(fichier.schemaVersion) !== SCHEMA_VERSION) {
      toast(L(`This save comes from another version of the game (${fichier.schemaVersion} against ${SCHEMA_VERSION}).`, `Cette sauvegarde vient d’une autre version du jeu (${fichier.schemaVersion} contre ${SCHEMA_VERSION}).`), "warn");
      return false;
    }
    // Friday is played twice from one saved clinic — three years without the project, then three
    // with it — and a load replaces the whole state. The run being replaced is summarised first and
    // carried into the loaded clinic, so the comparison the week builds towards reaches the export.
    const remplacee = state.history.length ? resumeEssai(state) : null;
    const vus = new Set();
    const archive = [...(Array.isArray(fichier.state.runArchive) ? fichier.state.runArchive : []), ...(state.runArchive || []), ...(remplacee ? [remplacee] : [])]
      .filter((essai) => essai && !vus.has(essai.id) && vus.add(essai.id));
    state = hydrate(fichier.state);
    state.runArchive = archive;
    logDecision("load", `year:${state.year}`);
    ui.drawer = null; ui.drawerContext = null; ui.confirm = null; ui.originStack = [];
    saveState();
    render();
    toast(L(`Clinic restored at year ${state.year}.`, `Clinique restaurée à l’année ${state.year}.`), "good");
    return true;
  }

  function downloadJson() {
    saveState(); syncPlayerTeam();
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clinic-simulation-${state.scenarioId}-${state.language}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast(t("toast.exported"), "good");
  }

  function reportTable(headers, rows) {
    return `<table><thead><tr>${headers.map((heading) => `<th>${escapeHtml(heading)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function heure(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function evenementLabel(event) {
    return ({
      add: L("Planned", "Planifiée"), revise: L("Changed", "Modifiée"), remove: L("Removed", "Retirée"),
      prediction: L("Prediction made", "Prévision faite"), "prediction-resolved": L("Prediction checked", "Prévision vérifiée"),
      pass: L("Year passed", "Année passée"), "undo-year": L("Year undone", "Année annulée"),
      load: L("Saved clinic loaded", "Clinique enregistrée chargée"), rules: L("Model rules changed", "Règles du modèle changées"), sandbox: L("Play continued past the target year", "Partie poursuivie après l’année cible")
    })[event] || event;
  }

  function detailEvenement(entry) {
    const contrainte = (key) => { const [type, id] = String(key).split(":"); return blockerText({ type, id: id || undefined }); };
    if (entry.event === "prediction") { const [, , ...reste] = String(entry.key).split(":"); return `${L("for year", "pour l’année")} ${String(entry.key).split(":")[1]} : ${contrainte(reste.join(":"))}`; }
    if (entry.event === "prediction-resolved") { const [predite, reelle] = String(entry.key).split("→"); return `${contrainte(predite)} → ${contrainte(reelle)}`; }
    if (["pass", "undo-year", "load", "sandbox"].includes(entry.event)) return "";
    return entry.label || entry.key;
  }

  function buildPrintableReportHtml() {
    const title = L("Veterinary clinic simulation report", "Rapport de simulation de clinique vétérinaire");
    const teamCode = state.playerTeam.teamCode || L("Not provided", "Non renseigné");
    const start = initialState(state.scenarioId, state.language, state.setup);
    const setupLines = setupLogLines();
    const goals = state.history.length ? goalChecks(state.history[state.history.length - 1], state) : [];
    const yearSections = state.history.map((report, reportIndex) => {
      const staffRows = report.operational.staffRows || [];
      const hourRows = report.operational.serviceHourRows || [];
      const snapshotStaff = report.clinicSnapshot?.staff || [];
      const staffTable = staffRows.length ? reportTable([L("Person", "Personne"), L("Available", "Disponibles"), L("Assigned", "Affecté"), L("Worked", "Travaillées"), L("Overtime", "Heures sup."), L("Not worked", "Non travaillées"), L("Blocked", "Bloquées"), L("Workload", "Charge"), L("Allocations", "Affectations")], staffRows.map((row) => { const person = snapshotStaff.find((item) => item.id === row.id); return [escapeHtml(person?.name || row.id), number(row.availableHours), pct(row.assignedShare ?? 1), number(row.usedHours), number(row.overtimeHours || 0), number(row.unusedHours), number(row.blockedHours), pct(row.workload), escapeHtml((row.assignments || []).map((assignment) => `${serviceName(assignment.serviceId)} ${Math.round(assignment.share * 100)}%`).join(" · "))]; })) : `<p class="notice">${escapeHtml(L("Detailed staff allocation was not recorded for this migrated year.", "L’affectation détaillée du personnel n’a pas été enregistrée pour cette année migrée."))}</p>`;
      const serviceRows = report.serviceResults || [];
      const services = serviceRows.length ? reportTable([L("Service", "Service"), L("Requests", "Demandes"), L("Served", "Traités"), L("Return visits", "Retours"), L("Price", "Prix"), L("Accepted price", "Prix accepté"), L("Revenue", "Recettes"), L("Variable costs", "Coûts variables"), L("Blocker", "Blocage")], serviceRows.filter((row) => row.active).map((row) => [escapeHtml(serviceName(row.id)), number(row.demand), number(row.honored), number(row.returnVisits || 0), money(row.price), row.acceptedPrice ? acceptedText(acceptedKnown(SERVICE_BY_ID[row.id], { marketing: report.clinicSnapshot?.marketing || {} }, row.acceptedPrice)) : "—", money(row.revenue), money(row.variableCosts), escapeHtml(blockerText(row.bottleneck))])) : `<p class="notice">${escapeHtml(L("Detailed service results were not recorded for this migrated year.", "Les résultats détaillés des services n’ont pas été enregistrés pour cette année migrée."))}</p>`;
      const hours = hourRows.length ? reportTable([L("Service", "Service"), L("Role", "Fonction"), L("Assigned", "Affectées"), L("Needed", "Nécessaires"), L("Worked", "Travaillées"), L("Shortage", "Manque")], hourRows.map((row) => [escapeHtml(serviceName(row.serviceId)), escapeHtml(row.role === "vet" ? L("Veterinarian", "Vétérinaire") : L("Support", "Soutien")), number(row.assignedHours), number(row.neededHours), number(row.usedHours), number(row.shortageHours)])) : "";
      const records = report.actionRecords || [];
      const actions = records.length
        ? reportTable([L("Decision", "Décision"), L("First planned", "Première planification"), L("Last changed", "Dernière modification"), L("Changes", "Modifications")], records.map((record) => [escapeHtml(actionLabel(record)), escapeHtml(heure(record.queuedAt)), escapeHtml(heure(record.confirmedAt)), number(record.revisions || 0)]))
        : (report.actions || []).length ? `<ul>${report.actions.map((action) => `<li>${escapeHtml(actionLabel(action))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No action", "Aucune action"))}</p>`;
      const journal = (state.decisionLog || []).filter((entry) => entry.year === report.turn);
      const chronologie = journal.length
        ? reportTable([L("Time", "Heure"), L("What happened", "Ce qui s’est passé"), L("Decision", "Décision")], journal.map((entry) => [escapeHtml(heure(entry.at)), escapeHtml(evenementLabel(entry.event)), escapeHtml(detailEvenement(entry))]))
        : `<p class="notice">${escapeHtml(L("No timeline was recorded for this year.", "Aucune chronologie enregistrée pour cette année."))}</p>`;
      const carbon = report.carbon ? `<div class="summary-grid"><p><span>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</span><strong>${tonnes(report.carbon.total)}</strong></p><p><span>${escapeHtml(L("Per treated case", "Par cas traité"))}</span><strong>${kilograms(report.carbon.perCase)}</strong></p>${Object.entries(report.carbon.bySource).map(([id, value]) => `<p><span>${escapeHtml(sourceLabel(id))}</span><strong>${tonnes(value)}</strong></p>`).join("")}</div>` : `<p>${escapeHtml(L("Carbon detail unavailable for this migrated year.", "Détail carbone indisponible pour cette année migrée."))}</p>`;
      const relations = (() => {
        const so = report.social || {};
        const parts = (obj, labels) => Object.entries(obj || {}).filter(([, v]) => Math.abs(v) >= .1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([id, v]) => `${labels[id] || id} ${v > 0 ? "+" : "−"}${decimal(Math.abs(v), 1)}`).join(" · ") || "—";
        const trustL = { served: L("requests served", "demandes servies"), communication: L("communication", "communication"), access: L("access plan", "plan d’accès"), pace: L("pace", "rythme"), price: L("prices too high", "prix trop élevés"), refused: L("refusals piling up", "refus accumulés"), carbon: L("footprint per case", "empreinte par cas"), dropoff: L("drop-off", "dépôt"), stockouts: L("stock-outs", "ruptures") };
        const climateL = { hr: L("HR strategy", "stratégie RH"), openingHours: L("opening hours", "horaires"), pay: L("pay", "salaires"), overtime: L("overtime", "heures sup."), workload: L("workload", "charge"), pace: L("rushed pace", "rythme pressé"), departure: L("departure", "départ") };
        const snap = report.clinicSnapshot || {};
        const rows = [
          [L("Client trust", "Confiance des clients"), `${number(so.before?.clientTrust)} → ${number(so.after?.clientTrust)}`, parts(so.trustParts, trustL)],
          [L("Staff climate", "Climat de l’équipe"), `${number(so.before?.staffClimate)} → ${number(so.after?.staffClimate)}`, parts(so.climateParts, climateL)],
          [itemLabel(D.socialIndicators.referralSupport), `${number(so.before?.referralSupport)} → ${number(so.after?.referralSupport)}`, L("advanced requests: +1 % per point above 50", "demandes avancées : +1 % par point au-dessus de 50")],
          [itemLabel(D.socialIndicators.communityPressure), `${number(so.before?.communityPressure)} → ${number(so.after?.communityPressure)}`, L("refusals piling up; above 50 it costs trust", "refus accumulés ; au-dessus de 50, coûte de la confiance")],
          [L("Clients", "Clients"), `${number(snap.clients ?? 0)} → ${number(report.next?.clients ?? 0)}`, (so.clientMovement || 0) < 0 ? L("trust below the line: clients leaving", "confiance sous la ligne : des clients partent") : (so.clientMovement || 0) > 0 ? L("word of mouth", "bouche-à-oreille") : "—"],
          [L("Client type", "Type de clients"), escapeHtml(snap.marketFocus ? itemLabel(D.segments[snap.marketFocus]?.name || { en: snap.marketFocus, fr: snap.marketFocus }) : "—"), ""]
        ];
        const signaux = signalLines(report);
        return `<h3>${escapeHtml(L(`Signals from year ${report.turn}`, `Signaux de l’année ${report.turn}`))}</h3>${signaux.length ? reportTable([L("What moved", "Ce qui a bougé"), L("What it does next year", "Ce que cela fait l’an prochain")], signaux.map((l) => [escapeHtml(l.cause), escapeHtml(l.effect)])) : `<p>${escapeHtml(L("Nothing moved enough to matter.", "Rien n’a assez bougé pour compter."))}</p>`}<h3>${escapeHtml(L("Relations around the clinic", "Relations autour de la clinique"))}</h3>${reportTable([L("Indicator", "Indicateur"), L("Start → end of year", "Début → fin d’année"), L("Why it moved", "Pourquoi il a bougé")], rows.map(([a, b, c]) => [escapeHtml(a), b, escapeHtml(c)]))}`;
      })();
      const hasHourTotals = Number.isFinite(report.operational.startVetHours) && Number.isFinite(report.operational.startSupportHours);
      const previousCarbon = reportIndex ? state.history[reportIndex - 1].carbon?.total : state.carbonBaseline?.total;
      const carbonChange = report.carbon && Number.isFinite(previousCarbon) ? report.carbon.total - previousCarbon : null;
      return `<section class="year"><h2>${escapeHtml(L("Year", "Année"))} ${report.turn}</h2><div class="summary-grid"><p><span>${escapeHtml(L("Revenue", "Recettes"))}</span><strong>${money(report.financial.revenue)}</strong></p><p><span>${escapeHtml(L("Variable costs", "Coûts variables"))}</span><strong>${money(report.financial.variableCosts)}</strong></p><p><span>${escapeHtml(L("Payroll and charges", "Salaires et charges"))}</span><strong>${money((report.financial.payroll || 0) + (report.financial.socialCharges || 0))}</strong></p><p><span>${escapeHtml(L("Overtime", "Heures supplémentaires"))}</span><strong>${money(report.financial.overtimeCost || 0)}</strong></p><p><span>${escapeHtml(L("Facilities", "Installations"))}</span><strong>${money(report.financial.facilityCosts)}</strong></p><p><span>${escapeHtml(L("Operating costs", "Coûts d’exploitation"))}</span><strong>${money((report.financial.openingCosts || 0) + (report.financial.dropoffCost || 0) + (report.financial.stockCost || 0) + (report.financial.hrCost || 0) + (report.financial.marketingCost || 0) + (report.financial.sustainabilityCost || 0) + (report.financial.admin || 0))}</strong></p>${report.financial.loanInterest > 0 ? `<p><span>${escapeHtml(L("Loan interest", "Intérêts d’emprunt"))}</span><strong>${money(report.financial.loanInterest)}</strong></p>` : ""}<p><span>${escapeHtml(L("One-time costs", "Coûts ponctuels"))}</span><strong>${money(report.financial.oneTimeCosts)}</strong></p><p><span>${escapeHtml(L("Tax", "Impôt"))}</span><strong>${money(report.financial.tax)}</strong></p><p><span>${escapeHtml(L("Net result", "Résultat net"))}</span><strong>${money(report.financial.netResult)}</strong></p><p><span>${escapeHtml(L("End treasury", "Trésorerie finale"))}</span><strong>${money(report.financial.treasury)}</strong></p></div>${relations}${(report.commitments || []).length ? `<h3>${escapeHtml(L("Promises", "Engagements"))}</h3>${reportTable([L("Who", "Qui"), L("Kept", "Tenu"), L("What follows next year", "Ce qui suit l’an prochain")], report.commitments.map((c) => [escapeHtml(stakeholderLabel(c.id)), c.ok ? "✓" : "✗", escapeHtml(commitmentConsequence(c.id, c.ok, { ...state, history: state.history.filter((r) => r.turn < report.turn) }, report))]))}` : ""}<h3>${escapeHtml(L("Actions and recruitment", "Actions et recrutement"))}</h3>${actions}<h3>${escapeHtml(L("How the year was decided", "Comment l’année a été décidée"))}</h3><p>${escapeHtml(L("Year passed", "Année passée"))} : ${escapeHtml(heure(report.passedAt))}</p>${chronologie}${(report.recruitment || []).map((row) => `<p>${escapeHtml(candidateById(row.candidateId)?.name || row.candidateId)} — ${escapeHtml(row.accepted ? L("accepted", "accepté") : L("refused", "refusé"))}</p>`).join("")}<h3>${escapeHtml(L("Services", "Services"))}</h3>${services}<h3>${escapeHtml(L("Staff hours", "Heures du personnel"))}</h3>${hasHourTotals ? `<p>${escapeHtml(L("Veterinary hours available / used", "Heures vétérinaires disponibles / utilisées"))}: ${number(report.operational.startVetHours)} / ${number(report.operational.startVetHours - report.operational.remainingVetHours)} · ${escapeHtml(L("Support hours available / used", "Heures de soutien disponibles / utilisées"))}: ${number(report.operational.startSupportHours)} / ${number(report.operational.startSupportHours - report.operational.remainingSupportHours)}</p>` : `<p class="notice">${escapeHtml(L("Detailed hour totals were not recorded for this migrated year.", "Les totaux d’heures détaillés n’ont pas été enregistrés pour cette année migrée."))}</p>`}${staffTable}${hours}<h3>${escapeHtml(L("People and clients", "Équipe et clients"))}</h3><p>${escapeHtml(L("Staff climate", "Climat de l’équipe"))}: ${number(report.social?.after?.staffClimate || 0)} · ${escapeHtml(L("Client trust", "Confiance des clients"))}: ${number(report.social?.after?.clientTrust || 0)}</p><h3>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</h3>${carbon}${carbonChange === null ? "" : `<p><strong>${escapeHtml(L("Annual change", "Évolution annuelle"))}:</strong> ${carbonChange > 0 ? "+" : ""}${tonnes(carbonChange)}</p>`}</section>`;
    }).join("");
    const archiveSection = (state.runArchive || []).length ? `<section class="year"><h2>${escapeHtml(L("Reloaded runs", "Essais rechargés"))}</h2><p>${escapeHtml(L("Each run below was replaced when a saved clinic was loaded. They are kept so that a run without a decision can be compared with the run that took it.", "Chaque essai ci-dessous a été remplacé au chargement d’une clinique enregistrée. Ils sont gardés pour comparer un essai sans une décision à l’essai qui l’a prise."))}</p>${state.runArchive.map((essai, index) => `<h3>${escapeHtml(L("Run", "Essai"))} ${index + 1} · ${escapeHtml(L("replaced at year", "remplacé à l’année"))} ${essai.yearReached}</h3>${reportTable([L("Year", "Année"), L("Net result", "Résultat net"), L("Treasury", "Trésorerie"), L("Cases served", "Cas traités"), L("Main constraint", "Contrainte principale"), L("Actions", "Actions")], essai.years.map((row) => [String(row.year), money(row.netResult), money(row.treasury), number(row.served), escapeHtml(blockerText(row.constraintId)), escapeHtml((row.actionLabels || []).join(" · ") || L("No action", "Aucune action"))]))}`).join("")}</section>` : "";
    return `<!doctype html><html lang="${state.language}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;color:#17201d;margin:32px;line-height:1.4}header{border-bottom:3px solid #146c5a;margin-bottom:24px}.print{position:fixed;right:24px;top:18px;padding:10px 16px}.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.summary-grid p{border:1px solid #ccd8d4;padding:10px;margin:0}.summary-grid span{display:block;font-size:12px}.summary-grid strong{font-size:16px}table{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:12px}th,td{text-align:left;border:1px solid #ccd8d4;padding:7px;vertical-align:top}th{background:#eef5f2}.year{break-before:page}.notice{font-style:italic}@media(max-width:700px){.summary-grid{grid-template-columns:1fr}table{font-size:10px}}@media print{body{margin:10mm}.print{display:none}.year:first-of-type{break-before:auto}}</style></head><body><button class="print" onclick="window.print()">${escapeHtml(L("Print / Save as PDF", "Imprimer / Enregistrer en PDF"))}</button><header><h1>${escapeHtml(title)}</h1><p><strong>${escapeHtml(L("Scenario", "Scénario"))}:</strong> ${escapeHtml(itemLabel(D.scenarios[state.scenarioId].name))}<br><strong>${escapeHtml(L("Team code", "Code d’équipe"))}:</strong> ${escapeHtml(teamCode)}<br><strong>${escapeHtml(L("Exported", "Exporté"))}:</strong> ${escapeHtml(new Intl.DateTimeFormat(locale(), { dateStyle: "long", timeStyle: "short" }).format(new Date()))}</p></header>${(() => { const r = rulesSummary(state.modelRules); return `<section><h2>${escapeHtml(L("Rules of the model", "Règles du modèle"))}</h2>${r.length ? `<p>${escapeHtml(L(`Played with changed rules: « ${state.modelRules.nom || "untitled"} ».`, `Partie jouée avec des règles modifiées : « ${state.modelRules.nom || "sans nom"} ».`))}</p>${reportTable([L("Section", "Section"), L("Setting", "Réglage"), L("Original", "Origine"), L("Used", "Utilisé")], r.map((x) => [escapeHtml(itemLabel((ATELIER_SECTIONS.find(([id]) => id === x.section) || [, { en: x.section, fr: x.section }])[1])), escapeHtml(x.nom), escapeHtml(x.texteOrigine), escapeHtml(x.texteValeur)]))}` : `<p>${escapeHtml(L("Played with the original rules.", "Partie jouée avec les règles d’origine."))}</p>`}</section>`; })()}<section><h2>${escapeHtml(L("Rules and goals", "Règles et objectifs"))}</h2><p>${escapeHtml(L("Action limit", "Limite d’actions"))}: ${escapeHtml(state.rules.unlimited ? L("Unlimited", "Illimitée") : state.rules.actionLimit)} · ${escapeHtml(L("Target year", "Année cible"))}: ${state.rules.targetYear} · ${escapeHtml(L("Bankruptcy threshold", "Seuil de faillite"))}: ${money(state.rules.bankruptcyThreshold)}</p><ul>${goals.map((goal) => `<li>${goal.ok ? "✓" : "○"} ${escapeHtml(itemLabel(goal.label))}: ${escapeHtml(goal.display)}</li>`).join("")}</ul><h2>${escapeHtml(L("Game setup", "Paramétrage de la partie"))}</h2>${reportTable([L("Setting", "Paramètre"), L("Value", "Valeur")], setupSummaryRows().map(([label, value]) => [escapeHtml(label), escapeHtml(value)]))}${setupLines.length ? `<ul>${setupLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No setting changes or cash adjustments.", "Aucun changement de paramètre ni ajustement de trésorerie."))}</p>`}<h2>${escapeHtml(L("Starting versus current clinic", "Clinique de départ et actuelle"))}</h2>${reportTable([L("Measure", "Mesure"), L("Starting", "Départ"), L("Current", "Actuel")], [[escapeHtml(L("Treasury", "Trésorerie")), money(start.treasury), money(state.treasury)], [escapeHtml(L("Clients", "Clients")), number(start.clients), number(state.clients)], [escapeHtml(L("Staff", "Personnel")), number(start.staff.length), number(state.staff.length)], [escapeHtml(L("Active services", "Services actifs")), number(Object.values(start.services).filter((service) => service.active).length), number(Object.values(state.services).filter((service) => service.active).length)], [escapeHtml(L("Carbon footprint", "Empreinte carbone")), state.carbonBaseline ? tonnes(state.carbonBaseline.total) : "—", state.history.at(-1)?.carbon ? tonnes(state.history.at(-1).carbon.total) : "—"]])}</section>${yearSections || `<p>${escapeHtml(L("No completed year yet.", "Aucune année terminée."))}</p>`}${archiveSection}<footer><p>${escapeHtml(L("Carbon method", "Méthode carbone"))}: ${escapeHtml(D.carbonModel.version)}. ${escapeHtml(L("Boundary: building electricity and heating, anaesthetic gases, waste treatment, and client car travel. Service activity values are simulation assumptions.", "Périmètre : électricité et chauffage du bâtiment, gaz anesthésiques, traitement des déchets et déplacements automobiles des clients. Les valeurs d’activité des services sont des hypothèses de simulation."))}</p></footer></body></html>`;
  }

  function printReport() {
    saveState(); syncPlayerTeam();
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) { toast(L("Allow pop-ups to open the printable report.", "Autorisez les fenêtres contextuelles pour ouvrir le rapport imprimable."), "warn"); return; }
    reportWindow.document.open();
    reportWindow.document.write(buildPrintableReportHtml());
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.setTimeout(() => reportWindow.print(), 150);
  }

  function resetScenario(scenarioId = state.scenarioId) {
    const language = state.language;
    const changingScenario = scenarioId !== state.scenarioId;
    // What the instructor set follows the team across a restart: the rules of play, the forecast
    // precision, the class code (the demand seed — the same class must meet the same luck again),
    // and the team code, without which the export stops being attributable.
    // The starting cash does not follow into a *different* scenario: each scenario's opening
    // position is part of its design, and clearing customTreasury makes line 129 restore it.
    const carriedSetup = changingScenario ? { ...state.setup, customTreasury: false } : state.setup;
    const carriedRules = { ...state.rules };
    const teamCode = state.playerTeam?.teamCode || "";
    state = initialState(scenarioId, language, carriedSetup, carriedRules);
    state.playerTeam = { teamCode };
    ui.allocationDrafts = {};
    ui.decisionDrafts = {};
    ui.settingsDraft = null;
    ui.settingsOpen = false;
    ui.settingsError = "";
    saveState();
    render();
  }

  // Four copies of "close" had drifted apart — one forgot the selected service, none of them put
  // the student back where they started, and each one pushed a history entry, so Back re-opened the
  // drawer that had just been closed. One function now, and it replaces the entry instead of adding
  // one: closing is a return, not a step forward.
  // The confirmation screen takes over the whole drawer but had no history entry, so browser Back
  // from it left the drawer entirely instead of returning to the choices — while the in-app Cancel
  // button did the right thing. A duplicate entry at the same URL gives Back something to pop; the
  // popstate handler below turns that pop into "back to choices".
  function pushConfirmStep() {
    if (typeof location === "undefined" || !window.history?.pushState) return;
    window.history.pushState({ confirm: true }, "", location.hash || routeFor());
  }

  function closeDrawer() {
    const focus = ui.lastFocus;
    const stack = [...(ui.originStack || [])];
    const origin = stack.pop() || null;
    ui.originStack = stack;
    ui.returnLabel = origin ? ui.returnLabel : null;
    ui.focusItem = null;
    if (origin) {
      applyRoute(parseRoute(origin));
    } else {
      ui.drawer = null;
      ui.drawerContext = null;
      ui.selectedServiceId = null;
    }
    ui.confirm = null;
    ui.replaceRoute = true;
    saveState();
    render();
    window.setTimeout(() => {
      if (!focus) return;
      const selector = `[data-open-drawer="${CSS.escape(focus.drawer)}"]${focus.context ? `[data-context="${CSS.escape(focus.context)}"]` : ""}`;
      document.querySelector(selector)?.focus();
    }, 0);
  }

  document.addEventListener("click", (event) => {
    if (event.target.classList?.contains("drawer-backdrop")) {
      closeDrawer();
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.atelierOpen !== undefined) {
      const champ = document.querySelector("[data-atelier-code]");
      if (atelierFingerprint(champ?.value) !== D.atelierCodeHash) { toast(L("That code does not open the workshop.", "Ce code n’ouvre pas l’atelier."), "warn"); return; }
      ui.atelierUnlocked = true; ui.rulesDraft = null; ui.atelierView = true; ui.atelierSection = "regles"; ui.drawer = null;
      render();
      return;
    }
    if (button.dataset.atelierShow !== undefined && ui.atelierUnlocked) { ui.rulesDraft = null; ui.atelierView = true; ui.drawer = null; render(); return; }
    if (button.dataset.atelierClose !== undefined) { ui.atelierView = false; render(); return; }
    if (button.dataset.atelierSection !== undefined) { ui.atelierSection = button.dataset.atelierSection; ui.atelierSearch = ""; render(); return; }
    if (button.dataset.ruleReset !== undefined && ui.rulesDraft) { delete ui.rulesDraft.valeurs[button.dataset.ruleReset]; keepAtelierScroll(); render(); return; }
    if (button.dataset.rulesResetAll !== undefined && ui.rulesDraft) { ui.rulesDraft = { nom: ui.rulesDraft.nom, valeurs: {}, noms: {}, delies: {}, monnaie: null }; keepAtelierScroll(); render(); return; }
    if (button.dataset.rulesDownload !== undefined) { telechargerRegles(); return; }
    if (button.dataset.ruleConvert !== undefined && ui.rulesDraft) {
      const facteur = ui.rulesDraft.monnaie?.facteur ?? 1;
      Object.values(RULE_SETTINGS).filter((def) => def.money).forEach((def) => {
        const v = RULE_DEFAULTS[def.chemin] * facteur;
        const arrondi = Math.abs(v) >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
        if (Math.abs(arrondi - RULE_DEFAULTS[def.chemin]) > 1e-9) ui.rulesDraft.valeurs[def.chemin] = Math.min(def.max, Math.max(def.min, arrondi)); else delete ui.rulesDraft.valeurs[def.chemin];
      });
      keepAtelierScroll(); render();
      toast(L(`Every amount converted (×${decimal(facteur, 2)}).`, `Tous les montants convertis (×${decimal(facteur, 2)}).`), "good");
      return;
    }
    if (button.dataset.rulesApply !== undefined && ui.rulesDraft) {
      const clean = appliquerRegles(ui.rulesDraft, "apply");
      keepAtelierScroll();
      render();
      toast(clean ? L(`Rules applied to your game: ${rulesSummary(clean).length} changes.`, `Règles appliquées à votre partie : ${rulesSummary(clean).length} changements.`) : L("Back to the original rules.", "Retour aux règles d’origine."), "good");
      return;
    }
    if (button.dataset.domain) { saveState(); state.domain = button.dataset.domain; ui.drawer = null; ui.drawerContext = null; ui.selectedServiceId = null; ui.confirm = null; ui.originStack = []; saveState(); render(); return; }
    if (button.dataset.openDrawer) {
      // On a drawer-to-drawer jump the breadcrumb IS the close button, so it must name where
      // closing lands. From a room opened by "Address this" it read "Care & facilities" while
      // closing returned to the service — confirming the wrong mental model exactly when it
      // needed correcting.
      ui.returnLabel = ui.drawer ? (ui.drawer === "services" && ui.selectedServiceId ? serviceName(ui.selectedServiceId) : drawerTitleFor(ui.drawer)) : null;
      ui.focusItem = button.dataset.focus || null;
      saveState(); openDrawer(button.dataset.openDrawer, button.dataset.context || null, button.dataset.service || button.dataset.tab || null);
      return;
    }
    if (button.dataset.closeDrawer !== undefined) {
      closeDrawer();
      return;
    }
    if (button.dataset.drawerContext !== undefined) { ui.drawerContext = button.dataset.drawerContext || null; ui.selectedServiceId = null; ui.confirm = null; render(); return; }
    if (button.dataset.selectService) {
      const id = button.dataset.selectService;
      ui.selectedServiceId = ui.selectedServiceId === id ? null : id;
      rememberDrawer(`[data-select-service="${CSS.escape(id)}"]`);
      render();
      return;
    }
    if (button.dataset.addKey) {
      const key = button.dataset.addKey;
      const payload = JSON.parse(decodeURIComponent(button.dataset.addPayload));
      rememberDrawer(`[data-remove-action="${CSS.escape(key)}"]`);
      queueAction(key, payload);
      if (state.pending[key]) toast(L(`Added to plan · ${countedActions().length}/${state.rules.unlimited ? "unlimited" : state.rules.actionLimit}`, `Ajouté au plan · ${countedActions().length}/${state.rules.unlimited ? "illimité" : state.rules.actionLimit}`), "good");
      return;
    }
    if (button.dataset.personTab) { ui.personTab = button.dataset.personTab; ui.confirm = null; render(); return; }
    if (button.dataset.dismissSetup !== undefined) { state.uiPreferences.setupBannerDismissed = true; saveState(); render(); return; }
    if (button.dataset.toggleClosed !== undefined) { ui.showClosedServices = !ui.showClosedServices; render(); return; }
    if (button.dataset.cancelPass !== undefined) { ui.passCheck = false; render(); return; }
    if (button.dataset.confirmPass !== undefined) { ui.passCheck = false; resolveTurn(); return; }
    if (button.dataset.clearService !== undefined) { ui.selectedServiceId = null; render(); return; }
    if (button.dataset.dismissGuide !== undefined) { state.uiPreferences.beginnerGuideDismissed = true; ui.reopenBeginnerGuide = false; saveState(); render(); return; }
    if (button.dataset.reopenGuide !== undefined) { ui.reopenBeginnerGuide = true; state.helpOpen = false; state.domain = "overview"; saveState(); render(); return; }
    if (button.dataset.cancelReview !== undefined) { ui.confirm = null; ui.restore = ui.returnFocus; if (window.history?.state?.confirm) window.history.back(); else render(); return; }
    if (button.dataset.confirmReview !== undefined && ui.confirm) {
      const { key, payload } = ui.confirm;
      if (!state.pending[key] && !isFreeAction(payload) && countedActions().length >= actionLimit()) {
        toast(`${t("forecast.limitReached")} ${t("forecast.removeHint")}`, "warn");
        return;
      }
      if (payload.kind === "staff-allocation") ui.allocationDrafts[payload.targetId] = clone(payload.value.allocations);
      ui.confirm = null;
      ui.restore = ui.returnFocus;
      ui.replaceRoute = true;
      if (window.history?.state?.confirm && window.history.replaceState) window.history.replaceState(null, "", location.hash || routeFor());
      queueAction(key, payload);
      toast(L(`Added to plan · ${pendingActions().length}/${state.rules.unlimited ? L("unlimited", "illimité") : state.rules.actionLimit}`, `Ajouté au plan · ${pendingActions().length}/${state.rules.unlimited ? "illimité" : state.rules.actionLimit}`), "good");
      return;
    }
    if (button.dataset.allocationAdjust) {
      const person = plannedState().staff.find((item) => item.id === ui.drawerContext);
      if (!person) return;
      const draft = allocationDraftFor(person);
      const index = Number(button.dataset.allocationIndex);
      if (!draft[index]) return;
      const others = allocationTotal(draft) - draft[index].share;
      // A step moves the share by its own size and nothing else. Re-rounding the base to the 5%
      // grid here destroyed a typed number of hours: 90 h became 142 h on one press of +, a jump
      // of 52 h where the button promises 71.
      draft[index].share = stepShare(draft[index].share, Number(button.dataset.allocationAdjust), others, availableHoursFor(person.id));
      rememberDrawer(`[data-allocation-adjust="${button.dataset.allocationAdjust}"][data-allocation-index="${index}"]`);
      render();
      return;
    }
    if (button.dataset.allocationFill) {
      const person = plannedState().staff.find((item) => item.id === ui.drawerContext);
      if (!person) return;
      const draft = allocationDraftFor(person);
      const index = Number(button.dataset.allocationFill);
      if (!draft[index]) return;
      const others = allocationTotal(draft) - draft[index].share;
      const ceiling = allocationCeiling(others);
      // Fill to exactly 100% of available hours rather than the 1.3 ceiling, so this never buys overtime.
      draft[index].share = snapShareToHours(clamp(Math.min(1 - others, ceiling), 0, ceiling), availableHoursFor(person.id));
      rememberDrawer(`[data-allocation-index="${index}"]`);
      render();
      return;
    }
    if (button.dataset.removeAllocation !== undefined) {
      const person = plannedState().staff.find((item) => item.id === ui.drawerContext);
      if (!person) return;
      const draft = allocationDraftFor(person);
      if (draft.length > 1) draft.splice(Number(button.dataset.removeAllocation), 1);
      rememberDrawer("[data-add-allocation]"); render(); return;
    }
    if (button.dataset.addAllocation !== undefined) {
      const person = plannedState().staff.find((item) => item.id === ui.drawerContext);
      const serviceId = document.querySelector("[data-allocation-service]")?.value;
      if (!person || !serviceId) return;
      const draft = allocationDraftFor(person);
      if (!draft.some((row) => row.serviceId === serviceId)) draft.push({ serviceId, share: 0 });
      rememberDrawer(`[data-allocation-index="${draft.length - 1}"]`); render(); return;
    }
    if (button.dataset.reviewAllocation) {
      const person = plannedState().staff.find((item) => item.id === button.dataset.reviewAllocation);
      if (!person) return;
      const allocations = allocationDraftFor(person).filter((row) => row.share > 0);
      if (!validAllocations(person, allocations)) return;
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-allocation="${CSS.escape(person.id)}"]` };
      ui.confirm = { key: `staff-allocation:${person.id}`, payload: { kind: "staff-allocation", targetId: person.id, value: { allocations: clone(allocations) } } };
      pushConfirmStep();
      render(); return;
    }
    if (button.dataset.adjustCash !== undefined) {
      const amount = Number(document.querySelector("[data-cash-amount]")?.value || 0);
      const reason = document.querySelector("[data-cash-reason]")?.value || "other";
      if (adjustCash(amount, reason)) toast(L(`Cash adjusted by ${signed(amount, "money")}.`, `Trésorerie ajustée de ${signed(amount, "money")}.`), "good");
      else toast(L("Enter a non-zero amount.", "Saisissez un montant non nul."), "warn");
      ui.settingsOpen = true;
      render();
      return;
    }
    if (button.dataset.saveSettings !== undefined) {
      const draft = ui.settingsDraft || {};
      const unlimited = draft.actionLimit === "unlimited";
      const limit = unlimited ? state.rules.actionLimit : Number(draft.actionLimit);
      const targetYear = Number(draft.targetYear);
      const threshold = Number(draft.bankruptcyThreshold);
      const startingTreasury = Number(draft.startingTreasury ?? state.setup.startingTreasury);
      const forecastMode = ["exact", "ranges", "costs"].includes(draft.forecastPrecision) ? draft.forecastPrecision : state.setup.forecastPrecision;
      const classCode = String(draft.classCode ?? state.setup.classCode ?? "").trim().slice(0, 24);
      const studyGroup = String(draft.studyGroup ?? state.setup.studyGroup ?? "").trim().slice(0, 24);
      if (!unlimited && limit < pendingActions().length) ui.settingsError = L(`The limit cannot be below the ${pendingActions().length} actions already planned.`, `La limite ne peut pas être inférieure aux ${pendingActions().length} actions déjà planifiées.`);
      else if (!Number.isInteger(targetYear) || targetYear < state.year || targetYear > 12) ui.settingsError = L(`Choose a target year from Year ${state.year} to Year 12.`, `Choisissez une année cible entre l’année ${state.year} et l’année 12.`);
      else if (!Number.isFinite(threshold) || threshold < -1000000 || threshold > 0) ui.settingsError = L(`Choose a bankruptcy threshold between ${money(-1000000)} and ${money(0)}.`, `Choisissez un seuil de faillite entre ${money(-1000000)} et ${money(0)}.`);
      else if (!state.history.length && (!Number.isFinite(startingTreasury) || startingTreasury < 0 || startingTreasury > 2000000)) ui.settingsError = L(`Choose a starting treasury between ${money(0)} and ${money(2000000)}.`, `Choisissez une trésorerie de départ entre ${money(0)} et ${money(2000000)}.`);
      else {
        const snapshot = () => ({ actionLimit: state.rules.unlimited ? "unlimited" : state.rules.actionLimit, targetYear: state.rules.targetYear, bankruptcyThreshold: state.rules.bankruptcyThreshold, startingTreasury: state.setup.startingTreasury, forecastPrecision: state.setup.forecastPrecision, classCode: state.setup.classCode || "", studyGroup: state.setup.studyGroup || "" });
        const previous = snapshot();
        state.rules = { ...state.rules, unlimited, actionLimit: clamp(limit, 1, 12), targetYear, bankruptcyThreshold: threshold };
        // Starting cash can only change before Year 1 is played; cash already adjusted is kept.
        if (!state.history.length && startingTreasury !== state.setup.startingTreasury) {
          state.treasury += startingTreasury - state.setup.startingTreasury;
          state.setup = { ...state.setup, startingTreasury, customTreasury: true };
        }
        state.setup = { ...state.setup, forecastPrecision: forecastMode, classCode, studyGroup };
        const current = snapshot();
        const changes = Object.keys(current).filter((field) => String(current[field]) !== String(previous[field])).map((field) => ({ field, from: previous[field], to: current[field] }));
        if (changes.length) state.setupLog.push({ year: state.year, at: new Date().toISOString(), changes });
        ui.settingsError = ""; saveState(); toast(L("Settings saved.", "Paramètres enregistrés."), "good");
      }
      ui.settingsOpen = true;
      const scroll = window.scrollY;
      render(); window.setTimeout(() => { window.scrollTo(0, scroll); document.querySelector("[data-save-settings]")?.focus(); }, 0); return;
    }
    if (button.dataset.viewApplicants !== undefined) {
      const role = document.querySelector("[data-vacancy-role]")?.value || "vet";
      const skills = [...document.querySelectorAll("[data-vacancy-skill]:checked")].slice(0, 2).map((node) => node.dataset.vacancySkill);
      const budget = Number(document.querySelector("[data-vacancy-budget]")?.value || 0);
      ui.vacancy = { role, skills, budget };
      ui.drawerStep = 2;
      render();
      return;
    }
    if (button.dataset.editVacancy !== undefined) { ui.drawerStep = 1; render(); return; }
    if (button.dataset.moreApplicants !== undefined) { ui.candidateLimit += 4; render(); return; }
    if (button.dataset.reviewHire) {
      const candidate = candidateById(button.dataset.reviewHire);
      // Anything below the expected salary is always refused while the posting fee is still spent,
      // so the offer is raised to the threshold the card already shows rather than sent to fail.
      const offeredSalary = Math.max(candidate.expectedSalary, Number(document.querySelector(`[data-applicant-offer="${CSS.escape(candidate.id)}"]`)?.value || 0));
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-hire="${CSS.escape(candidate.id)}"]` };
      ui.confirm = { key: `hire:${candidate.id}`, payload: { kind: "hire", targetId: candidate.id, value: { role: ui.vacancy.role, desiredSkills: ui.vacancy.skills, salaryBudget: ui.vacancy.budget, offeredSalary } } };
      pushConfirmStep();
      render();
      return;
    }
    if (button.dataset.reviewSalary) {
      const offered = Number(document.querySelector("[data-draft-salary]")?.value || 0);
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-salary="${CSS.escape(button.dataset.reviewSalary)}"]` };
      ui.confirm = { key: `salary:${button.dataset.reviewSalary}`, payload: { kind: "salary", targetId: button.dataset.reviewSalary, value: offered } };
      pushConfirmStep();
      render();
      return;
    }
    if (button.dataset.reviewPrice) {
      const id = button.dataset.reviewPrice;
      const value = Number(document.querySelector(`[data-draft-price="${CSS.escape(id)}"]`)?.value || 0);
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-price="${CSS.escape(id)}"]` };
      ui.confirm = { key: `service:${id}:price`, payload: { kind: "price", targetId: id, value } };
      pushConfirmStep();
      render();
      return;
    }
    if (button.dataset.language) { saveState(); syncPlayerTeam(); state.language = button.dataset.language; saveState(); render(); toast(t("toast.languageChanged")); return; }
    if (button.dataset.help !== undefined) { state.helpOpen = true; saveState(); render(); return; }
    if (button.dataset.closeHelp !== undefined) { state.helpOpen = false; saveState(); render(); return; }
    if (button.dataset.removeAction) { rememberDrawer(`[data-add-key="${CSS.escape(button.dataset.removeAction)}"]`); removeAction(button.dataset.removeAction); return; }
    if (button.dataset.passYear !== undefined) { saveState(); ui.drawer = null; ui.confirm = null; ui.passCheck = true; render(); return; }
    if (button.dataset.export !== undefined) { saveState(); ui.lastFocus = { drawer: "export", context: "" }; ui.drawer = "export"; ui.drawerContext = null; ui.confirm = null; ui.autoFocusDrawer = true; render(); return; }
    if (button.dataset.sauverClinique !== undefined) { sauvegarderClinique(); return; }
    if (button.dataset.downloadJson !== undefined) { downloadJson(); return; }
    if (button.dataset.printReport !== undefined) { printReport(); return; }
    if (button.dataset.undoYear !== undefined) { const year = state.undo?.year; if (year && window.confirm(t("toast.undoConfirm", { year }))) { if (undoYear()) toast(t("toast.yearUndone", { year }), "good"); } return; }
    if (button.dataset.reset !== undefined) { if (window.confirm(t("toast.resetConfirm"))) resetScenario(); return; }
    if (button.dataset.scenario) { const id = button.dataset.scenario; if (window.confirm(t("toast.scenarioConfirm", { scenario: itemLabel(D.scenarios[id].name) }))) resetScenario(id); return; }
    if (button.dataset.continue !== undefined) { state.endState = null; state.sandboxMode = true; logDecision("sandbox", `year:${state.year}`); saveState(); render(); return; }
    if (button.dataset.toggleService) { const id = button.dataset.toggleService; const active = plannedState().services[id].active; queueAction(`service:${id}:active`, { kind: "toggle-service", targetId: id, value: !active }); return; }
    if (button.dataset.loan) { if (plannedState().finance.loan) toast(t("toast.loanExists"), "warn"); else queueAction("finance:loan", { kind: "loan", value: Number(button.dataset.loan) }); return; }
    if (button.dataset.repayLoan !== undefined) { if (!plannedState().finance.loan) toast(t("toast.noLoan"), "warn"); else queueAction("finance:loan", { kind: "repay-loan" }); return; }
    if (button.dataset.hrStrategy) { queueAction("hr:strategy", { kind: "hr-strategy", targetId: button.dataset.hrStrategy }); return; }
    if (button.dataset.hire) { const input = document.querySelector(`[data-offer-input="${CSS.escape(button.dataset.hire)}"]`); queueAction(`hire:${button.dataset.hire}`, { kind: "hire", targetId: button.dataset.hire, value: Number(input?.value || 0) }); return; }
    if (button.dataset.training) { queueAction(`training:${button.dataset.training}`, { kind: "training", targetId: button.dataset.training }); return; }
    if (button.dataset.opening) { const id = button.dataset.opening; queueAction(`opening:${id}`, { kind: "opening-period", targetId: id, value: !plannedState().operations.openingPeriods[id] }); return; }
    if (button.dataset.dropoff !== undefined) { queueAction("operations:dropoff", { kind: "dropoff", value: !plannedState().operations.dropoff }); return; }
    if (button.dataset.stock) { queueAction("operations:stock", { kind: "stock-strategy", targetId: button.dataset.stock }); return; }
    if (button.dataset.roomAdd) { queueAction(`room:${button.dataset.roomAdd}`, { kind: "room-add", targetId: button.dataset.roomAdd }); return; }
    if (button.dataset.roomClose) { queueAction(`room:${button.dataset.roomClose}`, { kind: "room-close", targetId: button.dataset.roomClose }); return; }
    if (button.dataset.equipment) { queueAction(`equipment:${button.dataset.equipment}:${button.dataset.mode}`, { kind: "equipment-acquire", targetId: button.dataset.equipment, mode: button.dataset.mode }); return; }
    if (button.dataset.equipmentRemove) { queueAction(`equipment:${button.dataset.equipmentRemove}:${button.dataset.mode}`, { kind: "equipment-remove", targetId: button.dataset.equipmentRemove, mode: button.dataset.mode }); return; }
    if (button.dataset.marketFocus) { queueAction("market:focus", { kind: "market-focus", targetId: button.dataset.marketFocus }); return; }
    if (button.dataset.location) { queueAction("location:sector", { kind: "location", targetId: button.dataset.location }); return; }
    if (button.dataset.parking !== undefined) { queueAction("location:parking", { kind: "parking", value: !plannedState().location.parking }); return; }
    if (button.dataset.marketing) { queueAction(`marketing:${button.dataset.marketing}`, { kind: "marketing-strategy", strategy: button.dataset.marketing, targetId: button.dataset.level }); return; }
    if (button.dataset.socialAction) { queueAction(`social:${button.dataset.socialAction}`, { kind: "social-action", targetId: button.dataset.socialAction }); return; }
    if (button.dataset.saveReflection) {
      saveState(); toast(t("results.savedReflection"), "good");
    }
  });

  document.addEventListener("toggle", (event) => {
    const pli = event.target?.dataset?.pli;
    if (pli && Object.prototype.hasOwnProperty.call(ui, pli)) ui[pli] = event.target.open;
  }, true);

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.ruleCell !== undefined && ui.rulesDraft) {
      const def = RULE_SETTINGS[input.dataset.ruleCell];
      const v = def ? ruleTaken(def, input.value) : null;
      if (v == null) { toast(L("Type a number.", "Tapez un nombre."), "warn"); render(); return; }
      if (Math.abs(v - RULE_DEFAULTS[def.chemin]) < 1e-9) delete ui.rulesDraft.valeurs[def.chemin]; else ui.rulesDraft.valeurs[def.chemin] = Math.min(def.max, Math.max(def.min, v));
      keepAtelierScroll(); render(); return;
    }
    if (input.dataset.ruleLink !== undefined && ui.rulesDraft) { if (input.checked) delete ui.rulesDraft.delies[input.dataset.ruleLink]; else ui.rulesDraft.delies[input.dataset.ruleLink] = true; keepAtelierScroll(); render(); return; }
    if (input.dataset.ruleCurrency !== undefined && ui.rulesDraft) { ui.rulesDraft.monnaie = { code: input.value, facteur: ui.rulesDraft.monnaie?.facteur ?? 1 }; keepAtelierScroll(); render(); return; }
    if (input.dataset.ruleFactor !== undefined && ui.rulesDraft) { const f = Number(String(input.value).replace(",", ".")); ui.rulesDraft.monnaie = { code: ui.rulesDraft.monnaie?.code || "EUR", facteur: Number.isFinite(f) && f > 0 ? Math.min(5, Math.max(.2, f)) : 1 }; keepAtelierScroll(); render(); return; }
    if ((input.dataset.nameFr !== undefined || input.dataset.nameEn !== undefined || input.dataset.nameSingle !== undefined) && ui.rulesDraft) {
      const chemin = input.dataset.nameFr ?? input.dataset.nameEn ?? input.dataset.nameSingle;
      const origine = NAME_DEFAULTS[chemin];
      if (input.dataset.nameSingle !== undefined) ui.rulesDraft.noms[chemin] = input.value;
      else { const cur = ui.rulesDraft.noms[chemin] || { ...origine }; ui.rulesDraft.noms[chemin] = { ...cur, [input.dataset.nameFr !== undefined ? "fr" : "en"]: input.value }; }
      keepAtelierScroll(); render(); return;
    }
    if (input.dataset.chargerRegles !== undefined) {
      const fichier = input.files && input.files[0];
      if (!fichier) return;
      const lecteur = new FileReader();
      lecteur.onload = () => { chargerRegles(String(lecteur.result)); };
      lecteur.onerror = () => { toast(L("That file could not be read.", "Ce fichier n’a pas pu être lu."), "warn"); };
      lecteur.readAsText(fichier);
      input.value = "";
      return;
    }
    if (input.dataset.chargerClinique !== undefined) {
      const fichier = input.files && input.files[0];
      if (!fichier) return;
      const lecteur = new FileReader();
      lecteur.onload = () => { chargerClinique(String(lecteur.result)); };
      lecteur.onerror = () => { toast(L("That file could not be read.", "Ce fichier n’a pas pu être lu."), "warn"); };
      lecteur.readAsText(fichier);
      input.value = "";
      return;
    }
    if (input.dataset.prediction !== undefined) { ui.predictionDraft = input.value || null; return; }
    if (input.dataset.vacancyRole !== undefined) {
      const allowed = input.value === "vet" ? ["general", "ultrasound", "dentistry", "orthopedics"] : ["preventive", "surgery", "lab", "imaging", "emergency", "inpatient", "pharmacy", "animalCare"];
      ui.vacancy = { ...ui.vacancy, role: input.value, skills: ui.vacancy.skills.filter((skill) => allowed.includes(skill)) };
      render();
      return;
    }
    if (input.dataset.vacancySkill !== undefined) {
      const checked = [...document.querySelectorAll("[data-vacancy-skill]:checked")];
      if (checked.length > 2) { input.checked = false; toast(L("Choose no more than two skills.", "Choisissez au maximum deux compétences."), "warn"); }
      ui.vacancy.skills = [...document.querySelectorAll("[data-vacancy-skill]:checked")].slice(0, 2).map((node) => node.dataset.vacancySkill);
      return;
    }
    if (input.dataset.settingsField) { ui.settingsDraft = { ...(ui.settingsDraft || {}), [input.dataset.settingsField]: input.value }; return; }
    if (input.dataset.price) { queueAction(`service:${input.dataset.price}:price`, { kind: "price", targetId: input.dataset.price, value: Number(input.value) }); return; }
    if (input.dataset.salary) { queueAction(`salary:${input.dataset.salary}`, { kind: "salary", targetId: input.dataset.salary, value: Number(input.value) }); return; }
  });

  document.addEventListener("input", (event) => {
    const input = event.target;
    // Hours commit as they are typed. On "change" they committed only on blur, so the field showed
    // one number while the total, the bar, the caption and the live impact underneath still showed
    // the old one — the panel contradicting itself with nothing to say which figure was current.
    if (input.dataset.allocationHours !== undefined) {
      const person = plannedState().staff.find((item) => item.id === ui.drawerContext);
      if (!person) return;
      const draft = allocationDraftFor(person);
      const index = Number(input.dataset.allocationHours);
      if (!draft[index]) return;
      const disponibles = availableHoursFor(person.id);
      if (!(disponibles > 0)) return;
      const autres = allocationTotal(draft) - draft[index].share;
      // Only digits reach the model; anything else is dropped, and the caret moves back by whatever
      // was removed so the next keystroke lands where the writer expects.
      const brut = String(input.value || "");
      const chiffres = brut.replace(/[^0-9]/g, "");
      const caret = Math.max(0, (input.selectionStart ?? brut.length) - (brut.length - chiffres.length));
      draft[index].share = shareFromHours(chiffres, autres, disponibles);
      ui.allocationDrafts[person.id] = draft;
      rememberDrawer(`[data-allocation-hours="${index}"]`, { value: chiffres, caret });
      render();
      return;
    }
    if (input.dataset.settingsField) { ui.settingsDraft = { ...(ui.settingsDraft || {}), [input.dataset.settingsField]: input.value }; return; }
    if (input.dataset.rule !== undefined && ui.rulesDraft) { ui.rulesDraft.valeurs[input.dataset.rule] = Number(input.value); keepAtelierScroll(`[data-rule="${input.dataset.rule}"]`); render(); return; }
    if (input.dataset.atelierSearch !== undefined) { ui.atelierSearch = input.value; keepAtelierScroll("[data-atelier-search]", input.value.length); render(); return; }
    if (input.dataset.ruleName !== undefined && ui.rulesDraft) { ui.rulesDraft.nom = input.value; return; }
    if (input.dataset.draftKey) { ui.decisionDrafts[input.dataset.draftKey] = input.value; return; }
    if (input.dataset.vacancyBudget !== undefined) { ui.vacancy.budget = Number(input.value || 0); return; }
    if (input.dataset.reflection && input.dataset.year) {
      state.reflections[input.dataset.year] = { ...(state.reflections[input.dataset.year] || {}), [input.dataset.reflection]: input.value };
      saveState(); return;
    }
    if (input.dataset.teamCode !== undefined) { state.playerTeam.teamCode = input.value.slice(0, 24); saveState(); }
  });

  document.addEventListener("toggle", (event) => {
    if (event.target.matches?.("[data-settings]")) ui.settingsOpen = event.target.open;
  }, true);

  window.addEventListener?.("pagehide", () => { saveState(); syncPlayerTeam(); });

  window.addEventListener?.("popstate", () => {
    if (typeof location === "undefined") return;
    // Back from a confirmation means "back to the choices", not "leave the drawer".
    if (ui.confirm) { ui.confirm = null; ui.restore = ui.returnFocus; render(); return; }
    // The browser's own Back leaves the chain, so the in-app step-back stack starts over.
    ui.originStack = [];
    applyRoute(parseRoute(location.hash));
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (ui.passCheck && event.key === "Escape") { event.preventDefault(); ui.passCheck = false; render(); return; }
    const drawer = document.querySelector(".drawer");
    if (!drawer) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...drawer.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  globalThis.ClinicTest = { atelierPaths: () => ({ valeurs: Object.keys(RULE_SETTINGS), noms: Object.keys(RULE_NAMES) }), ruleSettings: () => RULE_SETTINGS, chargerRegles, cleanRules, atelierFingerprint, rulesSummary, refusalSplit, initialState, hydrate, sauvegarderClinique, chargerClinique, casesCarried, countedActions, isFreeAction, predictionOptions, constraintKey, constraintBreakdown, planFrames, adjustCash, parseRoute, routeFor, applyRoute, openDrawer, closeDrawer, planRowLabel, planRows, applyAction, simulateYear, simulatePlan, queueAction, removeAction, resolveTurn, undoYear, resetScenario, pendingActions, forecastRecord, calculateCarbon, missingRequirements, requirementList, projectedDemand, actionLabel, goalChecks, getBeginnerSignals, emptyEffects, combineEffects, clone, validAllocations, allocationRemainder, allocationCeiling, snapShareToHours, stepShare, shareFromHours, availableHoursFor, assignedTone, workloadTone, stockServices: STOCK_SERVICES, buildExportPayload, buildPrintableReportHtml, data: D, getState: () => clone(state), renderState: (next) => { state = hydrate(next); ui.selectedServiceId = null; ui.settingsDraft = null; render(); return document.querySelector("#app").innerHTML; }, renderUiForTest: (changes) => { ui = { ...ui, ...changes }; render(); return document.querySelector("#app").innerHTML; } };
  if (typeof location !== "undefined" && location.hash) applyRoute(parseRoute(location.hash));
  render();
})();
