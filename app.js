(function () {
  "use strict";

  const D = globalThis.ClinicData;
  const I18N = globalThis.ClinicI18n;
  const STORAGE_KEY = "clinic-board-v3-full";
  const LEGACY_KEY = "clinic-board-v2-mvp";
  const SCHEMA_VERSION = 8;
  const MAX_ALLOCATION = 1.3;
  const OVERTIME_PREMIUM = 1.25;
  const SOCIAL_CHARGE_RATE = .22;
  const FATIGUE_ABSENCE_PER_OVERTIME = .3;
  const SERVICE_RAMP_UP = .6;
  const HIRE_ONBOARDING = .25;
  const SEVERANCE_SHARE = .25;
  const DEPARTURE_CLIMATE = -6;
  const DROPOFF_ROOM_FACTOR = .7;
  const RESIGN_CLIMATE = 30;
  const RESIGN_PAY_CLIMATE = 45;
  const RESIGN_PAY_RATIO = .95;
  const CLINIC_DEMAND_SWING = .04;
  const SERVICE_DEMAND_SWING = .08;
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
    return (1 + (seededUnit(`${seed}|clinic`) * 2 - 1) * CLINIC_DEMAND_SWING) * (1 + (seededUnit(`${seed}|${serviceId}`) * 2 - 1) * SERVICE_DEMAND_SWING);
  }
  const ADVANCED_SERVICES = new Set(["surgery", "lab", "ultrasound", "dentistry", "radiography", "hospital", "orthopedic"]);
  const ROUTINE_SERVICES = new Set(["consult", "vaccination", "preventive", "pharmacy", "retail"]);
  const DROPOFF_SERVICES = new Set(["vaccination", "preventive", "lab", "pharmacy"]);
  const SERVICE_BY_ID = Object.fromEntries(D.services.map((item) => [item.id, item]));
  const DEFAULT_SOCIAL = { clientTrust: 50, staffClimate: 50, referralSupport: 50, communityPressure: 50 };

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
      const share = clamp(Number(row.share || 0), 0, MAX_ALLOCATION);
      merged.set(service.id, (merged.get(service.id) || 0) + share);
    });
    let allocations = [...merged.entries()].map(([serviceId, share]) => ({ serviceId, share: Math.min(MAX_ALLOCATION, share) }));
    if (!allocations.length) allocations = legacyAllocations(person);
    const total = allocationTotal(allocations);
    if (total > MAX_ALLOCATION) allocations = allocations.map((row) => ({ ...row, share: row.share * MAX_ALLOCATION / total }));
    return allocations;
  }

  function allocationTotal(allocations) {
    return allocations.reduce((sum, row) => sum + Number(row.share || 0), 0);
  }

  // Unassigned paid share left for one row: 5% steps cannot land on an exact 100% of a person's
  // hours, so this returns the precise remainder. It targets 100%, never the overtime ceiling.
  function allocationRemainder(allocations, index) {
    const others = allocationTotal(allocations) - (allocations[index]?.share || 0);
    return Math.max(0, Math.min(1, MAX_ALLOCATION) - others - (allocations[index]?.share || 0));
  }

  function validAllocations(person, allocations) {
    if (!Array.isArray(allocations) || !allocations.length) return false;
    const ids = new Set();
    let total = 0;
    for (const row of allocations) {
      const service = SERVICE_BY_ID[row?.serviceId];
      const share = Number(row?.share);
      if (!service || !roleCompatible(person, service) || ids.has(service.id) || share <= 0 || share > MAX_ALLOCATION + .0001) return false;
      if (Math.abs(share * 20 - Math.round(share * 20)) > .0001) return false;
      ids.add(service.id);
      total += share;
    }
    return total > 0 && total <= MAX_ALLOCATION + .0001;
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
      marketing: { communication: "basic", monitoring: "none", geomarketing: "none" },
      finance: { loan: null },
      carbonModelVersion: D.carbonModel.version,
      sustainability: { energyUpgrade: "none", heatPump: false, solar: false, anaesthesiaProtocol: "standard", wasteStrategy: "standard", accessPlan: false },
      carbonBaseline: null,
      rules: { actionLimit: 3, unlimited: false, targetYear: 4, bankruptcyThreshold: -200000, ...(rulesOverride || {}) },
      reflections: {},
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
      lastOvertimeRatio: clamp(Number(person.lastOvertimeRatio || 0), 0, MAX_ALLOCATION),
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
  let ui = { passCheck: false, personTab: "time", showClosedServices: false, drawer: null, drawerStep: 1, drawerContext: null, selectedServiceId: null, reopenBeginnerGuide: false, vacancy: { role: "vet", skills: [], budget: 60000 }, candidateLimit: 4, reflectionStep: 0, lastFocus: null, allocationDrafts: {}, decisionDrafts: {}, settingsOpen: false, settingsDraft: null, settingsError: "", restore: null, returnFocus: null, autoFocusDrawer: false, replaceRoute: false, originStack: [], returnLabel: null, focusItem: null };

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function locale() {
    return state.language === "fr" ? "fr-BE" : "en-GB";
  }

  function money(value) {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Math.round(Number(value || 0)));
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

  function logDecision(event, key) {
    if (!Array.isArray(state.decisionLog)) state.decisionLog = [];
    state.decisionLog.push({ year: state.year, at: new Date().toISOString(), event, key });
  }

  function queueAction(key, payload) {
    const previous = state.pending[key];
    if (!previous && pendingActions().length >= actionLimit()) {
      toast(`${t("forecast.limitReached")} ${t("forecast.removeHint")}`, "warn");
      return;
    }
    const at = new Date().toISOString();
    // First queue stamps `at`; later edits to the same target keep it and count as revisions,
    // so "repeated edits are one action" still holds while the going back and forth stays visible.
    state.pending[key] = { key, payload: clone(payload), at: previous?.at || at, updatedAt: at, revisions: previous ? Number(previous.revisions || 0) + 1 : 0 };
    logDecision(previous ? "revise" : "add", key);
    saveState();
    render();
  }

  function rememberDrawer(selector = null) {
    const body = document.querySelector(".drawer-body");
    ui.restore = { scrollTop: body?.scrollTop || 0, selector };
  }

  function removeAction(key) {
    if (state.pending[key]) logDecision("remove", key);
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
          const severance = person.salary * SEVERANCE_SHARE;
          effect.oneTimeCosts += severance;
          effect.severance += severance;
          effect.climateShock += DEPARTURE_CLIMATE;
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
    if (p.kind === "location" && D.locations[p.targetId]) {
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
        Object.entries(socialAction.deltas).forEach(([key, value]) => { target.social[key] = clamp(Number(target.social[key] || 0) + value, 0, 100); });
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
      if (!target.finance.loan) {
        target.finance.loan = { principal: Number(p.value), remaining: Number(p.value), yearsRemaining: 5, rate: .06 };
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
    const moraleRate = climate < 50 ? Math.min(.08, (50 - climate) * .004) : climate > 60 ? -Math.min(.03, (climate - 60) * .002) : 0;
    const fatigueRelief = clamp(Number(effects.fatigueRelief || 0), 0, 1);
    const preliminary = clinic.staff.map((person) => {
      const contractedHours = person.capacity * salaryCapacityMultiplier(person);
      // Last year's overtime carries into this year as extra absence.
      const fatigueRate = Math.min(.09, Number(person.lastOvertimeRatio || 0) * FATIGUE_ABSENCE_PER_OVERTIME) * (1 - fatigueRelief);
      const expectedAbsenceHours = contractedHours * Math.max(0, hr.absenteeism + fatigueRate + moraleRate);
      const gross = contractedHours - expectedAbsenceHours;
      const roleTraining = person.role === "vet" ? effects.vetTrainingHours : effects.supportTrainingHours;
      const sameRoleCount = Math.max(1, clinic.staff.filter((item) => item.role === person.role).length);
      const trainingHours = roleTraining / sameRoleCount + Number(effects.trainingHoursByPerson?.[person.id] || 0);
      // People hired this year spend a quarter of their time learning the clinic.
      const onboardingHours = person.hiredYear === clinic.year ? Math.max(0, gross - trainingHours) * HIRE_ONBOARDING : 0;
      return { person, contractedHours, expectedAbsenceHours, fatigueAbsenceHours: contractedHours * fatigueRate, moraleAbsenceHours: contractedHours * moraleRate, onboardingHours, grossHours: gross, trainingHours, beforeDuties: Math.max(0, gross - trainingHours - onboardingHours) };
    });
    const stock = D.stockStrategies[clinic.operations.stockStrategy];
    const monitoring = D.marketingStrategies.monitoring[clinic.marketing.monitoring];
    const geo = D.marketingStrategies.geomarketing[clinic.marketing.geomarketing];
    const waste = D.sustainability.wasteStrategies[clinic.sustainability.wasteStrategy];
    const access = clinic.sustainability.accessPlan ? D.sustainability.interventions.accessPlan : { supportHours: 0 };
    const reservedSupport = stock.supportHours + monitoring.supportHours + geo.supportHours + waste.supportHours + access.supportHours + effects.supportReserved;
    const rawSupport = preliminary.filter((row) => row.person.role === "support").reduce((sum, row) => sum + row.beforeDuties, 0);
    const supportScale = rawSupport ? clamp((rawSupport - reservedSupport) / rawSupport, 0, 1) : 0;
    let totalVet = 0;
    let totalSupport = 0;
    const staffRows = preliminary.map((row) => {
      const { person } = row;
      const nonClinicalHours = person.role === "support" ? row.beforeDuties * (1 - supportScale) : 0;
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
        availableHours,
        usable: availableHours,
        salaryMultiplier: salaryCapacityMultiplier(person),
        hourlyRate: person.salary / Math.max(1, row.contractedHours),
        assignedShare,
        assignedHours: availableHours * assignedShare,
        idleHours: availableHours * Math.max(0, 1 - assignedShare),
        overtimeAssignedHours: availableHours * Math.max(0, assignedShare - 1),
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

  function projectedDemand(service, clinic, effects = emptyEffects()) {
    const segment = D.segments[clinic.marketFocus];
    const location = D.locations[clinic.location.sectorId];
    const serviceState = clinic.services[service.id];
    const communication = D.marketingStrategies.communication[clinic.marketing.communication];
    // Paid communication raises what clients accept paying, not only how many of them come. That is
    // what keeps it worth buying once capacity binds, when extra demand converts to nothing at all.
    const willingness = (segment.willingness[service.id] || service.price) * (1 + (communication.willingness || 0));
    const priceRatio = serviceState.price / Math.max(1, willingness);
    const priceEffect = priceRatio <= 1
      ? 1 + (1 - priceRatio) * service.elasticity * .35
      // Above willingness the response decays instead of running into a flat clamp. A flat floor
      // could not work here: the old linear term reached zero at ratios from 1.65 (retail) to 5.55
      // (emergency), so every service plateaued at a different price and none could be priced out
      // of its market. Exponential decay keeps the curve strictly decreasing at every price.
      // The constant is the decay rate per unit of over-pricing, and it has to be steep enough that
      // a price rise is a decision: at 2.2 a consultation priced 20% over willingness still kept 92%
      // of its requests. Rescue prices above willingness by default, so it is the scenario this
      // constant moves; Balanced and Growth sit below it and never evaluate this branch at all.
      : Math.exp(-(priceRatio - 1) * service.elasticity * 4 * segment.priceSensitivity);
    const monitoring = D.marketingStrategies.monitoring[clinic.marketing.monitoring];
    const geo = D.marketingStrategies.geomarketing[clinic.marketing.geomarketing];
    const competition = 1 - (1 - location.competition) * (1 - monitoring.relief);
    const socialTrust = 1 + (clinic.social.clientTrust - 50) / 500;
    const referral = ADVANCED_SERVICES.has(service.id) ? 1 + (clinic.social.referralSupport - 50) / 350 : 1;
    const pressure = ROUTINE_SERVICES.has(service.id) ? 1 + Math.max(0, clinic.social.communityPressure - 50) / 500 : 1;
    const periods = Object.entries(clinic.operations.openingPeriods).reduce((sum, [id, active]) => sum + (active ? D.openingPeriods[id].demand : 0), 0);
    const emergency = service.id === "emergency" && clinic.operations.openingPeriods.night ? D.openingPeriods.night.emergencyDemand : 0;
    const parking = clinic.location.parking && (clinic.marketFocus === "routine" || clinic.marketFocus === "budget" || service.id === "boarding") ? 1.08 : 1;
    const actionDemand = 1 + (ADVANCED_SERVICES.has(service.id) ? effects.advancedDemand : 0) + (ROUTINE_SERVICES.has(service.id) ? effects.routineDemand : 0);
    const accessDemand = clinic.sustainability.accessPlan ? 1 + D.sustainability.interventions.accessPlan.demand : 1;
    return Math.max(0, Math.round(
      service.demand * D.demandScale * (clinic.clients / 1200) * segment.serviceMix[service.id] * priceEffect *
      (location.segmentMultipliers[clinic.marketFocus] || 1) * (location.serviceMultipliers[service.id] || 1) *
      competition * (1 + communication.demand) * (1 + geo.demand) * socialTrust * referral * pressure *
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
      totals.electricity += result.honored * activity.electricityKWhPerCase;
      totals.clinicalWaste += result.honored * activity.clinicalWasteKgPerCase;
      totals.generalWaste += result.honored * activity.generalWasteKgPerCase;
      totals.anaesthetic += result.honored * activity.anaestheticMlPerCase;
      totals.trips += result.honored * activity.clientTripsPerCase;
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
      const expectedDemand = Math.round(projectedDemand(service, clinic, effects) * (openedThisYear ? SERVICE_RAMP_UP : 1));
      // "Exact figures" must mean exact. The forecast clips demand at capacity BEFORE the swing is
      // applied, so a good year can never beat the projection while a bad one misses it: measured
      // over 300 class codes, the largest year-3 gap is 0.00 €. In exact mode the swing is off on
      // both sides and the plan lands to the euro. Ranges and costs keep the variance — that is
      // where uncertainty is the lesson.
      const demandVaries = clinic.setup?.forecastPrecision !== "exact";
      const demand = options.actual && demandVaries ? Math.round(expectedDemand * demandSwing(clinic, service.id)) : expectedDemand;
      const missing = missingRequirements(service, clinic);
      const vd = vetDuration(service, clinic);
      const sd = supportDuration(service, clinic);
      const vetPool = resources.vetByService[service.id] || 0;
      const supportPool = resources.supportByService[service.id] || 0;
      // Drop-off animals wait outside the room while support staff work, freeing room time.
      const facilityDuration = caseDuration(service, clinic) * (dropoffActive(clinic) && DROPOFF_SERVICES.has(service.id) ? DROPOFF_ROOM_FACTOR : 1);
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
      if (serviceState.active) {
        totalDemand += demand;
        totalExpected += expectedDemand;
        if (missing.length) bottleneck = missing[0];
        else if (unstaffed) bottleneck = unstaffed;
        else {
          readyServices += 1;
          const caps = { ...staffCaps };
          service.roomIds.forEach((id) => { caps[`room:${id}`] = Math.floor(staffCap * facilityFactor("room", id) + 1e-9); });
          service.equipmentIds.forEach((id) => { caps[`equipment:${id}`] = Math.floor(staffCap * facilityFactor("equipment", id) + 1e-9); });
          honored = Math.max(0, Math.min(...Object.values(caps)));
          bottleneck = honored >= demand ? { type: "demandMet" } : lowestCap(caps);
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
      const variable = serviceRevenue * service.variableCost * circularMultiplier;
      revenue += serviceRevenue;
      baseVariableCosts += variable;
      serviceState.lastDemand = demand;
      serviceState.lastHonored = honored;
      serviceState.lastBottleneck = bottleneck;
      results.push({ id: service.id, active: serviceState.active, demand, honored, price: serviceState.price, revenue: serviceRevenue, variableCosts: variable, contributionPerCase: serviceState.price * (1 - service.variableCost), missing, bottleneck, vetDuration: vd, supportDuration: sd, vetUsed, supportUsed, vetCoverHours: Math.max(0, vetUsed - honored * vd), staffCap, expectedDemand, rampUp, stockoutLost });
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
        const shortageHours = role === "vet" ? Math.max(0, needVet - effectiveHours) : Math.max(0, neededHours - effectiveHours - vetSpare);
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
        assignment.unusedHours = Math.max(0, assignment.assignedHours - assignment.blockedHours - assignment.usedHours);
        assignment.blocker = assignment.qualified ? null : { type: staffRow.role === "vet" ? "missingVetSkill" : "missingSupportSkill", id: (staffRow.role === "vet" ? service.vetSkills : service.supportSkills).find((skill) => !clinic.staff.find((person) => person.id === staffRow.id)?.skills.includes(skill)) };
      });
      staffRow.usedHours = staffRow.assignments.reduce((sum, assignment) => sum + assignment.usedHours, 0);
      // Overtime is paid only for hours actually worked beyond available time.
      staffRow.overtimeHours = Math.max(0, staffRow.usedHours - staffRow.availableHours);
      staffRow.overtimePay = staffRow.overtimeHours * staffRow.hourlyRate * OVERTIME_PREMIUM;
      staffRow.unusedHours = Math.max(0, Math.max(staffRow.availableHours, staffRow.assignedHours) - staffRow.usedHours - staffRow.blockedHours);
      staffRow.workload = staffRow.availableHours ? staffRow.usedHours / staffRow.availableHours : 0;
    });
    const overtimeHours = resources.staffRows.reduce((sum, row) => sum + row.overtimeHours, 0);
    const overtimePay = resources.staffRows.reduce((sum, row) => sum + row.overtimePay, 0);
    const overtimeCost = overtimePay * (1 + SOCIAL_CHARGE_RATE);
    const overtimeClimate = -Math.min(8, resources.staffRows.reduce((sum, row) => sum + (row.availableHours ? row.overtimeHours / row.availableHours : 0), 0) * 20);
    const stock = D.stockStrategies[clinic.operations.stockStrategy];
    const variableCosts = baseVariableCosts * stock.multiplier;
    const payroll = clinic.staff.reduce((sum, person) => sum + person.salary, 0);
    const socialCharges = payroll * SOCIAL_CHARGE_RATE;
    const ownedMaintenance = Object.entries(clinic.equipment).reduce((sum, [id, counts]) => sum + counts.owned * D.equipment[id].purchase * D.equipment[id].maintenanceRate, 0);
    const leaseCosts = Object.entries(clinic.equipment).reduce((sum, [id, counts]) => sum + counts.leased * D.equipment[id].lease, 0);
    const roomRent = Object.entries(clinic.rooms).reduce((sum, [id, qty]) => sum + Math.max(0, qty - D.rooms[id].baseIncluded) * D.rooms[id].annualRent, 0);
    const location = D.locations[clinic.location.sectorId];
    const facilityCosts = location.rent + roomRent + ownedMaintenance + leaseCosts + (clinic.location.parking ? location.parkingMaintenance : 0);
    const openingCosts = Object.entries(clinic.operations.openingPeriods).reduce((sum, [id, active]) => sum + (active ? D.openingPeriods[id].cost : 0), 0);
    const dropoffCost = clinic.operations.dropoff ? 4000 : 0;
    const hrCost = D.hrStrategies[clinic.hr.strategy].cost;
    const marketingCost = Object.entries(clinic.marketing).reduce((sum, [strategy, level]) => sum + D.marketingStrategies[strategy][level].cost, 0);
    const sustainabilityCost = sustainabilityAnnualCost(clinic);
    const admin = 14000 + D.services.filter((service) => clinic.services[service.id].active).length * 900;
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
    const operatingResult = revenue - totalCosts;
    const tax = operatingResult > 0 ? operatingResult * .25 : 0;
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
    const periodClimate = Object.entries(clinic.operations.openingPeriods).reduce((sum, [id, active]) => sum + (active ? D.openingPeriods[id].climate : 0), 0) * (clinic.hr.strategy === "supportive" ? .5 : 1);
    const averagePayRatio = clinic.staff.reduce((sum, person) => sum + person.salary / person.baseSalary, 0) / Math.max(1, clinic.staff.length);
    const payClimate = clamp((averagePayRatio - 1) * 40, -4, 4);
    const social = clone(clinic.social);
    const accessTrust = clinic.sustainability.accessPlan ? D.sustainability.interventions.accessPlan.trust : 0;
    const paceMix = results.reduce((sum, result) => {
      const pace = servicePace(clinic, result.id);
      return { trust: sum.trust + result.honored * pace.trust, reputation: sum.reputation + result.honored * pace.reputation };
    }, { trust: 0, reputation: 0 });
    const paceTrust = totalHonored ? paceMix.trust / totalHonored : 0;
    const paceReputation = totalHonored ? paceMix.reputation / totalHonored : 0;
    const stockoutShare = totalStockoutLost / Math.max(1, totalHonored + totalStockoutLost);
    const trustParts = { served: honoredRate * 3.2 - (1 - honoredRate) * 5.8, communication: communication.trust, access: accessTrust, pace: paceTrust, dropoff: dropoffActive(clinic) ? 1 : 0, stockouts: -Math.min(4, stockoutShare * 30) };
    social.clientTrust = clamp(social.clientTrust + Object.values(trustParts).reduce((sum, value) => sum + value, 0), 0, 100);
    const climateParts = { hr: hr.climate, openingHours: periodClimate, pay: payClimate, overtime: overtimeClimate, workload: staffUse > .94 ? -3 : staffUse >= .45 ? 1 : -1, departure: effects.climateShock || 0 };
    social.staffClimate = clamp(social.staffClimate + Object.values(climateParts).reduce((sum, value) => sum + value, 0), 0, 100);
    // Year-end resignations are deterministic so the forecast can warn about them.
    const retainedClimate = social.staffClimate + (hr.retention || 0);
    const payRatio = (person) => person.salary / Math.max(1, person.baseSalary);
    const resignations = clinic.staff.filter((person) => retainedClimate < RESIGN_PAY_CLIMATE && payRatio(person) < RESIGN_PAY_RATIO - .001).map((person) => ({ id: person.id, name: person.name, reason: "pay" }));
    if (!resignations.length && retainedClimate < RESIGN_CLIMATE && clinic.staff.length > 1) {
      const overtimeRatio = (person) => {
        const row = resources.staffRows.find((item) => item.id === person.id);
        return row?.availableHours ? row.overtimeHours / row.availableHours : 0;
      };
      const leaver = clinic.staff.slice().sort((a, b) => overtimeRatio(b) - overtimeRatio(a) || payRatio(a) - payRatio(b))[0];
      resignations.push({ id: leaver.id, name: leaver.name, reason: "climate" });
    }
    const demandVariance = totalExpected ? totalDemand / totalExpected - 1 : 0;
    social.referralSupport = clamp(social.referralSupport + (advancedServed > 0 ? honoredRate * 2 : -.5), 0, 100);
    social.communityPressure = clamp(social.communityPressure + (1 - honoredRate) * 5 - (honoredRate > .84 ? 2 : 0), 0, 100);
    const segment = D.segments[clinic.marketFocus];
    const reputation = clamp(clinic.reputation + honoredRate * 4 - (1 - honoredRate) * 5 + (netResult >= 0 ? .8 : -.7) + (social.clientTrust - 50) / 75 + paceReputation, 20, 95);
    const clientGrowth = clamp(.9 + honoredRate * .13 + (reputation - 56) / 900 + segment.growth + (social.clientTrust - 50) / 900, .78, 1.16);
    const clients = Math.round(clinic.clients * clientGrowth);
    const avgContribution = results.filter((r) => r.active && r.contributionPerCase > 0).reduce((sum, r, _, rows) => sum + r.contributionPerCase / rows.length, 0);
    const carbon = calculateCarbon(clinic, results);
    return {
      turn: clinic.year,
      scenarioId: clinic.scenarioId,
      actions: actions.map((action) => clone(action.payload)),
      actionRecords: actions.map((action) => clone({ key: action.key, ...action.payload, queuedAt: action.at || null, confirmedAt: action.updatedAt || null, revisions: Number(action.revisions || 0) })),
      legacyActions: [],
      clinicSnapshot: clinicSnapshot(clinic),
      serviceResults: results,
      financial: { revenue, baseVariableCosts, variableCosts, payroll, socialCharges, overtimeHours, overtimePay, overtimeCost, ownedMaintenance, leaseCosts, roomRent, locationRent: location.rent, facilityCosts, openingCosts, dropoffCost, stockCost: stock.cost, hrCost, marketingCost, sustainabilityCost, admin, loanPayment, loanPrincipalPayment, loanInterest, oneTimeCosts: effects.oneTimeCosts, cashAdjustment: financingCashAdjustment, fixedCosts, totalCosts, operatingResult, tax, netResult, treasury, margin: revenue ? netResult / revenue : 0, breakEvenCases: avgContribution ? Math.ceil(fixedCosts / avgContribution) : 0 },
      operational: { totalDemand, totalOpportunity, totalHonored, honoredRate, mainConstraint, staffUse, startVetHours: resources.totalVet, remainingVetHours: resources.remainingVet, startSupportHours: resources.totalSupport, remainingSupportHours: resources.remainingSupport, reservedSupportHours: resources.reservedSupport, roomUse: resourceUse(resources.startRooms, resources.rooms), equipmentUse: resourceUse(resources.startEquipment, resources.equipment), advancedServed, readyServices, facilityRows, staffRows: resources.staffRows, serviceHourRows, stockoutLost: totalStockoutLost, expectedDemand: totalExpected, demandVariance },
      social: { before: clone(before.social || DEFAULT_SOCIAL), after: social, climateParts, trustParts },
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
      carbonTotal: run.carbon?.total ?? null
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
    if (payload.kind === "social-action") return t("actions.social", { name: itemLabel(D.socialActions[payload.targetId].name) });
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
      monitoring: { en: "competitive monitoring", fr: "la veille concurrentielle" },
      geomarketing: { en: "local market research", fr: "l’étude du marché local" }
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
        text: L(`${number(onClosed.hours)} paid hours are assigned to ${names}, which ${onClosed.closed.length > 1 ? "are" : "is"} closed, so they produce nothing. Open the service or move the hours.`, `${number(onClosed.hours)} heures payées sont affectées à ${names}, actuellement fermé(s) : elles ne produisent rien. Ouvrez le service ou déplacez les heures.`),
        action: L(`Investigate ${serviceName(first)}`, `Examiner ${serviceName(first)}`),
        secondary: { label: L("Move the hours", "Déplacer les heures"), destination: { drawer: "staffAllocation", context: onClosed.person.id } }
      });
    }
    (forecast.resignations || []).slice(0, 1).forEach((leaver) => {
      signals.push({
        key: "resignationRisk", status: "bad", destination: { drawer: "hr" },
        title: L(`${leaver.name} is set to resign at year end`, `${leaver.name} va démissionner en fin d’année`),
        text: leaver.reason === "pay"
          ? L("They are paid below 95% of their benchmark while staff climate is low. Raise their pay, improve the HR strategy, or hold a staff meeting.", "Cette personne est payée sous 95 % de sa référence alors que le climat est bas. Augmentez son salaire, améliorez la stratégie RH ou organisez une réunion d’équipe.")
          : L("Staff climate is forecast to fall too low. Reduce overtime or extra opening hours, improve the HR strategy, raise pay, or hold a staff meeting.", "Le climat de l’équipe devrait tomber trop bas. Réduisez les heures supplémentaires ou les horaires étendus, améliorez la stratégie RH, augmentez les salaires ou organisez une réunion d’équipe."),
        action: L("Review HR strategy", "Examiner la stratégie RH"),
        secondary: leaver.reason === "pay"
          ? { label: L(`Review ${leaver.name}’s pay`, `Examiner le salaire de ${leaver.name}`), destination: { drawer: "staffPerson", context: leaver.id } }
          : { label: L("Hold a staff meeting", "Organiser une réunion d’équipe"), destination: { drawer: "relations" } }
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
        text: L(`It serves 0 of ${number(unstaffed.demand)} requests because nobody is assigned to its ${needsVet ? "veterinary" : "support"} work.${candidate ? ` ${candidate.name} can do it.` : " Nobody on the team is qualified yet."}`, `Il traite 0 des ${number(unstaffed.demand)} demandes car personne n’est affecté à son travail ${needsVet ? "vétérinaire" : "de soutien"}.${candidate ? ` ${candidate.name} peut le faire.` : " Personne dans l’équipe n’est encore qualifié."}`),
        action: candidate ? L(`Assign ${candidate.name}`, `Affecter ${candidate.name}`) : L("See who can do what", "Voir qui peut faire quoi")
      });
    }
    const full = (forecast.operational.facilityRows || []).filter((row) => row.full).sort((a, b) => b.turnedAway - a.turnedAway)[0];
    if (full) {
      signals.push({
        key: "facilityFull", status: "bad", destination: { drawer: full.kind === "room" ? "rooms" : "equipment" },
        title: L(`${facilityName(full)} is full`, `${facilityName(full)} : capacité saturée`),
        text: L(`${number(full.turnedAway)} requests are turned away across ${full.services.map(serviceName).join(", ")}. Every service using it loses the same share. Add capacity, extend opening hours, or use a faster pace.`, `${number(full.turnedAway)} demandes sont refusées pour ${full.services.map(serviceName).join(", ")}. Chaque service concerné perd la même part. Ajoutez de la capacité, étendez les horaires ou accélérez le rythme.`),
        action: full.kind === "room" ? L("Add a room", "Ajouter une salle") : L("Add equipment", "Ajouter un équipement"),
        secondary: { label: L("Extend opening hours", "Étendre les horaires"), destination: { drawer: "opening" } }
      });
    }
    const short = forecast.serviceResults.filter((row) => row.active && (row.bottleneck.type === "vetHours" || row.bottleneck.type === "supportHours")).map((row) => ({ row, unmet: row.demand - row.honored })).sort((a, b) => b.unmet - a.unmet)[0];
    if (short && short.unmet > 0) {
      const vetShort = short.row.bottleneck.type === "vetHours";
      signals.push({
        key: "staffShort", status: "warn", destination: { drawer: "capabilities" },
        title: L(`${serviceName(short.row.id)} runs out of ${vetShort ? "veterinary" : "staff"} hours`, `${serviceName(short.row.id)} manque d’heures ${vetShort ? "vétérinaires" : "du personnel"}`),
        text: L(`${number(short.unmet)} requests go unserved. Move hours from a quieter service, allow overtime (up to 130%), or hire.`, `${number(short.unmet)} demandes restent sans réponse. Déplacez des heures d’un service plus calme, autorisez des heures supplémentaires (jusqu’à 130 %) ou recrutez.`),
        action: L("See who can do what", "Voir qui peut faire quoi"),
        secondary: { label: L("Post a vacancy", "Publier une offre"), destination: { drawer: "recruitment" } }
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
        text: L(
          `${pct(1 - forecast.operational.staffUse)} of available work hours are unused${person ? `; ${person.name} has ${number(idlest.unusedHours)} spare hours` : ""}.${openable ? ` ${serviceName(openable.id)} could use their time.` : " Move hours to services that are short, or use spare support time for stock or market research."}`,
          `${pct(1 - forecast.operational.staffUse)} des heures de travail disponibles sont inutilisées${person ? ` ; ${person.name} a ${number(idlest.unusedHours)} heures libres` : ""}.${openable ? ` ${serviceName(openable.id)} pourrait utiliser ce temps.` :" Déplacez des heures vers les services en manque, ou utilisez le temps de soutien libre pour le stock ou l’étude de marché."}`
        ),
        action: openable ? L(`Investigate ${serviceName(openable.id)}`, `Examiner ${serviceName(openable.id)}`) : L("Explore compatible services", "Explorer les services compatibles"),
        secondary: person ? { label: L(`Change ${person.name}’s time`, `Modifier le temps de ${person.name}`), destination: { drawer: "staffAllocation", context: person.id } } : null
      });
    }
    if (signals.length < 3) {
      const source = forecast.carbon.primaryDrivers[0];
      signals.push({
        key: "carbonOpportunity", status: "neutral", destination: { domain: "sustainability" },
        title: L("There is a visible carbon opportunity", "Une possibilité de réduction carbone est visible"),
        text: `${sourceLabel(source)}: ${tonnes(forecast.carbon.bySource[source])}`,
        action: L("Inspect sustainability options", "Voir les options de durabilité")
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

  function metricCard(label, value, note = "", tone = "") {
    return `<article class="metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<em>${escapeHtml(note)}</em>` : ""}</article>`;
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
          <div class="${pendingActions().length >= actionLimit() ? "at-limit" : ""}"><span>${escapeHtml(t("app.actions"))}</span><strong>${pendingActions().length}/${escapeHtml(limitText)}</strong></div>
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
  const DRAWER_HOME = { relations: "team", services: "care", rooms: "care", equipment: "care", person: "team", staffAllocation: "team", staffPerson: "team", staffExit: "team", training: "team", capabilities: "team", hoursByService: "team", recruitment: "team", opening: "team", dropoff: "team", stock: "team", hr: "team", pricing: "business", finance: "business", market: "business", location: "business", marketing: "business", sustainability: "sustainability", plan: null, export: null, setup: null };
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
    const left = actionLimit() - actions.length;
    const warnings = [];
    (forecast.resignations || []).forEach((item) => warnings.push(L(`${item.name} is forecast to resign at year end.`, `${item.name} devrait démissionner en fin d’année.`)));
    forecast.serviceResults.filter((row) => row.active && row.bottleneck.type === "unstaffed").forEach((row) => warnings.push(L(`${serviceName(row.id)} is open but nobody is assigned to it.`, `${serviceName(row.id)} est ouvert mais personne n’y est affecté.`)));
    (forecast.operational.facilityRows || []).filter((row) => row.full).forEach((row) => warnings.push(L(`${facilityName(row)} is full: ${number(row.turnedAway)} requests turned away.`, `${facilityName(row)} est saturé : ${number(row.turnedAway)} demandes refusées.`)));
    planned.staff.filter((person) => closedAssignments(person, planned).length).forEach((person) => warnings.push(L(`${person.name} has hours on closed services.`, `${person.name} a des heures sur des services fermés.`)));
    if (forecast.financial.treasury < state.rules.bankruptcyThreshold) warnings.push(L("The forecast treasury falls below the bankruptcy threshold.", "La trésorerie prévue passe sous le seuil de faillite."));
    const unused = Number.isFinite(left) && left > 0 ? `<p class="no-effect">${escapeHtml(L(`${left} action${left > 1 ? "s" : ""} unused this year.`, `${left} action${left > 1 ? "s" : ""} non utilisée${left > 1 ? "s" : ""} cette année.`))}</p>` : "";
    return `<div class="modal-backdrop"><section class="modal pass-check" role="dialog" aria-modal="true" aria-labelledby="pass-title"><div class="modal-head"><h2 id="pass-title">${escapeHtml(L(`Ready to pass Year ${state.year}?`, `Prêt à passer l’année ${state.year} ?`))}</h2><button data-cancel-pass aria-label="${escapeHtml(t("app.close"))}">×</button></div><h3>${escapeHtml(L("Planned actions", "Actions prévues"))}</h3>${actions.length ? `<ul>${actions.map((action) => `<li>${escapeHtml(actionLabel(action.payload))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No actions planned.", "Aucune action prévue."))}</p>`}${unused}${warnings.length ? `<h3>${escapeHtml(L("Warnings still showing", "Alertes encore visibles"))}</h3><ul class="pass-warnings">${warnings.slice(0, 6).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : `<p class="good-text">${escapeHtml(L("No outstanding warnings.", "Aucune alerte en cours."))}</p>`}<div class="button-row"><button class="button secondary" data-cancel-pass>${escapeHtml(L("Go back", "Retour"))}</button><button class="button primary" data-confirm-pass>${escapeHtml(L(`Pass Year ${state.year}`, `Passer l’année ${state.year}`))}</button></div></section></div>`;
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
      </div></fieldset></div><div class="setup-actions"><button class="button primary" data-save-settings>${escapeHtml(L("Save settings", "Enregistrer les paramètres"))}</button></div>${ui.settingsError ? `<p class="form-error" role="alert">${escapeHtml(ui.settingsError)}</p>` : ""}${renderCashAdjuster()}<h3>${escapeHtml(L("Scenario", "Scénario"))}</h3><div class="scenario-grid compact">${Object.entries(D.scenarios).map(([id, scenario]) => `<article class="choice-card ${state.scenarioId === id ? "selected" : ""}"><h3>${escapeHtml(itemLabel(scenario.name))}</h3><p>${escapeHtml(itemLabel(scenario.description))}</p><button class="button ${state.scenarioId === id ? "secondary" : "danger"}" data-scenario="${id}" ${state.scenarioId === id ? "disabled" : ""}>${escapeHtml(state.scenarioId === id ? t("common.current") : t("dashboard.chooseScenario"))}</button></article>`).join("")}</div><div class="button-row"><button class="button secondary" data-export>${escapeHtml(t("app.export"))}</button><button class="button danger" data-reset>${escapeHtml(t("app.reset"))}</button></div>`;
  }

  function serviceChip(row) {
    if (!row.active) return ["", L("Closed", "Fermé")];
    if (row.missing?.length) return ["warn", L("Blocked", "Bloqué")];
    if (row.bottleneck.type === "unstaffed") return ["bad", L("Nobody assigned", "Personne d’affecté")];
    if (row.bottleneck.type === "roomFull" || row.bottleneck.type === "equipmentFull") return ["warn", L("Full", "Saturé")];
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
      ["carbon.total", baseline.carbon.total, forecast.carbon.total, "carbon", true]
    ];
  }

  function planRowLabel(key) {
    return key === "carbon.total" ? L("Carbon footprint", "Empreinte carbone") : t(key);
  }

  function planValue(type, outcome, value, options = {}) {
    if (outcome) return forecastText(value, type, options);
    return options.signed ? signed(value, type) : formatMetric(value, type);
  }

  function renderPlanPanel(baseline, forecast) {
    const rows = planRows(baseline, forecast);
    return `<aside class="plan-panel" aria-label="${escapeHtml(t("forecast.title"))}">
      <button class="mobile-plan-toggle" data-open-drawer="plan"><strong>${escapeHtml(L("Plan", "Plan"))} · ${pendingActions().length} ${escapeHtml(pendingActions().length === 1 ? t("common.action") : t("common.actions"))}</strong><span>${escapeHtml(t("forecast.treasury"))} ${escapeHtml(forecastText(forecast.financial.treasury - baseline.financial.treasury, "money", { signed: true }))}</span></button>
      <div class="panel-heading"><div><h2>${escapeHtml(t("forecast.title"))}</h2><p>${escapeHtml(forecastNote())}</p></div></div>
      <div class="forecast-table">
        <div class="forecast-head"><span></span><span>${escapeHtml(t("common.baseline"))}</span><span>${escapeHtml(t("common.planned"))}</span><span>${escapeHtml(t("common.delta"))}</span></div>
        ${rows.map(([key, base, plan, type, outcome]) => `<div class="forecast-row"><strong>${escapeHtml(planRowLabel(key))}</strong><span>${escapeHtml(planValue(type, outcome, base))}</span><span>${escapeHtml(planValue(type, outcome, plan))}</span><em>${escapeHtml(planValue(type, outcome, plan - base, { signed: true }))}</em></div>`).join("")}
        <div class="forecast-row constraint"><strong>${escapeHtml(t("forecast.constraint"))}</strong><span>${escapeHtml(blockerText(baseline.operational.mainConstraint))}</span><span>${escapeHtml(blockerText(forecast.operational.mainConstraint))}</span><em>${baseline.operational.mainConstraint.type === forecast.operational.mainConstraint.type ? "=" : "↻"}</em></div>
      </div>
      <div class="plan-actions">
        ${pendingActions().length ? pendingActions().map((action) => `<div class="plan-action"><span>${escapeHtml(actionLabel(action.payload))}</span><button data-remove-action="${escapeHtml(action.key)}" aria-label="${escapeHtml(t("common.remove"))}">×</button></div>`).join("") : `<p class="empty">${escapeHtml(t("forecast.noActions"))}</p>`}
      </div>
      <div class="plan-footer"><button class="button primary pass-button" data-pass-year>${escapeHtml(t("app.pass"))}</button></div>
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
    const severance = person.salary * SEVERANCE_SHARE;
    const services = normalizeAllocations(person).filter((item) => item.share > 0).map((item) => serviceName(item.serviceId)).join(", ");
    const key = `fire:${person.id}`;
    const payload = { kind: "fire", targetId: person.id };
    return `<div class="staff-editor"><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(L(`Letting ${person.name} go costs ${money(severance)} in severance (3 months’ salary), removes their ${number(row?.availableHours || 0)} available hours this year, and lowers the team’s climate by ${Math.abs(DEPARTURE_CLIMATE)}. Their annual salary of ${money(person.salary)} stops.`, `Se séparer de ${person.name} coûte ${money(severance)} d’indemnité (3 mois de salaire), retire ses ${number(row?.availableHours || 0)} heures disponibles cette année et baisse le climat de l’équipe de ${Math.abs(DEPARTURE_CLIMATE)}. Son salaire annuel de ${money(person.salary)} s’arrête.`))}</p><p><strong>${escapeHtml(L("Services they work on", "Services concernés"))}:</strong> ${escapeHtml(services || "—")}</p><p class="no-effect">${escapeHtml(L("Services left without anyone show as “Nobody assigned”. A former applicant cannot be rehired for a year.", "Les services laissés sans personne apparaissent « Personne d’affecté ». Un ancien candidat ne peut pas être réembauché pendant un an."))}</p>${consequencePreview(key, payload)}${reviewButton(key, payload, L("Let go", "Se séparer"))}</div>`;
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

  function consequencePreview(key, payload, options = {}) {
    const { before, after, settledBefore, settledAfter } = previewAction(key, payload);
    const hidden = forecastPrecision() === "costs";

    // --- What this decision costs. Exact, always, and split by the line it lands on. ---
    const once = after.financial.oneTimeCosts - before.financial.oneTimeCosts;
    const firstYear = costBuckets(after), baseYear = costBuckets(before);
    const settled = settledAfter ? costBuckets(settledAfter) : null;
    const settledBase = settledBefore ? costBuckets(settledBefore) : null;
    const costCells = [];
    if (Math.abs(once) >= 1) costCells.push([L("One-time costs", "Coûts ponctuels"), signed(once, "money"), ""]);
    COST_LINES.forEach(([id, label]) => {
      const now = firstYear[id] - baseYear[id];
      const later = settled ? settled[id] - settledBase[id] : now;
      if (Math.abs(now) < 1 && Math.abs(later) < 1) return;
      // The second figure is the whole point for a service or a hire: the first year is the cheap
      // one, and a decision judged on it is judged on its most flattering year.
      const note = Math.abs(later - now) >= 1 ? L(`${money(later)} from year two`, `${money(later)} ensuite`) : "";
      costCells.push([label(), signed(now, "money"), note]);
    });

    // --- What it does to the clinic. Plan-level, and filtered by the forecast precision. ---
    const moved = (a, b, threshold) => Math.abs(a - b) >= threshold;
    const compareRows = [
      [L("Net result", "Résultat net"), before.financial.netResult, after.financial.netResult, "money", true],
      [L("End treasury", "Trésorerie finale"), before.financial.treasury, after.financial.treasury, "money", true],
      [L("Cases served", "Cas traités"), before.operational.totalHonored, after.operational.totalHonored, "number", true],
      ...(moved(after.operational.staffUse, before.operational.staffUse, .005) ? [[L("Team workload", "Charge de l’équipe"), before.operational.staffUse, after.operational.staffUse, "percent", false]] : []),
      ...(moved(after.carbon.total, before.carbon.total, .05) ? [[L("Carbon footprint", "Empreinte carbone"), before.carbon.total, after.carbon.total, "carbon", false]] : []),
      ...(moved(after.social.after.staffClimate, before.social.after.staffClimate, .5) ? [[L("Staff climate", "Climat de l’équipe"), Math.round(before.social.after.staffClimate), Math.round(after.social.after.staffClimate), "number", false]] : []),
      ...(moved(after.social.after.clientTrust, before.social.after.clientTrust, .5) ? [[L("Client trust", "Confiance des clients"), Math.round(before.social.after.clientTrust), Math.round(after.social.after.clientTrust), "number", false]] : []),
      ...(moved(after.social.after.referralSupport, before.social.after.referralSupport, .5) ? [[itemLabel(D.socialIndicators.referralSupport), Math.round(before.social.after.referralSupport), Math.round(after.social.after.referralSupport), "number", false]] : []),
      ...(moved(after.social.after.communityPressure, before.social.after.communityPressure, .5) ? [[itemLabel(D.socialIndicators.communityPressure), Math.round(before.social.after.communityPressure), Math.round(after.social.after.communityPressure), "number", false]] : [])
    ];

    const served = after.operational.totalHonored - before.operational.totalHonored;
    const workload = after.operational.staffUse - before.operational.staffUse;
    const note = options.note === false ? "" : (Math.abs(served) < .5 && Math.abs(workload) < .0001 ? noEffectReason(payload) : "");

    // Showing what happens without the decision beside what happens with it makes the direction
    // intrinsic, so the old "Improves / Worsens" column is gone: six phrases per card that only
    // restated the sign of the number next to them.
    const comparison = hidden
      ? `<p class="no-effect">${escapeHtml(L("Revealed at year end", "Révélé en fin d’année"))}</p>`
      : `<div class="comparison-list" aria-label="${escapeHtml(L("Expected consequences", "Conséquences attendues"))}">${compareRows.map(([label, base, plan, type]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(formatMetric(base, type))}</span><em>→ ${escapeHtml(formatMetric(plan, type))}</em></div>`).join("")}</div>`;

    // The duration marker rides with the preview so every decision surface gets it from one place:
    // the option cards, and the nine hand-built cards that never went through optionCard.
    return `<small class="lasts">${escapeHtml(durationLabel(payload))}</small>`
      + (costCells.length ? `<p class="preview-label">${escapeHtml(L("What this decision costs", "Ce que cette décision coûte"))}</p><div class="consequence-grid" aria-label="${escapeHtml(L("Cost of this decision", "Coût de cette décision"))}" data-cost-block>${costCells.map(([label, value, extra]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(extra)}</em></div>`).join("")}</div>` : "")
      + `<p class="preview-label">${escapeHtml(L("Without this decision → with it", "Sans cette décision → avec"))}</p>${comparison}`
      + (note ? `<p class="no-effect"><strong>${escapeHtml(L("No effect on cases yet", "Pas encore d’effet sur les cas"))}:</strong> ${escapeHtml(note)}</p>` : "");
  }

  // Explains why a decision leaves cases and workload unchanged, naming what is still missing.
  function noEffectReason(payload) {
    const planned = plannedState();
    const serviceKinds = ["price", "service-pace"];
    if (serviceKinds.includes(payload.kind) && !planned.services[payload.targetId]?.active) return L("the service is closed. Open it first.", "le service est fermé. Ouvrez-le d’abord.");
    const serviceIds = payload.kind === "room-add" ? D.services.filter((service) => service.roomIds.includes(payload.targetId)).map((service) => service.id)
      : payload.kind === "equipment-acquire" ? D.services.filter((service) => service.equipmentIds.includes(payload.targetId)).map((service) => service.id)
      : payload.kind === "training" ? D.services.filter((service) => service.vetSkills.includes(payload.targetId) || service.supportSkills.includes(payload.targetId)).map((service) => service.id)
      : [];
    if (serviceIds.length) {
      const after = clone(planned);
      applyAction(after, { payload }, false);
      const needs = serviceIds.map((id) => {
        const missing = missingRequirements(SERVICE_BY_ID[id], after).map(blockerText);
        if (!after.services[id].active) missing.push(L("open the service", "ouvrir le service"));
        return missing.length ? `${serviceName(id)} ${L("still needs", "a encore besoin de")}: ${missing.join(", ")}` : null;
      }).filter(Boolean).slice(0, 2);
      if (needs.length) return needs.join(" · ");
      return L("this capacity is not what limits these services right now; demand or staff hours do.", "cette capacité ne limite pas ces services pour l’instant ; la demande ou les heures du personnel le font.");
    }
    if (payload.kind === "dropoff" && planned.staff.filter((person) => person.role === "support").length < 2) return L("the drop-off workflow needs two support staff; hire another first.", "le parcours de dépôt exige deux membres du soutien ; recrutez-en un autre d’abord.");
    if (payload.kind === "parking" && !["routine", "budget"].includes(planned.marketFocus) && !planned.services.boarding.active) return L("parking only raises demand for routine- or budget-focused clinics and for boarding.", "le parking n’augmente la demande que pour une clinique orientée soins courants ou prix, et pour la pension.");
    if (payload.kind === "social-action" && D.socialActions[payload.targetId]?.advancedDemand && !D.services.some((service) => ADVANCED_SERVICES.has(service.id) && planned.services[service.id].active)) return L("this raises demand for advanced care, but no advanced service is open.", "cela augmente la demande de soins avancés, mais aucun service avancé n’est ouvert.");
    if (payload.kind === "price") return L("cases here are limited by staff or rooms, not demand, so the price changes income per case rather than the number of cases.", "les cas sont limités par le personnel ou les salles, pas par la demande : le prix change la recette par cas, pas le nombre de cas.");
    if (["staff-allocation", "hire", "salary"].includes(payload.kind)) return L("the services involved are limited by demand, rooms, or missing requirements, not by staff hours.", "les services concernés sont limités par la demande, les salles ou des conditions manquantes, pas par les heures du personnel.");
    return L("this decision changes costs or longer-term indicators rather than this year’s cases.", "cette décision modifie les coûts ou des indicateurs de plus long terme plutôt que les cas de cette année.");
  }

  function encodedPayload(payload) {
    return encodeURIComponent(JSON.stringify(payload));
  }

  // Cards already show their consequences, so their button adds straight to the plan.
  function reviewButton(key, payload, label) {
    const pending = state.pending[key];
    const sameToggle = pending && typeof payload.value === "boolean" && pending.payload.kind === payload.kind && pending.payload.targetId === payload.targetId;
    if (pending && (sameToggle || JSON.stringify(pending.payload) === JSON.stringify(payload))) return `<span class="in-plan">✓ ${escapeHtml(L("In plan", "Dans le plan"))}</span><button class="button secondary" data-remove-action="${escapeHtml(key)}">${escapeHtml(L("Undo", "Annuler"))}</button>`;
    const left = actionLimit() - pendingActions().length;
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

  function optionCard(title, description, key, payload, meta = "", id = null) {
    return `<article${id ? targetCard(id) : ' class="choice-card"'}><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}${consequencePreview(key, payload)}${reviewButton(key, payload)}</article>`;
  }

  function sourceLabel(id) {
    return ({ building: L("Building and energy", "Bâtiment et énergie"), clinical: L("Clinical care", "Soins cliniques"), waste: L("Materials and waste", "Matériaux et déchets"), travel: L("Client travel", "Déplacements des clients") })[id] || id;
  }

  function renderOverview(planned, forecast) {
    const goals = goalChecks(forecast, planned);
    const passed = goals.filter((goal) => goal.ok).length;
    const carbonDelta = forecast.carbon.total - state.carbonBaseline.total;
    const signals = getBeginnerSignals(forecast, planned);
    const showGuide = (state.year === 1 && !state.uiPreferences.beginnerGuideDismissed) || ui.reopenBeginnerGuide;
    const hideOutcomes = forecastPrecision() === "costs";
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Clinic overview", "Vue d’ensemble de la clinique"))}</h1><p>${escapeHtml(L("See the situation, choose one area, and check the consequences before acting.", "Observez la situation, choisissez un domaine et vérifiez les conséquences avant d’agir."))}</p></div></div>
      ${renderStartBanner()}
      ${showGuide ? `<section class="beginner-guide" aria-labelledby="beginner-guide-title"><div><span>${escapeHtml(L("Year 1 guide", "Guide de l’année 1"))}</span><h2 id="beginner-guide-title">${escapeHtml(L("Your first turn", "Votre premier tour"))}</h2></div><ol><li><strong>${escapeHtml(L("Read the clinic situation", "Comprenez la situation"))}</strong><span>${escapeHtml(L("Start with the signals below.", "Commencez par les signaux ci-dessous."))}</span></li><li><strong>${escapeHtml(L("Choose one priority", "Choisissez une priorité"))}</strong><span>${escapeHtml(L("Open only the area you want to improve.", "Ouvrez uniquement le domaine à améliorer."))}</span></li><li><strong>${escapeHtml(L("Compare before confirming", "Comparez avant de confirmer"))}</strong><span>${escapeHtml(L("Nothing is spent until you add a decision to the plan.", "Rien n’est dépensé avant l’ajout d’une décision au plan."))}</span></li></ol><button class="button secondary" data-dismiss-guide>${escapeHtml(L("Got it", "J’ai compris"))}</button></section>` : ""}
      <div class="dashboard-grid compact-three">
        ${metricCard(L("Net result", "Résultat net"), forecastText(forecast.financial.netResult, "money"), forecastPrecision() === "exact" ? pct(forecast.financial.margin) : L("Forecast", "Prévision"), hideOutcomes ? "" : forecast.financial.netResult >= 0 ? "good" : "bad")}
        ${metricCard(L("Cases served", "Cas traités"), hideOutcomes ? forecastText(0, "number") : `${forecastText(forecast.operational.totalHonored, "number")} / ${number(forecast.operational.totalDemand)}`, forecastPrecision() === "exact" ? `${pct(forecast.operational.honoredRate)} ${L("of open requests", "des demandes ouvertes")}${unmetRequests(forecast) ? ` · ${number(unmetRequests(forecast))} ${L("not offered", "non proposées")}` : ""}` : "", hideOutcomes ? "" : forecast.operational.honoredRate >= .82 ? "good" : "warn")}
        ${metricCard(L("Team workload", "Charge de l’équipe"), forecastText(forecast.operational.staffUse, "percent"), "", forecast.operational.staffUse > .94 ? "bad" : "")}
        ${metricCard(L("Carbon footprint", "Empreinte carbone"), tonnes(forecast.carbon.total), `${carbonDelta > 0 ? "+" : ""}${tonnes(carbonDelta)} ${L("vs start", "par rapport au départ")}`, carbonDelta <= 0 ? "good" : "warn")}
        ${metricCard(L("Staff climate", "Climat de l’équipe"), forecastText(forecast.social.after.staffClimate, "number"), "", hideOutcomes ? "" : forecast.social.after.staffClimate < 45 ? "bad" : forecast.social.after.staffClimate >= 60 ? "good" : "warn")}
        ${metricCard(L("Client trust", "Confiance des clients"), forecastText(forecast.social.after.clientTrust, "number"), "", hideOutcomes ? "" : forecast.social.after.clientTrust < 45 ? "warn" : forecast.social.after.clientTrust >= 60 ? "good" : "")}
      </div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("What needs attention", "Points d’attention"))}</h2><p>${escapeHtml(L("Each signal explains what is happening and where you can investigate it.", "Chaque signal explique ce qui se passe et où l’examiner."))}</p></div></div><div class="priority-list">${signals.map((item) => `<article class="signal-${item.status}" data-signal-key="${item.key}"><div><span>${escapeHtml(item.title)}</span><strong>${escapeHtml(item.text)}</strong></div><div class="signal-actions">${signalButton(item.destination, item.action, "primary")}${item.secondary ? signalButton(item.secondary.destination, item.secondary.label, "secondary") : ""}</div></article>`).join("")}</div></section>
      <section class="card-section goals"><div class="panel-heading"><h2>${escapeHtml(L("Scenario goals", "Objectifs du scénario"))}</h2><strong>${hideOutcomes ? "?" : `${passed}/${goals.length}`}</strong></div>${goals.map((goal) => hideOutcomes ? `<div class="goal-row"><span aria-hidden="true">○</span><strong>${escapeHtml(itemLabel(goal.label))}</strong><em>${escapeHtml(L("Revealed at year end", "Révélé en fin d’année"))}</em></div>` : `<div class="goal-row ${goal.ok ? "good" : "bad"}"><span aria-hidden="true">${goal.ok ? "✓" : "○"}</span><strong>${escapeHtml(itemLabel(goal.label))}</strong><em>${escapeHtml(goal.display)}</em></div>`).join("")}</section>
    </section>`;
  }

  function renderFacilityUse(forecast) {
    const rows = (forecast.operational.facilityRows || []).filter((row) => row.capacity > 0);
    if (!rows.length) return "";
    return `<section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Rooms & equipment use", "Utilisation des salles et équipements"))}</h2><p>${escapeHtml(L("When a room or machine is full, every service using it loses the same share of cases.", "Quand une salle ou un appareil est saturé, chaque service qui l’utilise perd la même part de cas."))}</p></div></div><div class="facility-list">${rows.map((row) => `<article class="${row.full ? "full" : ""}"><div class="facility-head"><strong>${escapeHtml(facilityName(row))}</strong>${row.full ? `<span class="badge bad">${escapeHtml(L("Full", "Saturé"))}</span>` : ""}<span>${number(row.used)} / ${number(row.capacity)} h · ${pct(row.rate)}</span></div>${meter(row.rate, row.full ? "bad" : row.rate > .85 ? "warn" : "good")}<small>${escapeHtml(row.services.length ? row.services.map(serviceName).join(", ") : L("Not used by any open service", "Utilisé par aucun service ouvert"))}</small>${row.full ? `<p class="bad-text">${escapeHtml(L(`${number(row.turnedAway)} requests turned away. Add capacity, extend opening hours, or use a faster pace.`, `${number(row.turnedAway)} demandes refusées. Ajoutez de la capacité, étendez les horaires ou accélérez le rythme.`))}</p><div class="button-row"><button class="button secondary" data-open-drawer="${row.kind === "room" ? "rooms" : "equipment"}">${escapeHtml(L("Add capacity", "Ajouter de la capacité"))}</button><button class="button secondary" data-open-drawer="opening">${escapeHtml(L("Opening hours", "Horaires d’ouverture"))}</button></div>` : ""}</article>`).join("")}</div></section>`;
  }

  function renderCare(planned, forecast) {
    const active = D.services.filter((service) => planned.services[service.id].active);
    const roomCount = Object.values(planned.rooms).reduce((sum, qty) => sum + qty, 0);
    const equipmentCount = Object.values(planned.equipment).reduce((sum, qty) => sum + qty.owned + qty.leased, 0);
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Care & facilities", "Soins et installations"))}</h1><p>${escapeHtml(L("Start from what is active; open the catalog only when you want to change something.", "Partez de l’existant ; ouvrez le catalogue uniquement pour effectuer un changement."))}</p></div></div>
      <div class="dashboard-grid compact-four">${metricCard(L("Active services", "Services actifs"), number(active.length), `${forecast.operational.readyServices} ${L("ready and staffed", "prêts et dotés en personnel")}`)}${metricCard(L("Cases served", "Cas traités"), number(forecast.operational.totalHonored), `${pct(forecast.operational.honoredRate)} ${L("of open requests", "des demandes ouvertes")}${unmetRequests(forecast) ? ` · ${number(unmetRequests(forecast))} ${L("not offered", "non proposées")}` : ""}`)}${metricCard(L("Rooms", "Salles"), number(roomCount))}${metricCard(L("Clinical equipment", "Équipement clinique"), number(equipmentCount))}</div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Current services", "Services actuels"))}</h2><p>${escapeHtml(L("Readiness and the current bottleneck are shown without exposing the whole catalog.", "La préparation et le blocage actuel sont visibles sans afficher tout le catalogue."))}</p></div><span class="panel-links"><button class="text-button" data-toggle-closed>${escapeHtml(ui.showClosedServices ? L("Hide closed services", "Masquer les services fermés") : L("Show closed services", "Afficher les services fermés"))}</button><button class="button primary" data-open-drawer="services">${escapeHtml(L("Explore services", "Explorer les services"))}</button></span></div><div class="summary-list">${(ui.showClosedServices ? D.services : active).map((service) => { const row = forecast.serviceResults.find((item) => item.id === service.id); return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong><span>${escapeHtml(serviceStatusLabel(row))}</span></div><span>${row.active ? `${number(row.honored)} / ${number(row.demand)} ${escapeHtml(L("served", "traités"))}${row.rampUp ? ` · ${escapeHtml(L("first year · 60% of demand", "première année · 60 % de la demande"))}` : ""}` : `${number(row.demand)} ${escapeHtml(L("requests if opened", "demandes si ouvert"))}`}</span><em>${escapeHtml(row.active ? blockerText(row.bottleneck) : missingRequirements(service, planned).length ? L("Missing requirements", "Conditions manquantes") : L("Ready to open", "Prêt à ouvrir"))}</em><button class="text-button" data-open-drawer="services" data-service="${service.id}">${escapeHtml(L("Details", "Détails"))} ›</button></article>`; }).join("")}</div></section>
      ${renderFacilityUse(forecast)}
      <section class="card-section split-actions"><article><h2>${escapeHtml(L("Rooms", "Salles"))}</h2><p>${escapeHtml(L("Fit out or close rooms after checking rent, capacity, and energy consequences.", "Aménagez ou fermez des salles après avoir vérifié le loyer, la capacité et l’énergie."))}</p><button class="button primary" data-open-drawer="rooms">${escapeHtml(L("Manage rooms", "Gérer les salles"))}</button></article><article><h2>${escapeHtml(L("Equipment", "Équipement"))}</h2><p>${escapeHtml(L("Buy, lease, sell, or return clinical equipment.", "Achetez, louez, vendez ou restituez l’équipement clinique."))}</p><button class="button primary" data-open-drawer="equipment">${escapeHtml(L("Manage equipment", "Gérer l’équipement"))}</button></article></section>
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
      <div class="dashboard-grid compact-four">${metricCard(L("Veterinary hours available", "Heures vétérinaires disponibles"), number(vetHours))}${metricCard(L("Support hours available", "Heures de soutien disponibles"), number(supportHours))}${metricCard(L("Team workload", "Charge de l’équipe"), pct(forecast.operational.staffUse))}${metricCard(L("Unused team hours", "Heures d’équipe inutilisées"), number(unusedHours))}</div>
      ${signals.length ? `<section class="hour-signals" aria-label="${escapeHtml(L("Hours needing attention", "Heures à surveiller"))}">${signals.slice(0, 3).map((signal) => `<p><span aria-hidden="true">${signal.icon}</span>${escapeHtml(signal.text)}</p>`).join("")}</section>` : ""}
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Current team", "Équipe actuelle"))}</h2><span class="panel-links"><button class="text-button" data-open-drawer="capabilities">${escapeHtml(L("Who can do what", "Qui peut faire quoi"))} ›</button><button class="text-button" data-open-drawer="hoursByService">${escapeHtml(L("See hours by service", "Voir les heures par service"))} ›</button></span></div><button class="button secondary" data-open-drawer="training">${escapeHtml(L("Plan training", "Planifier une formation"))}</button><button class="button secondary" data-open-drawer="relations">${escapeHtml(L("Act on climate and trust", "Agir sur le climat et la confiance"))}</button></div><div class="staff-grid">${planned.staff.map((person) => { const row = rows[person.id]; const summary = normalizeAllocations(person).map((allocation) => `${serviceName(allocation.serviceId)} ${Math.round(allocation.share * 100)}%`).join(" · "); return `<article class="staff-card"><div class="staff-head"><div><h3>${escapeHtml(person.name)}</h3><span>${escapeHtml(person.role === "vet" ? L("Veterinarian", "Vétérinaire") : L("Support", "Soutien"))}</span></div><strong>${pct(row?.workload || 0)}</strong></div><div class="chips" aria-label="${escapeHtml(L("Skills", "Compétences"))}">${person.skills.length ? person.skills.map((skill) => `<span class="chip">${escapeHtml(skillName(skill))}</span>`).join("") : `<span class="chip">${escapeHtml(L("No specialist skills", "Aucune compétence spécialisée"))}</span>`}</div><p class="allocation-summary">${escapeHtml(summary)}</p>${(() => { const zone = allocationZone(row?.assignedShare ?? 1); return `<p class="staff-zone ${zone.tone}">${escapeHtml(zone.text)}</p>`; })()}${(() => { const closed = closedAssignments(person, planned); if (!closed.length) return ""; const hours = closed.reduce((sum, item) => sum + (row?.availableHours || 0) * item.share, 0); const names = closed.map((item) => serviceName(item.serviceId)).join(", "); return `<p class="staff-zone bad">△ ${escapeHtml(L(`${number(hours)} h on closed services (${names}) produce nothing`, `${number(hours)} h sur des services fermés (${names}) ne produisent rien`))}</p>`; })()}<div class="staff-hours-line"><span>${escapeHtml(L("Hours used", "Heures utilisées"))}</span><strong>${number(row?.usedHours || 0)} / ${number(row?.availableHours || 0)}${row?.overtimeHours > 0 ? ` · ${escapeHtml(L("overtime", "heures sup."))} ${number(row.overtimeHours)}` : ""}</strong></div>${meter(row?.workload || 0, row?.workload > 1 ? "bad" : row?.workload > .94 ? "warn" : "good")}<div class="button-row"><button class="button primary" data-open-drawer="staffAllocation" data-context="${person.id}">${escapeHtml(L("Change time allocation", "Modifier l’affectation du temps"))}</button><button class="button secondary" data-open-drawer="staffPerson" data-context="${person.id}">${escapeHtml(L("Pay", "Salaire"))}</button>${pendingActions().some((action) => (action.payload.kind === "hire" && action.payload.targetId === person.id) || (action.payload.kind === "training" && action.payload.personId === person.id)) ? "" : `<button class="button secondary" data-open-drawer="staffExit" data-context="${person.id}">${escapeHtml(L("Let go", "Se séparer"))}</button>`}</div></article>`; }).join("")}</div></section>
      <section class="card-section"><div class="panel-heading"><h2>${escapeHtml(L("How the clinic operates", "Fonctionnement de la clinique"))}</h2></div><div class="operation-rows">
        <button data-open-drawer="opening"><span>${escapeHtml(L("Opening schedule", "Horaires d’ouverture"))}</span><strong>${escapeHtml(openingNames.join(", ") || L("Standard daytime", "Journée standard"))}</strong><em>›</em></button>
        <button data-open-drawer="dropoff"><span>${escapeHtml(L("Drop-off workflow", "Parcours de dépôt"))}</span><strong>${escapeHtml(planned.operations.dropoff ? L("Enabled", "Activé") : L("Disabled", "Désactivé"))}</strong><em>›</em></button>
        <button data-open-drawer="stock"><span>${escapeHtml(L("Stock strategy", "Stratégie de stock"))}</span><strong>${escapeHtml(itemLabel(D.stockStrategies[planned.operations.stockStrategy].name))}</strong><em>›</em></button>
        <button data-open-drawer="hr"><span>${escapeHtml(L("HR strategy", "Stratégie RH"))}</span><strong>${escapeHtml(itemLabel(D.hrStrategies[planned.hr.strategy].name))}</strong><em>›</em></button>
      </div></section>
    </section>`;
  }

  function allocationZone(share) {
    const percent = Math.round(share * 100);
    if (percent > 100) return { tone: "bad", text: L(`${percent}% assigned · ${percent - 100}% overtime`, `${percent} % affectés · ${percent - 100} % d’heures supplémentaires`) };
    if (percent < 100) return { tone: "warn", text: L(`${percent}% assigned · ${100 - percent}% idle but paid`, `${percent} % affectés · ${100 - percent} % inoccupés mais payés`) };
    return { tone: "good", text: L("100% assigned", "100 % affectés") };
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
    return `<p>${escapeHtml(L("Each service needs work from a veterinarian, support staff, or both, and sometimes a specific skill. Allocate people only where they show ✓; △ hours stay blocked until that person is trained. Vets can also cover support tasks, but their hours cost more.", "Chaque service demande du travail vétérinaire, de soutien, ou les deux, et parfois une compétence précise. Affectez les personnes là où elles ont ✓ ; les heures △ restent bloquées jusqu’à la formation de cette personne. Les vétérinaires peuvent aussi assurer les tâches de soutien, mais leurs heures coûtent plus cher."))}</p><p class="cap-legend"><span class="cap-yes">✓ ${escapeHtml(L("qualified now", "qualifié maintenant"))}</span><span class="cap-train">△ ${escapeHtml(L("needs training", "formation nécessaire"))}</span><span class="cap-none">— ${escapeHtml(L("role not used by this service", "fonction non utilisée par ce service"))}</span></p><div class="table-scroll"><table class="capability-table"><thead><tr><th scope="col">${escapeHtml(L("Service", "Service"))}</th>${planned.staff.map((person) => `<th scope="col">${escapeHtml(person.name)}<small>${escapeHtml(roleLabel(person.role))}</small></th>`).join("")}</tr></thead><tbody>${services.map((service) => { const note = facilityNote(service); return `<tr><th scope="row">${escapeHtml(serviceName(service.id))}<small>${escapeHtml(planned.services[service.id].active ? L("Open", "Ouvert") : L("Closed", "Fermé"))}${note ? ` · ${escapeHtml(note)}` : ""}</small></th>${planned.staff.map((person) => cell(person, service)).join("")}</tr>`; }).join("")}</tbody></table></div>`;
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
    if (row) {
      parts.push(L(`Service needs ${number(row.neededHours)} h of ${person.role === "vet" ? "vet" : "support"} work; team assigned ${number(row.effectiveHours)} h`, `Le service demande ${number(row.neededHours)} h de travail ${person.role === "vet" ? "vétérinaire" : "de soutien"} ; l’équipe en affecte ${number(row.effectiveHours)} h`));
      if (row.surplusHours > 1) parts.push(L(`${number(row.surplusHours)} h more than needed will go unused`, `${number(row.surplusHours)} h de plus que nécessaire resteront inutilisées`));
      else if (row.shortageHours > 1) parts.push(L(`${number(row.shortageHours)} h short`, `${number(row.shortageHours)} h manquantes`));
    }
    if (vetCoversSupport(person, service)) {
      const supportStaff = planned.staff.filter((item) => item.role === "support");
      const supportRate = supportStaff.length ? supportStaff.reduce((sum, item) => sum + item.salary / item.capacity, 0) / supportStaff.length : 20;
      parts.push(L(`covering support work at vet cost (${money(person.salary / person.capacity)}/h vs about ${money(supportRate)}/h for support staff)`, `tâches de soutien au coût vétérinaire (${money(person.salary / person.capacity)}/h contre environ ${money(supportRate)}/h pour le soutien)`));
    }
    return parts.length ? `<small>${escapeHtml(parts.join(" · "))}</small>` : "";
  }

  // These four cells read from the DRAFT, not from the saved allocation: they used to show the same
  // figures whatever the student was dragging, and contradicted the workload line three rows below.
  // `unused` is derived from available hours alone — the model's own unusedHours falls back to
  // assigned hours above 100%, which made the cells stop adding up. The invariant held here is
  // available + overtime = used + unused + blocked, at every share including 130%.
  function hoursCells(row) {
    const available = row?.availableHours || 0;
    const used = row?.usedHours || 0;
    const blocked = row?.blockedHours || 0;
    const overtime = row?.overtimeHours || 0;
    const unused = Math.max(0, available - used - blocked);
    return [
      [L("Available hours", "Heures disponibles"), available],
      [L("Hours used", "Heures utilisées"), used],
      ...(overtime >= .5 ? [[L("Overtime hours", "Heures supplémentaires"), overtime]] : []),
      [L("Unused hours", "Heures inutilisées"), unused],
      [L("Blocked hours", "Heures bloquées"), blocked]
    ];
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
    const draftOvertimeCost = (draftRow?.overtimePay || 0) * (1 + SOCIAL_CHARGE_RATE);
    const draftBlocked = draftRow?.blockedHours || 0;
    const draftUsed = draftRow?.usedHours || 0;
    const draftUnused = Math.max(0, (draftRow?.availableHours || 0) - draftUsed - draftBlocked);
    const meterText = percent === 0 ? L("0% assigned — give this person at least one service", "0 % affectés — donnez au moins un service à cette personne")
      : draftBlocked >= 1 && draftUsed < 1 ? L(`${percent}% assigned, but all ${number(draftBlocked)} h are blocked until training — no cases can be handled`, `${percent} % affectés, mais les ${number(draftBlocked)} h sont bloquées jusqu’à la formation — aucun cas ne peut être traité`)
      : draftBlocked >= 1 ? L(`${percent}% assigned · ${number(draftBlocked)} h blocked until training`, `${percent} % affectés · ${number(draftBlocked)} h bloquées jusqu’à la formation`)
      : percent > 100 ? L(`${percent}% assigned · up to ${number(draftRow?.overtimeAssignedHours || 0)} overtime hours (max ${Math.round(MAX_ALLOCATION * 100)}%). Forecast worked: ${number(draftRow?.overtimeHours || 0)} h ≈ ${money(draftOvertimeCost)}`, `${percent} % affectés · jusqu’à ${number(draftRow?.overtimeAssignedHours || 0)} heures supplémentaires (max ${Math.round(MAX_ALLOCATION * 100)} %). Prévu : ${number(draftRow?.overtimeHours || 0)} h ≈ ${money(draftOvertimeCost)}`)
      : draftUnused >= 1 ? L(`${percent}% assigned · ${number(draftUnused)} h paid and unused`, `${percent} % affectés · ${number(draftUnused)} h payées sans emploi`)
      : L("100% assigned — fully booked, no overtime", "100 % affectés — temps plein, sans heures supplémentaires");
    const zoneClass = !valid ? "warn" : percent > 100 ? "overtime" : percent < 100 ? "idle" : "ready";
    const hoursFlow = currentRow ? L(`${number(currentRow.contractedHours)} contracted − ${number(currentRow.expectedAbsenceHours)} expected absence${absenceNote(currentRow)} − ${number(currentRow.trainingHours)} training${currentRow.onboardingHours > 1 ? ` − ${number(currentRow.onboardingHours)} onboarding` : ""} −${number(currentRow.nonClinicalHours)} other duties = ${number(currentRow.availableHours)} available hours`, `${number(currentRow.contractedHours)} contractuelles − ${number(currentRow.expectedAbsenceHours)} d’absence prévue${absenceNote(currentRow)} − ${number(currentRow.trainingHours)} de formation${currentRow.onboardingHours > 1 ? ` − ${number(currentRow.onboardingHours)} d’intégration` : ""} −${number(currentRow.nonClinicalHours)} d’autres tâches = ${number(currentRow.availableHours)} heures disponibles`) : "";
    return `<div class="allocation-editor">${closedHoursWarning(person, planned, currentRow?.availableHours)}<p class="callout">${escapeHtml(L(`Up to 100%, changing percentages moves existing hours; it does not create new hours. Above 100% is paid overtime (${OVERTIME_PREMIUM}× pay, maximum ${Math.round(MAX_ALLOCATION * 100)}%) and lowers staff climate. Below 100% is paid idle time.`, `Jusqu’à 100 %, modifier les pourcentages déplace des heures existantes ; cela ne crée pas de nouvelles heures. Au-delà de 100 %, ce sont des heures supplémentaires payées (${String(OVERTIME_PREMIUM).replace(".", ",")}× le salaire, ${Math.round(MAX_ALLOCATION * 100)} % maximum) qui dégradent le climat d’équipe. En dessous, le temps payé reste inoccupé.`))}</p>${hoursFlow ? `<p class="hours-flow">${escapeHtml(hoursFlow)}</p>` : ""}<div class="mini-hours">${hoursCells(draftRow).map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${number(value || 0)}</strong></div>`).join("")}</div><div class="allocation-total ${zoneClass}"><strong>${escapeHtml(meterText)}</strong>${meter(total / MAX_ALLOCATION, percent > 100 ? "bad" : valid && percent === 100 ? "good" : "warn")}</div><div class="allocation-rows">${draft.map((allocation, index) => { const service = SERVICE_BY_ID[allocation.serviceId]; const qualified = personQualified(person, service); const hours = (currentRow?.availableHours || 0) * allocation.share; return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong>${qualified ? "" : `<span class="qualification-warning">△ ${escapeHtml(L("Needs training", "Formation nécessaire"))}</span>`}<small>${number(hours)} ${escapeHtml(qualified ? L("assigned hours", "heures affectées") : L("hours blocked until training", "heures bloquées jusqu’à la formation"))}</small>${allocationRowNote(person, service, comparison.after, planned)}${allocationRemainder(draft, index) > 0 ? `<button class="text-button" data-allocation-fill="${index}">${escapeHtml(L(`Use remaining ${number((currentRow?.availableHours || 0) * allocationRemainder(draft, index))} h`, `Utiliser les ${number((currentRow?.availableHours || 0) * allocationRemainder(draft, index))} h restantes`))}</button>` : ""}</div><div class="stepper" role="group" aria-label="${escapeHtml(serviceName(service.id))}"><button data-allocation-adjust="-5" data-allocation-index="${index}" aria-label="${escapeHtml(L("Reduce by 5%", "Réduire de 5 %"))}">−</button><output>${Math.round(allocation.share * 100)}%</output><button data-allocation-adjust="5" data-allocation-index="${index}" ${total >= MAX_ALLOCATION - .0001 ? "disabled" : ""} aria-label="${escapeHtml(L("Increase by 5%", "Augmenter de 5 %"))}">+</button><button class="remove-allocation" data-remove-allocation="${index}" aria-label="${escapeHtml(L("Remove service", "Retirer le service"))}">×</button></div></article>`; }).join("")}</div>${ordered.length ? `<div class="add-allocation"><label><span>${escapeHtml(L("Add another service", "Ajouter un autre service"))}</span><select data-allocation-service>${optionGroup(L("Active and planned services", "Services actifs et planifiés"), activeOptions)}${optionGroup(L("Other services", "Autres services"), otherOptions)}${optionGroup(L("Needs training", "Formation nécessaire"), trainingOptions)}</select></label><button class="button secondary" data-add-allocation>${escapeHtml(L("Add at 0%", "Ajouter à 0 %"))}</button></div>` : ""}${remainingBlockers.length ? `<div class="requirement-list"><strong>${escapeHtml(L("Other blockers still apply", "D’autres blocages restent à résoudre"))}</strong>${remainingBlockers.map((item) => `<div><span>△ ${escapeHtml(serviceName(item.serviceId))}: ${escapeHtml(blockerText(item.reason))}</span></div>`).join("")}</div>` : ""}<section class="allocation-impact"><h3>${escapeHtml(L("Live impact", "Impact en direct"))}</h3><div class="comparison-list"><div><strong>${escapeHtml(L("This person’s workload", "Charge de cette personne"))}</strong><span>${pct(currentRow?.workload || 0)}</span><em>→ ${pct(draftRow?.workload || 0)}</em></div><div><strong>${escapeHtml(L("Team workload", "Charge de l’équipe"))}</strong><span>${pct(comparison.before.operational.staffUse)}</span><em>→ ${pct(comparison.after.operational.staffUse)}</em></div><div><strong>${escapeHtml(L("Cases served", "Cas traités"))}</strong><span>${escapeHtml(forecastText(comparison.before.operational.totalHonored, "number"))}</span><em>→ ${escapeHtml(forecastText(comparison.after.operational.totalHonored, "number"))}</em></div><div><strong>${escapeHtml(L("Net result", "Résultat net"))}</strong><span>${escapeHtml(forecastText(comparison.before.financial.netResult, "money"))}</span><em>→ ${escapeHtml(forecastText(comparison.after.financial.netResult, "money"))}</em></div>${comparison.before.financial.overtimeCost >= 1 || comparison.after.financial.overtimeCost >= 1 ? `<div><strong>${escapeHtml(L("Overtime cost", "Coût des heures supplémentaires"))}</strong><span>${money(comparison.before.financial.overtimeCost)}</span><em>→ ${money(comparison.after.financial.overtimeCost)}</em></div>` : ""}<div><strong>${escapeHtml(L("Staff climate", "Climat de l’équipe"))}</strong><span>${number(comparison.before.social.after.staffClimate)}</span><em>→ ${number(comparison.after.social.after.staffClimate)}</em></div><div><strong>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</strong><span>${tonnes(comparison.before.carbon.total)}</span><em>→ ${tonnes(comparison.after.carbon.total)}</em></div></div>${serviceDeltas.length ? `<ul>${serviceDeltas.map((row) => `<li><strong>${escapeHtml(serviceName(row.id))}:</strong> ${escapeHtml(row.cases > 0 ? L(`${row.cases} additional cases possible`, `${row.cases} cas supplémentaires possibles`) : L(`${Math.abs(row.cases)} fewer cases possible`, `${Math.abs(row.cases)} cas possibles en moins`))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No change in cases served with this draft.", "Aucun changement des cas traités avec ce brouillon."))}</p>`}</section><button class="button primary" data-review-allocation="${person.id}" ${valid ? "" : "disabled"}>${escapeHtml(L("Review allocation", "Examiner l’affectation"))}</button></div>`;
  }

  function renderHoursByService(forecast) {
    const rows = forecast.operational.serviceHourRows.filter((row) => state.services[row.serviceId]?.active || row.assignedHours > 0);
    return `<p>${escapeHtml(L("Hours assigned to a service remain there even when another room, skill, or equipment requirement blocks care.", "Les heures affectées à un service y restent même si une salle, une compétence ou un équipement bloque les soins."))}</p><div class="hours-table" role="table"><div role="row"><strong>${escapeHtml(L("Service", "Service"))}</strong><strong>${escapeHtml(L("Role", "Fonction"))}</strong><strong>${escapeHtml(L("Assigned", "Affectées"))}</strong><strong>${escapeHtml(L("Needed", "Nécessaires"))}</strong><strong>${escapeHtml(L("Used", "Utilisées"))}</strong><strong>${escapeHtml(L("Balance", "Solde"))}</strong></div>${rows.map((row) => `<div role="row"><span>${escapeHtml(serviceName(row.serviceId))}</span><span>${escapeHtml(row.role === "vet" ? L("Vet", "Vét.") : L("Support", "Soutien"))}</span><span>${number(row.assignedHours)}</span><span>${number(row.neededHours)}</span><span>${number(row.usedHours)}</span><strong class="${row.shortageHours > 0 ? "bad-text" : "good-text"}">${row.shortageHours > 0 ? `−${number(row.shortageHours)}` : `+${number(row.surplusHours)}`}</strong></div>`).join("")}</div>`;
  }

  function renderExportDrawer() {
    return `<p>${escapeHtml(L("Enter your team code, then choose a readable report or the full analysis file.", "Saisissez votre code d’équipe, puis choisissez un rapport lisible ou le fichier d’analyse complet."))}</p><div class="form-stack"><label><span>${escapeHtml(L("Team code", "Code d’équipe"))}</span><input type="text" maxlength="24" value="${escapeHtml(state.playerTeam.teamCode || "")}" data-team-code placeholder="${escapeHtml(L("For example G-07", "Par exemple G-07"))}"><small>${escapeHtml(L("Use the code your instructor gives you, not names.", "Utilisez le code donné par votre enseignant, pas des noms."))}</small></label></div><div class="export-choices"><article><h3>${escapeHtml(L("Printable report", "Rapport imprimable"))}</h3><p>${escapeHtml(L("A detailed report for every completed year, including actions, hours, carbon results, and the team’s written reflections.", "Un rapport détaillé pour chaque année terminée, avec les actions, les heures, les résultats carbone et les réflexions écrites de l’équipe."))}</p><button class="button primary" data-print-report>${escapeHtml(L("Print / Save as PDF", "Imprimer / Enregistrer en PDF"))}</button></article><article><h3>${escapeHtml(L("Analytical data", "Données analytiques"))}</h3><p>${escapeHtml(L("The complete structured clinic state and reports for further analysis.", "L’état complet et structuré de la clinique et les rapports pour une analyse ultérieure."))}</p><button class="button secondary" data-download-json>${escapeHtml(L("Download analytical JSON", "Télécharger le JSON analytique"))}</button></article></div>`;
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

  function renderBusiness(planned, forecast) {
    const location = D.locations[planned.location.sectorId];
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Business", "Gestion"))}</h1><p>${escapeHtml(L("Prices, financing, market position, and location—opened one decision at a time.", "Prix, financement, marché et implantation — une décision à la fois."))}</p></div></div>
      <div class="dashboard-grid compact-five">${metricCard(L("Revenue", "Recettes"), money(forecast.financial.revenue))}${metricCard(L("Total costs", "Coûts totaux"), money(forecast.financial.totalCosts), overtimeNote(forecast))}${metricCard(L("Variable costs", "Coûts variables"), money(forecast.financial.variableCosts), variableCostNote(forecast))}${metricCard(L("Net result", "Résultat net"), money(forecast.financial.netResult), pct(forecast.financial.margin), forecast.financial.netResult >= 0 ? "good" : "bad")}${metricCard(L("End treasury", "Trésorerie finale"), money(forecast.financial.treasury))}</div>
      <section class="card-section action-menu"><button data-open-drawer="pricing"><span>${escapeHtml(L("Service prices", "Prix des services"))}</span><strong>${escapeHtml(L("Review price sensitivity and money left after supplies", "Voir la sensibilité au prix et l’argent restant après les fournitures"))}</strong><em>›</em></button><button data-open-drawer="finance"><span>${escapeHtml(L("Financing", "Financement"))}</span><strong>${escapeHtml(planned.finance.loan ? money(planned.finance.loan.remaining) : L("No outstanding loan", "Aucun emprunt"))}</strong><em>›</em></button><button data-open-drawer="market"><span>${escapeHtml(L("Market focus", "Marché cible"))}</span><strong>${escapeHtml(itemLabel(D.segments[planned.marketFocus].name))}</strong><em>›</em></button><button data-open-drawer="location"><span>${escapeHtml(L("Location and parking", "Implantation et parking"))}</span><strong>${escapeHtml(itemLabel(location.name))}</strong><em>›</em></button><button data-open-drawer="marketing"><span>${escapeHtml(L("Market strategies", "Stratégies de marché"))}</span><strong>${escapeHtml(L("Communication, competitor monitoring, and local market research", "Communication, veille concurrentielle et étude du marché local"))}</strong><em>›</em></button></section>
    </section>`;
  }

  function renderSustainability(planned, forecast) {
    const baseline = state.carbonBaseline;
    const delta = forecast.carbon.total - baseline.total;
    const reduction = baseline.perCase ? 1 - forecast.carbon.perCase / baseline.perCase : 0;
    const sources = ["building", "clinical", "waste", "travel"];
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Sustainability", "Durabilité"))}</h1><p>${escapeHtml(L("Choose a source, see the trade-off, and decide whether it fits the clinic.", "Choisissez une source, observez le compromis et décidez s’il convient à la clinique."))}</p></div></div>
      <div class="dashboard-grid compact-four">${metricCard(L("Carbon footprint", "Empreinte carbone"), tonnes(forecast.carbon.total), `${delta > 0 ? "+" : ""}${tonnes(delta)} ${L("vs start", "par rapport au départ")}`, delta <= 0 ? "good" : "warn")}${metricCard(L("Per treated case", "Par cas traité"), kilograms(forecast.carbon.perCase), `${pct(reduction)} ${L("change", "d’évolution")}`, reduction > 0 ? "good" : "warn")}${metricCard(L("Largest source", "Source principale"), sourceLabel(forecast.carbon.primaryDrivers[0]), tonnes(forecast.carbon.bySource[forecast.carbon.primaryDrivers[0]]))}${metricCard(L("Scenario target", "Objectif du scénario"), pct(({ balanced: .15, rescue: .08, growth: .20 })[state.scenarioId]), L("reduction per case while retaining 80% of starting care", "de réduction par cas en conservant 80 % des soins initiaux"))}</div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Where the footprint comes from", "Origine de l’empreinte"))}</h2><p>${escapeHtml(L("Select one source to see only the relevant choices.", "Sélectionnez une source pour ne voir que les choix pertinents."))}</p></div></div><div class="source-list">${sources.map((id) => { const value = forecast.carbon.bySource[id]; const share = forecast.carbon.total ? value / forecast.carbon.total : 0; return `<article><div><strong>${escapeHtml(sourceLabel(id))}</strong><span>${tonnes(value)} · ${pct(share)}</span></div>${meter(share, id === forecast.carbon.primaryDrivers[0] ? "warn" : "good")}<button class="button secondary" data-open-drawer="sustainability" data-context="${id}">${escapeHtml(L("See options", "Voir les options"))}</button></article>`; }).join("")}</div></section>
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
    return `<article class="selected-service"><div class="card-status"><h3>${escapeHtml(serviceName(selectedId))}</h3><span>${escapeHtml(active ? L("Open", "Ouvert") : L("Closed", "Fermé"))}</span></div><div class="service-stats"><div><span>${escapeHtml(L("Expected requests", "Demandes prévues"))}</span><strong>${number(row.demand)}</strong></div><div><span>${escapeHtml(L("Current price", "Prix actuel"))}</span><strong>${money(planned.services[selectedId].price)}</strong></div><div><span>${escapeHtml(L("Money left after direct supplies", "Argent restant après les fournitures directes"))}</span><strong>${money(row.contributionPerCase)} · ${escapeHtml(L(`supplies ${pct(service.variableCost)}`, `fournitures ${pct(service.variableCost)}`))}</strong></div><div><span>${escapeHtml(L("Vet time per case", "Temps vétérinaire par cas"))}</span><strong>${decimal(vetDuration(service, planned), 2)} h</strong></div><div><span>${escapeHtml(L("Support time per case", "Temps de soutien par cas"))}</span><strong>${decimal(supportDuration(service, planned), 2)} h</strong></div></div><p class="service-time-note">${escapeHtml(L("Each case uses both at the same time. A vet can cover the support part; support staff cannot cover the vet part.", "Chaque cas consomme les deux en même temps. Un vétérinaire peut assurer la partie soutien ; le personnel de soutien ne peut pas assurer la partie vétérinaire."))}</p>${(() => { const staffers = planned.staff.filter((person) => roleCompatible(person, service)); const text = staffers.length ? staffers.map((person) => `${person.name} (${roleLabel(person.role).toLowerCase()}${personQualified(person, service) ? "" : `, ${L("needs training", "formation nécessaire")}`})`).join(", ") : L("Nobody on the current team", "Personne dans l’équipe actuelle"); return `<p class="who-can"><strong>${escapeHtml(L("Who can staff this", "Qui peut assurer ce service"))}:</strong> ${escapeHtml(text)}</p>`; })()}${requirementList(service, planned)}${consequencePreview(`service:${selectedId}:active`, payload)}${reviewButton(`service:${selectedId}:active`, payload, active ? L("Close service", "Fermer le service") : L("Open service", "Ouvrir le service"))}${renderPaceOptions(service, planned)}<button class="text-button next-service" data-select-service="${next}">${escapeHtml(L(`Next service: ${serviceName(next)}`, `Service suivant : ${serviceName(next)}`))} ›</button></article>`;
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
    if (ui.drawer === "capabilities") return renderCapabilitiesDrawer(planned);
    if (ui.drawer === "export") return renderExportDrawer();
    if (ui.drawer === "services") return renderServiceDrawer(planned, forecast);
    if (ui.drawer === "rooms") return `<div class="drawer-cards">${focusFirst(Object.entries(D.rooms)).map(([id, room]) => { const qty = planned.rooms[id]; const add = { kind: "room-add", targetId: id }; return `<article${targetCard(id)}><h3>${escapeHtml(itemLabel(room.name))} · ${qty}</h3><p>${money(room.fitout)} ${escapeHtml(L("once", "une fois"))} · ${money(room.annualRent)}/${escapeHtml(L("year", "an"))}</p>${consequencePreview(`room:${id}`, add)}<div class="button-row">${reviewButton(`room:${id}`, add, L("Fit out a room", "Aménager une salle"))}${qty > room.baseIncluded ? reviewButton(`room:${id}`, { kind: "room-close", targetId: id }, L("Close a room", "Fermer une salle")) : ""}</div></article>`; }).join("")}</div>`;
    if (ui.drawer === "equipment") return `<div class="drawer-cards">${focusFirst(Object.entries(D.equipment)).map(([id, item]) => { const counts = planned.equipment[id]; const buy = { kind: "equipment-acquire", targetId: id, mode: "buy" }; const lease = { kind: "equipment-acquire", targetId: id, mode: "lease" }; return `<article${targetCard(id)}><h3>${escapeHtml(itemLabel(item.name))}</h3><p>${escapeHtml(L("Owned", "Acheté"))}: ${counts.owned} · ${escapeHtml(L("Leased", "Loué"))}: ${counts.leased}</p><small>${money(item.purchase)} ${escapeHtml(L("buy once", "achat unique"))} · ${money(item.purchase * item.maintenanceRate)}/${escapeHtml(L("year upkeep if owned", "an d’entretien si acheté"))} · ${money(item.lease)}/${escapeHtml(L("year lease", "an de location"))}</small><div class="choice-subgrid"><div>${consequencePreview(`equipment:${id}:buy`, buy)}${reviewButton(`equipment:${id}:buy`, buy, L("Buy", "Acheter"))}</div><div>${consequencePreview(`equipment:${id}:lease`, lease, { note: false })}${reviewButton(`equipment:${id}:lease`, lease, L("Lease", "Louer"))}</div></div><div class="button-row">${counts.owned ? reviewButton(`equipment:${id}:buy`, { kind: "equipment-remove", targetId: id, mode: "buy" }, L("Sell one", "Vendre une unité")) : ""}${counts.leased ? reviewButton(`equipment:${id}:lease`, { kind: "equipment-remove", targetId: id, mode: "lease" }, L("Return one", "Restituer une unité")) : ""}</div></article>`; }).join("")}</div>`;
    if (ui.drawer === "training") return renderTrainingDrawer(planned);
    if (ui.drawer === "opening") return `<div class="drawer-cards">${focusFirst(Object.entries(D.openingPeriods)).map(([id, period]) => { const active = planned.operations.openingPeriods[id]; const payload = { kind: "opening-period", targetId: id, value: !active }; return optionCard(itemLabel(period.name), `${number(period.hours)} ${L("available room/equipment hours; no staff hours added", "heures de salle/équipement disponibles ; aucune heure de personnel ajoutée")}`, `opening:${id}`, payload, `${money(period.cost)}/${L("year", "an")}`, id); }).join("")}</div>`;
    if (ui.drawer === "dropoff") { const payload = { kind: "dropoff", value: !planned.operations.dropoff }; return optionCard(L("Drop-off workflow", "Parcours de dépôt"), L("Animals are left for the day: vaccination, preventive care, lab and pharmacy use 30% less room time and 10% less vet time (10% more support time), and clients value the convenience (+1 trust). Worth it when a room is full. Needs two support staff.", "Les animaux sont déposés pour la journée : vaccination, prévention, laboratoire et pharmacie utilisent 30 % de temps de salle et 10 % de temps vétérinaire en moins (10 % de soutien en plus), et les clients apprécient la commodité (+1 de confiance). Utile quand une salle est saturée. Deux personnes de soutien sont nécessaires."), "operations:dropoff", payload, `${money(4000)}/${L("year", "an")}`); }
    if (ui.drawer === "stock") return `<div class="drawer-cards">${Object.entries(D.stockStrategies).map(([id, choice]) => { const change = Math.round((choice.multiplier - 1) * 100); const spending = change === 0 ? L("No change in supply spending", "Aucun changement des dépenses de fournitures") : change > 0 ? L(`${change}% more supply spending`, `${change} % de dépenses de fournitures en plus`) : L(`${Math.abs(change)}% less supply spending`, `${Math.abs(change)} % de dépenses de fournitures en moins`); return optionCard(itemLabel(choice.name), `${spending} · ${L(`about ${pct(choice.stockoutRate || 0)} of cases in pharmacy, surgery, orthopedics, hospital, dentistry, vaccination and preventive care lost to stock-outs`, `environ ${pct(choice.stockoutRate || 0)} des cas en pharmacie, chirurgie, orthopédie, hospitalisation, dentisterie, vaccination et prévention perdus par rupture de stock`)}`, "operations:stock", { kind: "stock-strategy", targetId: id }, `${number(choice.supportHours)} ${L("support hours", "heures de soutien")} · ${money(choice.cost)}/${L("year", "an")}`); }).join("")}</div>`;
    // These four were fully built — costs, effects, a reducer, an action label, a click handler —
    // and no screen ever rendered a button for them. They are the only direct answer to "how do I
    // change staff climate or client trust?", so without them the two indicators are read-only.
    if (ui.drawer === "relations") return `<p>${escapeHtml(L("Staff climate changes absence and resignations. Client trust changes how many requests arrive. Both also move on their own with how much of the demand you serve.", "Le climat d’équipe modifie l’absentéisme et les démissions. La confiance des clients modifie le nombre de demandes reçues. Les deux évoluent aussi d’elles-mêmes selon la part de la demande que vous traitez."))}</p><div class="drawer-cards">${Object.entries(D.socialActions).map(([id, action]) => optionCard(itemLabel(action.name), itemLabel(action.note), `social:${id}`, { kind: "social-action", targetId: id }, `${money(action.cost)} ${L("once", "une fois")}${action.supportHours ? ` · ${number(action.supportHours)} ${L("support hours", "heures de soutien")}` : ""}`, id)).join("")}</div>`;
    if (ui.drawer === "hr") return `<p>${escapeHtml(L("Staff climate changes absence and resignations: below 50 people are absent more, below 30 someone resigns at year end, and below 45 anyone paid under 95% of their benchmark resigns. Resignation protection counts as extra climate for those checks.", "Le climat de l’équipe modifie l’absence et les démissions : sous 50 les absences augmentent, sous 30 une personne démissionne en fin d’année, et sous 45 toute personne payée sous 95 % de sa référence démissionne. La protection contre les départs compte comme du climat en plus pour ces seuils."))}</p><div class="drawer-cards">${Object.entries(D.hrStrategies).map(([id, choice]) => optionCard(itemLabel(choice.name), `${pct(choice.absenteeism)} ${L("expected work time lost to absence", "de temps de travail susceptible d’être perdu pour absence")} · ${L("staff climate", "climat de travail")} ${signed(choice.climate)} · ${L("resignation protection", "protection contre les départs")} +${choice.retention || 0}`, "hr:strategy", { kind: "hr-strategy", targetId: id }, `${money(choice.cost)}/${L("year", "an")}`)).join("")}</div>`;
    if (ui.drawer === "pricing") return `<p>${escapeHtml(L("Price sensitivity shows how strongly requests may change when the price changes. Only open services are listed: open a service first to price it.", "La sensibilité au prix indique dans quelle mesure les demandes peuvent changer lorsque le prix évolue. Seuls les services ouverts sont listés : ouvrez d’abord un service pour fixer son prix."))}</p><div class="price-editor">${D.services.filter((service) => planned.services[service.id].active).map((service) => { const current = ui.decisionDrafts[`price:${service.id}`] ?? planned.services[service.id].price; return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong><span>${escapeHtml(L("Price sensitivity", "Sensibilité au prix"))}: ${escapeHtml(priceSensitivity(service.elasticity))}</span><span>${escapeHtml(L("Money left after direct supplies", "Argent restant après les fournitures directes"))}: ${money(current * (1 - service.variableCost))} · ${escapeHtml(L(`supplies ${pct(service.variableCost)}`, `fournitures ${pct(service.variableCost)}`))}</span></div><label><span>${escapeHtml(L("Price", "Prix"))}</span><input type="number" min="1" max="5000" value="${current}" data-draft-price="${service.id}" data-draft-key="price:${service.id}"></label><button class="button primary" data-review-price="${service.id}">${escapeHtml(L("Review price", "Examiner le prix"))}</button></article>`; }).join("")}</div>`;
    if (ui.drawer === "finance") { const loan = planned.finance.loan; return loan ? `${optionCard(L("Repay loan early", "Rembourser l’emprunt par anticipation"), `${money(loan.remaining)} ${L("remaining principal", "de capital restant")}`, "finance:loan", { kind: "repay-loan" })}` : `<div class="drawer-cards">${[30000, 50000, 100000].map((amount) => optionCard(L("Five-year loan", "Emprunt sur cinq ans"), L("6% interest on remaining principal; one outstanding loan at a time.", "Intérêt de 6 % sur le capital restant ; un seul emprunt à la fois."), "finance:loan", { kind: "loan", value: amount }, money(amount))).join("")}</div>`; }
    if (ui.drawer === "market") return `<div class="drawer-cards">${Object.entries(D.segments).map(([id, segment]) => optionCard(itemLabel(segment.name), segmentAppetite(segment), "market:focus", { kind: "market-focus", targetId: id })).join("")}</div>`;
    if (ui.drawer === "location") return `<div class="drawer-cards">${Object.entries(D.locations).map(([id, location]) => { const moving = id !== planned.location.sectorId; const note = moving && planned.location.parking ? ` ${L("Moving removes the current parking.", "Le déménagement supprime le parking actuel.")}` : ""; return optionCard(itemLabel(location.name), itemLabel(location.description) + note, "location:sector", { kind: "location", targetId: id }, `${moving ? `${money(location.moveCost)} ${L("once to move", "une fois pour déménager")} · ` : ""}${money(location.rent)}/${L("year", "an")} · ${decimal(location.averageRoundTripKm, 0)} km ${L("average return trip", "aller-retour moyen")}`); }).join("")}${optionCard(planned.location.parking ? L("Remove parking", "Supprimer le parking") : L("Add parking", "Ajouter un parking"), L("Parking improves access and some demand, but increases the modelled share of car travel.", "Le parking améliore l’accès et une partie de la demande, mais augmente la part modélisée des déplacements en voiture."), "location:parking", { kind: "parking", value: !planned.location.parking }, planned.location.parking ? "" : `${money(D.locations[planned.location.sectorId].parkingCost)} ${L("once", "une fois")} · ${money(D.locations[planned.location.sectorId].parkingMaintenance)}/${L("year", "an")}`)}</div>`;
    if (ui.drawer === "marketing") {
      if (!ui.drawerContext || !D.marketingStrategies[ui.drawerContext]) return `<div class="drawer-menu">${Object.keys(D.marketingStrategies).map((id) => `<button data-drawer-context="${id}"><strong>${escapeHtml(strategyLabel(id))}</strong><span>${escapeHtml(itemLabel(D.marketingStrategies[id][planned.marketing[id]].name))}</span><em>›</em></button>`).join("")}</div>`;
      return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Market strategies", "Stratégies de marché"))}</button><div class="drawer-cards">${Object.entries(D.marketingStrategies[ui.drawerContext]).map(([id, choice]) => optionCard(itemLabel(choice.name), `${choice.demand ? signed(choice.demand, "percent") + " " + L("demand", "demande") : L("Demand unchanged", "Demande inchangée")}${choice.willingness ? ` · ${signed(choice.willingness, "percent")} ${L("price clients accept", "de prix accepté par les clients")}` : ""}`, `marketing:${ui.drawerContext}`, { kind: "marketing-strategy", strategy: ui.drawerContext, targetId: id }, `${money(choice.cost)}/${L("year", "an")} · ${number(choice.supportHours || 0)} ${L("support hours", "heures de soutien")}`)).join("")}</div>`;
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
    const titles = { relations: L("Team and clients", "Équipe et clients"), person: L("Team member", "Membre de l’équipe"), setup: L("Game setup", "Paramétrage de la partie"), plan: L("Current plan", "Plan actuel"), recruitment: L("Post a vacancy", "Publier une offre"), staffPerson: L("Manage pay", "Gérer le salaire"), staffExit: L("Let someone go", "Se séparer d’une personne"), staffAllocation: L("Change time allocation", "Modifier l’affectation du temps"), hoursByService: L("Hours by service", "Heures par service"), export: L("Export report", "Exporter le rapport"), services: L("Explore services", "Explorer les services"), rooms: L("Manage rooms", "Gérer les salles"), equipment: L("Manage equipment", "Gérer l’équipement"), training: L("Plan training", "Planifier une formation"), capabilities: L("Who can do what", "Qui peut faire quoi"), opening: L("Opening schedule", "Horaires d’ouverture"), dropoff: L("Drop-off workflow", "Parcours de dépôt"), stock: L("Stock strategy", "Stratégie de stock"), hr: L("HR strategy", "Stratégie RH"), pricing: L("Service prices", "Prix des services"), finance: L("Financing", "Financement"), market: L("Market focus", "Marché cible"), location: L("Location and parking", "Implantation et parking"), marketing: L("Market strategies", "Stratégies de marché"), sustainability: L("Transition options", "Options de transition") };
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
    ).slice(0, 3).map(([row, value]) => [`${serviceName(row.id)} — ${blockerText(row.bottleneck)}`, signed(value), value]);
    const variance = latest.operational.demandVariance;
    if (latest.operational.stockoutLost > 0) caseItems.push([L("Lost to stock-outs", "Perdus par rupture de stock"), signed(-latest.operational.stockoutLost), -latest.operational.stockoutLost]);
    const climateLabels = { hr: L("HR strategy", "Stratégie RH"), openingHours: L("Extra opening hours", "Horaires étendus"), pay: L("Pay vs benchmark", "Salaire vs référence"), overtime: L("Overtime", "Heures supplémentaires"), workload: L("Workload level", "Niveau de charge"), departure: L("Someone was let go", "Départ imposé") };
    const trustLabels = { served: L("Share of requests served", "Part des demandes traitées"), communication: L("Client communication", "Communication client"), access: L("Low-carbon access plan", "Plan d’accès bas carbone"), pace: L("Service pace", "Rythme des services"), dropoff: L("Drop-off convenience", "Commodité du dépôt"), stockouts: L("Stock-outs", "Ruptures de stock") };
    const partItems = (parts, labels) => top(Object.entries(parts || {}).map(([id, value]) => [labels[id] || id, value])).map(([label, value]) => [label, points(value), value]);
    const blocks = [
      [L("Net result", "Résultat net"), money(f.netResult), moneyItems],
      [L("Cases served", "Cas traités"), number(latest.operational.totalHonored), caseItems],
      [L("Staff climate", "Climat de l’équipe"), number(latest.social.after.staffClimate), partItems(latest.social.climateParts, climateLabels)],
      [L("Client trust", "Confiance des clients"), number(latest.social.after.clientTrust), partItems(latest.social.trustParts, trustLabels)]
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
    const reflection = state.reflections[latest.turn] || {};
    const fields = ["rationale", "expected", "observed", "surprise", "uncertainty"];
    const field = fields[clamp(ui.reflectionStep, 0, fields.length - 1)];
    const carbon = latest.carbon;
    const changes = [
      { label: L("Net result", "Résultat net"), value: money(latest.financial.netResult), good: latest.financial.netResult >= 0 },
      { label: L("Cases served", "Cas traités"), value: `${number(latest.operational.totalHonored)} / ${number(latest.operational.totalDemand)}`, good: latest.operational.honoredRate >= .82 },
      // Judged on the rounded figure the card actually shows: a half-point drift that rounds to the
      // same number must not carry a warning badge, or the badge contradicts the value beside it.
      { label: L("Staff climate", "Climat de l’équipe"), value: number(latest.social.after.staffClimate), good: Math.round(latest.social.after.staffClimate) >= Math.round(latest.social.before.staffClimate) },
      { label: L("Carbon footprint", "Empreinte carbone"), value: carbon ? tonnes(carbon.total) : L("Not available for migrated year", "Non disponible pour l’année migrée"), good: carbon ? (!previous?.carbon || carbon.total <= previous.carbon.total) : false },
      // These two shift demand every year and previously had no surface anywhere in the interface.
      { label: itemLabel(D.socialIndicators.referralSupport), value: number(latest.social.after.referralSupport), good: Math.round(latest.social.after.referralSupport) >= Math.round(latest.social.before.referralSupport) },
      { label: itemLabel(D.socialIndicators.communityPressure), value: number(latest.social.after.communityPressure), good: Math.round(latest.social.after.communityPressure) <= Math.round(latest.social.before.communityPressure) }
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
    const causeRows = `<article><span>${escapeHtml(L("Main constraint", "Contrainte principale"))}</span><strong>${escapeHtml(blockerText(latest.operational.mainConstraint))}</strong><em>${escapeHtml(L("Explains unmet requests or weak revenue", "Explique les demandes non traitées ou les recettes insuffisantes"))}</em></article><article><span>${escapeHtml(L("Largest cost", "Coût principal"))}</span><strong>${escapeHtml(costDrivers[0][0])}: ${money(costDrivers[0][1])}</strong><em>${escapeHtml(L("Largest annual financial pressure", "Principale pression financière annuelle"))}</em></article>${carbon ? `<article><span>${escapeHtml(L("Largest carbon source", "Principale source de carbone"))}</span><strong>${escapeHtml(sourceLabel(mainCarbon))}: ${tonnes(carbon.bySource[mainCarbon])}</strong><em>${escapeHtml(mainCarbon === "building" ? L("Opening hours, rooms, and energy choices", "Horaires, salles et choix énergétiques") : mainCarbon === "clinical" ? L("Anaesthetic use in eligible procedures", "Gaz anesthésiques des actes concernés") : mainCarbon === "waste" ? L("Waste produced by treated cases", "Déchets produits par les cas traités") : L("Client numbers, location, and parking", "Nombre de clients, implantation et parking"))}</em></article>` : ""}`;
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Year results", "Résultats de l’année"))}</h1><p>${escapeHtml(L("See the outcome, identify the causes, then record what the team learned.", "Observez le résultat, identifiez les causes, puis consignez les apprentissages de l’équipe."))}</p></div><div class="button-row"><strong>${escapeHtml(t("app.year", { year: latest.turn, target: state.rules.targetYear }))}</strong><button class="button primary" data-domain="overview">${escapeHtml(L(`Plan Year ${state.year} →`, `Planifier l’année ${state.year} →`))}</button></div></div>
      <div class="dashboard-grid compact-three">${changes.map((item) => metricCard(item.label, item.value, item.good ? L("Improved or on track", "Amélioration ou objectif atteint") : L("Needs attention", "À surveiller"), item.good ? "good" : "warn")).join("")}</div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("What drove the result", "Origine du résultat"))}</h2><p>${escapeHtml(L("Largest modelled contributors—not a judgement about the choices.", "Principales contributions modélisées — sans jugement sur les choix."))}</p></div></div><div class="cause-list">${causeRows}</div><h3>${escapeHtml(L("Actions taken", "Actions réalisées"))}</h3><div class="chips">${latest.actions?.length ? latest.actions.map((action) => `<span class="chip">${escapeHtml(actionLabel(action))}</span>`).join("") : `<span class="chip">${escapeHtml(t("results.noAction"))}</span>`}</div>${(latest.departures || []).length ? `<div class="recruitment-results">${latest.departures.map((item) => `<p class="bad-text">${escapeHtml(item.name)}: ${escapeHtml(departureText(item.reason))}</p>`).join("")}</div>` : ""}${latest.recruitment?.length ? `<div class="recruitment-results">${latest.recruitment.map((row) => `<p class="${row.accepted ? "good-text" : "bad-text"}">${escapeHtml(candidateById(row.candidateId)?.name || row.candidateId)}: ${escapeHtml(row.accepted ? t("staff.accepted") : t("staff.refused"))}</p>`).join("")}</div>` : ""}</section>
      ${renderWhyChanged(latest, previous)}
      <section class="card-section reflection-step"><div class="panel-heading"><div><h2>${escapeHtml(L("Team reflection", "Réflexion de l’équipe"))}</h2><p>${ui.reflectionStep + 1}/${fields.length}</p></div></div><label><span>${escapeHtml(t(`results.${field}`))}</span><textarea data-reflection="${field}" data-year="${latest.turn}">${escapeHtml(reflection[field] || "")}</textarea></label><div class="button-row"><button class="button secondary" data-reflection-prev ${ui.reflectionStep === 0 ? "disabled" : ""}>‹ ${escapeHtml(L("Previous", "Précédent"))}</button><button class="button primary" data-save-reflection="${latest.turn}">${escapeHtml(t("results.saveReflection"))}</button><button class="button secondary" data-reflection-next ${ui.reflectionStep === fields.length - 1 ? "disabled" : ""}>${escapeHtml(L("Next", "Suivant"))} ›</button></div></section>
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
    const goals = goalChecks(latest, state);
    const passed = goals.filter((goal) => goal.ok).length;
    const failed = state.endState.type === "failure";
    const strained = state.endState.type === "strained";
    const tone = failed ? "bad" : strained ? "warn" : "good";
    const symbol = failed ? "!" : strained ? "△" : "✓";
    const titleKey = failed ? "end.failureTitle" : strained ? "end.strainedTitle" : "end.successTitle";
    const textKey = failed ? "end.failureText" : strained ? "end.strainedText" : "end.successText";
    // The symbol is decorative; the verdict has to reach a screen reader as text, and the treasury
    // that produced it was shown nowhere at all.
    return `<div class="modal-backdrop"><section class="modal end-modal" role="dialog" aria-modal="true" aria-labelledby="end-title"><div class="end-symbol ${tone}" aria-hidden="true">${symbol}</div><h2 id="end-title">${escapeHtml(t(titleKey))}</h2><p>${escapeHtml(t(textKey))}</p><p class="end-treasury ${tone}"><strong>${escapeHtml(t("end.endTreasury"))}: ${money(latest.financial.treasury)}</strong></p><strong>${escapeHtml(t("end.score", { passed, total: goals.length }))}</strong><div class="goal-summary">${goals.map((goal) => `<span class="${goal.ok ? "good" : "bad"}">${goal.ok ? "✓" : "○"} ${escapeHtml(itemLabel(goal.label))}</span>`).join("")}</div><div class="button-row"><button class="button primary" data-continue>${escapeHtml(t("app.continue"))}</button><button class="button secondary" data-export>${escapeHtml(t("app.export"))}</button><button class="button danger" data-reset>${escapeHtml(t("app.restart"))}</button></div></section></div>`;
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
    ensureCarbonBaseline();
    t = I18N.createTranslator(state.language);
    document.documentElement.lang = state.language;
    document.title = t("app.title");
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
        if (restore.selector) drawer.querySelector(restore.selector)?.focus();
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

  function saveVisibleReflection() {
    document.querySelectorAll("[data-reflection][data-year]").forEach((node) => {
      const year = node.dataset.year;
      state.reflections[year] = { ...(state.reflections[year] || {}), [node.dataset.reflection]: node.value };
    });
    saveState();
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
      setup: clone(state.setup),
      setupLog: clone(state.setupLog || []),
      cashLog: clone(state.cashLog || []),
      decisionLog: clone(state.decisionLog || []),
      uiPreferences: clone(state.uiPreferences),
      playerTeam: clone(state.playerTeam),
      carbonMethod: { version: D.carbonModel.version, context: D.carbonModel.context, factors: Object.fromEntries(Object.entries(D.carbonModel.factorRegistry).map(([id, factor]) => [id, { value: factor.value, unit: factor.unit, year: factor.year, detail: itemLabel(factor.detail), source: factor.source }])), sources: D.carbonModel.sources, assumptions: D.carbonModel.assumptions, excluded: D.carbonModel.excluded },
      carbonBaseline: clone(state.carbonBaseline),
      clinic: { year: state.year, treasury: state.treasury, clients: state.clients, reputation: state.reputation, services: state.services, staff: state.staff, operations: state.operations, hr: state.hr, location: state.location, marketing: state.marketing, finance: state.finance, sustainability: state.sustainability },
      years: state.history.map((report) => ({
        year: report.turn,
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
        forecastShown: clone(report.forecastShown || null),
        reflection: state.reflections[report.turn] || {},
        financial: clone(report.financial),
        operational: clone(report.operational),
        serviceResults: clone(report.serviceResults),
        social: clone(report.social),
        recruitment: clone(report.recruitment || []),
        actionRecords: clone(report.actionRecords || []),
        clinicSnapshot: clone(report.clinicSnapshot || null),
        detailAvailability: report.clinicSnapshot ? "complete" : "historical-summary-only"
      }))
    };
  }

  function downloadJson() {
    saveVisibleReflection();
    syncPlayerTeam();
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

  function buildPrintableReportHtml() {
    const title = L("Veterinary clinic simulation report", "Rapport de simulation de clinique vétérinaire");
    const teamCode = state.playerTeam.teamCode || L("Not provided", "Non renseigné");
    const start = initialState(state.scenarioId, state.language, state.setup);
    const setupLines = setupLogLines();
    const goals = state.history.length ? goalChecks(state.history[state.history.length - 1], state) : [];
    const reflectionFields = ["rationale", "expected", "observed", "surprise", "uncertainty"];
    const yearSections = state.history.map((report, reportIndex) => {
      const staffRows = report.operational.staffRows || [];
      const hourRows = report.operational.serviceHourRows || [];
      const reflection = state.reflections[report.turn] || {};
      const snapshotStaff = report.clinicSnapshot?.staff || [];
      const staffTable = staffRows.length ? reportTable([L("Person", "Personne"), L("Available", "Disponibles"), L("Assigned", "Affecté"), L("Used", "Utilisées"), L("Overtime", "Heures sup."), L("Idle", "Inoccupées"), L("Unused", "Inutilisées"), L("Blocked", "Bloquées"), L("Workload", "Charge"), L("Allocations", "Affectations")], staffRows.map((row) => { const person = snapshotStaff.find((item) => item.id === row.id); return [escapeHtml(person?.name || row.id), number(row.availableHours), pct(row.assignedShare ?? 1), number(row.usedHours), number(row.overtimeHours || 0), number(row.idleHours || 0), number(row.unusedHours), number(row.blockedHours), pct(row.workload), escapeHtml((row.assignments || []).map((assignment) => `${serviceName(assignment.serviceId)} ${Math.round(assignment.share * 100)}%`).join(" · "))]; })) : `<p class="notice">${escapeHtml(L("Detailed staff allocation was not recorded for this migrated year.", "L’affectation détaillée du personnel n’a pas été enregistrée pour cette année migrée."))}</p>`;
      const serviceRows = report.serviceResults || [];
      const services = serviceRows.length ? reportTable([L("Service", "Service"), L("Requests", "Demandes"), L("Served", "Traités"), L("Price", "Prix"), L("Revenue", "Recettes"), L("Variable costs", "Coûts variables"), L("Blocker", "Blocage")], serviceRows.filter((row) => row.active).map((row) => [escapeHtml(serviceName(row.id)), number(row.demand), number(row.honored), money(row.price), money(row.revenue), money(row.variableCosts), escapeHtml(blockerText(row.bottleneck))])) : `<p class="notice">${escapeHtml(L("Detailed service results were not recorded for this migrated year.", "Les résultats détaillés des services n’ont pas été enregistrés pour cette année migrée."))}</p>`;
      const hours = hourRows.length ? reportTable([L("Service", "Service"), L("Role", "Fonction"), L("Assigned", "Affectées"), L("Needed", "Nécessaires"), L("Used", "Utilisées"), L("Shortage", "Manque")], hourRows.map((row) => [escapeHtml(serviceName(row.serviceId)), escapeHtml(row.role === "vet" ? L("Veterinarian", "Vétérinaire") : L("Support", "Soutien")), number(row.assignedHours), number(row.neededHours), number(row.usedHours), number(row.shortageHours)])) : "";
      const actions = (report.actions || []).length ? `<ul>${report.actions.map((action) => `<li>${escapeHtml(actionLabel(action))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No action", "Aucune action"))}</p>`;
      const carbon = report.carbon ? `<div class="summary-grid"><p><span>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</span><strong>${tonnes(report.carbon.total)}</strong></p><p><span>${escapeHtml(L("Per treated case", "Par cas traité"))}</span><strong>${kilograms(report.carbon.perCase)}</strong></p>${Object.entries(report.carbon.bySource).map(([id, value]) => `<p><span>${escapeHtml(sourceLabel(id))}</span><strong>${tonnes(value)}</strong></p>`).join("")}</div>` : `<p>${escapeHtml(L("Carbon detail unavailable for this migrated year.", "Détail carbone indisponible pour cette année migrée."))}</p>`;
      const hasHourTotals = Number.isFinite(report.operational.startVetHours) && Number.isFinite(report.operational.startSupportHours);
      const previousCarbon = reportIndex ? state.history[reportIndex - 1].carbon?.total : state.carbonBaseline?.total;
      const carbonChange = report.carbon && Number.isFinite(previousCarbon) ? report.carbon.total - previousCarbon : null;
      return `<section class="year"><h2>${escapeHtml(L("Year", "Année"))} ${report.turn}</h2><div class="summary-grid"><p><span>${escapeHtml(L("Revenue", "Recettes"))}</span><strong>${money(report.financial.revenue)}</strong></p><p><span>${escapeHtml(L("Variable costs", "Coûts variables"))}</span><strong>${money(report.financial.variableCosts)}</strong></p><p><span>${escapeHtml(L("Payroll and charges", "Salaires et charges"))}</span><strong>${money((report.financial.payroll || 0) + (report.financial.socialCharges || 0))}</strong></p><p><span>${escapeHtml(L("Overtime", "Heures supplémentaires"))}</span><strong>${money(report.financial.overtimeCost || 0)}</strong></p><p><span>${escapeHtml(L("Facilities", "Installations"))}</span><strong>${money(report.financial.facilityCosts)}</strong></p><p><span>${escapeHtml(L("Operating costs", "Coûts d’exploitation"))}</span><strong>${money((report.financial.openingCosts || 0) + (report.financial.dropoffCost || 0) + (report.financial.stockCost || 0) + (report.financial.hrCost || 0) + (report.financial.marketingCost || 0) + (report.financial.sustainabilityCost || 0) + (report.financial.admin || 0))}</strong></p>${report.financial.loanInterest > 0 ? `<p><span>${escapeHtml(L("Loan interest", "Intérêts d’emprunt"))}</span><strong>${money(report.financial.loanInterest)}</strong></p>` : ""}<p><span>${escapeHtml(L("One-time costs", "Coûts ponctuels"))}</span><strong>${money(report.financial.oneTimeCosts)}</strong></p><p><span>${escapeHtml(L("Tax", "Impôt"))}</span><strong>${money(report.financial.tax)}</strong></p><p><span>${escapeHtml(L("Net result", "Résultat net"))}</span><strong>${money(report.financial.netResult)}</strong></p><p><span>${escapeHtml(L("End treasury", "Trésorerie finale"))}</span><strong>${money(report.financial.treasury)}</strong></p></div><h3>${escapeHtml(L("Actions and recruitment", "Actions et recrutement"))}</h3>${actions}${(report.recruitment || []).map((row) => `<p>${escapeHtml(candidateById(row.candidateId)?.name || row.candidateId)} — ${escapeHtml(row.accepted ? L("accepted", "accepté") : L("refused", "refusé"))}</p>`).join("")}<h3>${escapeHtml(L("Services", "Services"))}</h3>${services}<h3>${escapeHtml(L("Staff hours", "Heures du personnel"))}</h3>${hasHourTotals ? `<p>${escapeHtml(L("Veterinary hours available / used", "Heures vétérinaires disponibles / utilisées"))}: ${number(report.operational.startVetHours)} / ${number(report.operational.startVetHours - report.operational.remainingVetHours)} · ${escapeHtml(L("Support hours available / used", "Heures de soutien disponibles / utilisées"))}: ${number(report.operational.startSupportHours)} / ${number(report.operational.startSupportHours - report.operational.remainingSupportHours)}</p>` : `<p class="notice">${escapeHtml(L("Detailed hour totals were not recorded for this migrated year.", "Les totaux d’heures détaillés n’ont pas été enregistrés pour cette année migrée."))}</p>`}${staffTable}${hours}<h3>${escapeHtml(L("People and clients", "Équipe et clients"))}</h3><p>${escapeHtml(L("Staff climate", "Climat de l’équipe"))}: ${number(report.social?.after?.staffClimate || 0)} · ${escapeHtml(L("Client trust", "Confiance des clients"))}: ${number(report.social?.after?.clientTrust || 0)}</p><h3>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</h3>${carbon}${carbonChange === null ? "" : `<p><strong>${escapeHtml(L("Annual change", "Évolution annuelle"))}:</strong> ${carbonChange > 0 ? "+" : ""}${tonnes(carbonChange)}</p>`}<h3>${escapeHtml(L("Team reflections", "Réflexions de l’équipe"))}</h3>${reflectionFields.map((field) => `<div class="reflection"><strong>${escapeHtml(t(`results.${field}`))}</strong><p>${escapeHtml(reflection[field] || L("No response", "Aucune réponse"))}</p></div>`).join("")}</section>`;
    }).join("");
    return `<!doctype html><html lang="${state.language}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;color:#17201d;margin:32px;line-height:1.4}header{border-bottom:3px solid #146c5a;margin-bottom:24px}.print{position:fixed;right:24px;top:18px;padding:10px 16px}.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.summary-grid p{border:1px solid #ccd8d4;padding:10px;margin:0}.summary-grid span{display:block;font-size:12px}.summary-grid strong{font-size:16px}table{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:12px}th,td{text-align:left;border:1px solid #ccd8d4;padding:7px;vertical-align:top}th{background:#eef5f2}.year{break-before:page}.reflection{border-left:3px solid #7c9f96;padding-left:12px}.notice{font-style:italic}@media(max-width:700px){.summary-grid{grid-template-columns:1fr}table{font-size:10px}}@media print{body{margin:10mm}.print{display:none}.year:first-of-type{break-before:auto}}</style></head><body><button class="print" onclick="window.print()">${escapeHtml(L("Print / Save as PDF", "Imprimer / Enregistrer en PDF"))}</button><header><h1>${escapeHtml(title)}</h1><p><strong>${escapeHtml(L("Scenario", "Scénario"))}:</strong> ${escapeHtml(itemLabel(D.scenarios[state.scenarioId].name))}<br><strong>${escapeHtml(L("Team code", "Code d’équipe"))}:</strong> ${escapeHtml(teamCode)}<br><strong>${escapeHtml(L("Exported", "Exporté"))}:</strong> ${escapeHtml(new Intl.DateTimeFormat(locale(), { dateStyle: "long", timeStyle: "short" }).format(new Date()))}</p></header><section><h2>${escapeHtml(L("Rules and goals", "Règles et objectifs"))}</h2><p>${escapeHtml(L("Action limit", "Limite d’actions"))}: ${escapeHtml(state.rules.unlimited ? L("Unlimited", "Illimitée") : state.rules.actionLimit)} · ${escapeHtml(L("Target year", "Année cible"))}: ${state.rules.targetYear} · ${escapeHtml(L("Bankruptcy threshold", "Seuil de faillite"))}: ${money(state.rules.bankruptcyThreshold)}</p><ul>${goals.map((goal) => `<li>${goal.ok ? "✓" : "○"} ${escapeHtml(itemLabel(goal.label))}: ${escapeHtml(goal.display)}</li>`).join("")}</ul><h2>${escapeHtml(L("Game setup", "Paramétrage de la partie"))}</h2>${reportTable([L("Setting", "Paramètre"), L("Value", "Valeur")], setupSummaryRows().map(([label, value]) => [escapeHtml(label), escapeHtml(value)]))}${setupLines.length ? `<ul>${setupLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No setting changes or cash adjustments.", "Aucun changement de paramètre ni ajustement de trésorerie."))}</p>`}<h2>${escapeHtml(L("Starting versus current clinic", "Clinique de départ et actuelle"))}</h2>${reportTable([L("Measure", "Mesure"), L("Starting", "Départ"), L("Current", "Actuel")], [[escapeHtml(L("Treasury", "Trésorerie")), money(start.treasury), money(state.treasury)], [escapeHtml(L("Clients", "Clients")), number(start.clients), number(state.clients)], [escapeHtml(L("Reputation", "Réputation")), number(start.reputation), number(state.reputation)], [escapeHtml(L("Staff", "Personnel")), number(start.staff.length), number(state.staff.length)], [escapeHtml(L("Active services", "Services actifs")), number(Object.values(start.services).filter((service) => service.active).length), number(Object.values(state.services).filter((service) => service.active).length)], [escapeHtml(L("Carbon footprint", "Empreinte carbone")), state.carbonBaseline ? tonnes(state.carbonBaseline.total) : "—", state.history.at(-1)?.carbon ? tonnes(state.history.at(-1).carbon.total) : "—"]])}</section>${yearSections || `<p>${escapeHtml(L("No completed year yet.", "Aucune année terminée."))}</p>`}<footer><p>${escapeHtml(L("Carbon method", "Méthode carbone"))}: ${escapeHtml(D.carbonModel.version)}. ${escapeHtml(L("Boundary: building electricity and heating, anaesthetic gases, waste treatment, and client car travel. Service activity values are simulation assumptions.", "Périmètre : électricité et chauffage du bâtiment, gaz anesthésiques, traitement des déchets et déplacements automobiles des clients. Les valeurs d’activité des services sont des hypothèses de simulation."))}</p></footer></body></html>`;
  }

  function printReport() {
    saveVisibleReflection();
    syncPlayerTeam();
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
    if (button.dataset.domain) { saveVisibleReflection(); state.domain = button.dataset.domain; ui.drawer = null; ui.drawerContext = null; ui.selectedServiceId = null; ui.confirm = null; ui.originStack = []; saveState(); render(); return; }
    if (button.dataset.openDrawer) {
      // On a drawer-to-drawer jump the breadcrumb IS the close button, so it must name where
      // closing lands. From a room opened by "Address this" it read "Care & facilities" while
      // closing returned to the service — confirming the wrong mental model exactly when it
      // needed correcting.
      ui.returnLabel = ui.drawer ? (ui.drawer === "services" && ui.selectedServiceId ? serviceName(ui.selectedServiceId) : drawerTitleFor(ui.drawer)) : null;
      ui.focusItem = button.dataset.focus || null;
      saveVisibleReflection();
      openDrawer(button.dataset.openDrawer, button.dataset.context || null, button.dataset.service || button.dataset.tab || null);
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
      if (state.pending[key]) toast(L(`Added to plan · ${pendingActions().length}/${state.rules.unlimited ? "unlimited" : state.rules.actionLimit}`, `Ajouté au plan · ${pendingActions().length}/${state.rules.unlimited ? "illimité" : state.rules.actionLimit}`), "good");
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
      if (!state.pending[key] && pendingActions().length >= actionLimit()) {
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
      const ceiling = Math.floor((MAX_ALLOCATION - others) * 20 + .0001) / 20;
      draft[index].share = clamp(Math.round((draft[index].share * 100 + Number(button.dataset.allocationAdjust)) / 5) * 5 / 100, 0, ceiling);
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
      const ceiling = Math.floor((MAX_ALLOCATION - others) * 20 + .0001) / 20;
      // Fill to exactly 100% of available hours rather than the 1.3 ceiling, so this never buys overtime.
      draft[index].share = clamp(Math.min(1 - others, ceiling), 0, ceiling);
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
      else if (!Number.isFinite(threshold) || threshold < -1000000 || threshold > 0) ui.settingsError = L("Choose a bankruptcy threshold between −€1,000,000 and €0.", "Choisissez un seuil de faillite entre −1 000 000 € et 0 €.");
      else if (!state.history.length && (!Number.isFinite(startingTreasury) || startingTreasury < 0 || startingTreasury > 2000000)) ui.settingsError = L("Choose a starting treasury between €0 and €2,000,000.", "Choisissez une trésorerie de départ entre 0 € et 2 000 000 €.");
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
    if (button.dataset.reflectionPrev !== undefined) { saveVisibleReflection(); ui.reflectionStep = Math.max(0, ui.reflectionStep - 1); render(); return; }
    if (button.dataset.reflectionNext !== undefined) { saveVisibleReflection(); ui.reflectionStep = Math.min(4, ui.reflectionStep + 1); render(); return; }
    if (button.dataset.language) { saveVisibleReflection(); syncPlayerTeam(); state.language = button.dataset.language; saveState(); render(); toast(t("toast.languageChanged")); return; }
    if (button.dataset.help !== undefined) { state.helpOpen = true; saveState(); render(); return; }
    if (button.dataset.closeHelp !== undefined) { state.helpOpen = false; saveState(); render(); return; }
    if (button.dataset.removeAction) { rememberDrawer(`[data-add-key="${CSS.escape(button.dataset.removeAction)}"]`); removeAction(button.dataset.removeAction); return; }
    if (button.dataset.passYear !== undefined) { saveVisibleReflection(); ui.drawer = null; ui.confirm = null; ui.passCheck = true; render(); return; }
    if (button.dataset.export !== undefined) { saveVisibleReflection(); ui.lastFocus = { drawer: "export", context: "" }; ui.drawer = "export"; ui.drawerContext = null; ui.confirm = null; ui.autoFocusDrawer = true; render(); return; }
    if (button.dataset.downloadJson !== undefined) { downloadJson(); return; }
    if (button.dataset.printReport !== undefined) { printReport(); return; }
    if (button.dataset.undoYear !== undefined) { const year = state.undo?.year; if (year && window.confirm(t("toast.undoConfirm", { year }))) { if (undoYear()) toast(t("toast.yearUndone", { year }), "good"); } return; }
    if (button.dataset.reset !== undefined) { if (window.confirm(t("toast.resetConfirm"))) resetScenario(); return; }
    if (button.dataset.scenario) { const id = button.dataset.scenario; if (window.confirm(t("toast.scenarioConfirm", { scenario: itemLabel(D.scenarios[id].name) }))) resetScenario(id); return; }
    if (button.dataset.continue !== undefined) { state.endState = null; state.sandboxMode = true; saveState(); render(); return; }
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
      saveVisibleReflection();
      toast(t("results.savedReflection"), "good");
    }
  });

  document.addEventListener("change", (event) => {
    const input = event.target;
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
    if (input.dataset.settingsField) { ui.settingsDraft = { ...(ui.settingsDraft || {}), [input.dataset.settingsField]: input.value }; return; }
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

  window.addEventListener?.("pagehide", () => { saveVisibleReflection(); syncPlayerTeam(); });

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

  globalThis.ClinicTest = { initialState, hydrate, adjustCash, parseRoute, routeFor, applyRoute, openDrawer, closeDrawer, planRowLabel, planRows, applyAction, simulateYear, simulatePlan, queueAction, removeAction, resolveTurn, undoYear, resetScenario, pendingActions, forecastRecord, calculateCarbon, missingRequirements, requirementList, projectedDemand, actionLabel, goalChecks, getBeginnerSignals, emptyEffects, combineEffects, clone, validAllocations, allocationRemainder, stockServices: STOCK_SERVICES, buildExportPayload, buildPrintableReportHtml, data: D, getState: () => clone(state), renderState: (next) => { state = hydrate(next); ui.selectedServiceId = null; ui.settingsDraft = null; render(); return document.querySelector("#app").innerHTML; }, renderUiForTest: (changes) => { ui = { ...ui, ...changes }; render(); return document.querySelector("#app").innerHTML; } };
  if (typeof location !== "undefined" && location.hash) applyRoute(parseRoute(location.hash));
  render();
})();
