(function () {
  "use strict";

  const D = globalThis.ClinicData;
  const I18N = globalThis.ClinicI18n;
  const STORAGE_KEY = "clinic-board-v3-full";
  const LEGACY_KEY = "clinic-board-v2-mvp";
  const SCHEMA_VERSION = 6;
  const MAX_ALLOCATION = 1.3;
  const OVERTIME_PREMIUM = 1.25;
  const SOCIAL_CHARGE_RATE = .22;
  const FATIGUE_ABSENCE_PER_OVERTIME = .3;
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

  function initialState(scenarioId = "balanced", language = detectedLanguage()) {
    const scenario = D.scenarios[scenarioId] || D.scenarios.balanced;
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
      treasury: scenario.treasury,
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
      rules: { actionLimit: 3, unlimited: false, targetYear: 4, bankruptcyThreshold: -200000 },
      reflections: {},
      pending: {},
      history: [],
      domain: "overview",
      helpOpen: false,
      endState: null,
      sandboxMode: false,
      uiPreferences: { beginnerGuideDismissed: false },
      playerTeam: { teamName: "", participantNames: [] }
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
    merged.pending = saved.pending || {};
    merged.history = saved.history || [];
    merged.reflections = saved.reflections || {};
    merged.social = { ...DEFAULT_SOCIAL, ...(saved.social || {}) };
    merged.uiPreferences = { ...fresh.uiPreferences, ...(saved.uiPreferences || {}) };
    merged.playerTeam = { ...fresh.playerTeam, ...(saved.playerTeam || {}), participantNames: Array.isArray(saved.playerTeam?.participantNames) ? saved.playerTeam.participantNames.slice(0, 20) : [] };
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
  let ui = { drawer: null, drawerStep: 1, drawerContext: null, selectedServiceId: null, reopenBeginnerGuide: false, vacancy: { role: "vet", skills: [], budget: 60000 }, candidateLimit: 4, reflectionStep: 0, lastFocus: null, allocationDrafts: {}, decisionDrafts: {}, settingsOpen: false, settingsDraft: null, settingsError: "", restore: null, returnFocus: null, autoFocusDrawer: false };

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

  function queueAction(key, payload) {
    const exists = Boolean(state.pending[key]);
    if (!exists && pendingActions().length >= actionLimit()) {
      toast(`${t("forecast.limitReached")} ${t("forecast.removeHint")}`, "warn");
      return;
    }
    state.pending[key] = { key, payload: clone(payload) };
    saveState();
    render();
  }

  function rememberDrawer(selector = null) {
    const body = document.querySelector(".drawer-body");
    ui.restore = { scrollTop: body?.scrollTop || 0, selector };
  }

  function removeAction(key) {
    delete state.pending[key];
    saveState();
    render();
    toast(t("toast.actionRemoved"));
  }

  function emptyEffects() {
    return { oneTimeCosts: 0, cashAdjustment: 0, vetTrainingHours: 0, supportTrainingHours: 0, trainingHoursByPerson: {}, supportReserved: 0, facilityHoursLost: 0, relocationLoss: 0, advancedDemand: 0, routineDemand: 0, recruitment: [] };
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
    if (p.kind === "toggle-service" && target.services[p.targetId]) target.services[p.targetId].active = Boolean(p.value);
    if (p.kind === "price" && target.services[p.targetId]) target.services[p.targetId].price = clamp(Number(p.value), 1, 5000);
    if (p.kind === "service-pace" && target.services[p.targetId] && D.servicePaces[p.value]) target.services[p.targetId].pace = p.value;
    if (p.kind === "market-focus" && D.segments[p.targetId]) target.marketFocus = p.targetId;
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
      const accepted = Boolean(candidate && salary >= candidate.expectedSalary);
      if (candidate && accepted && !target.staff.some((person) => person.id === candidate.id)) {
        target.staff.push(normalizeStaff({ ...candidate, salary, secondaryService: "", secondaryShare: 0 }));
      }
      if (chargeCosts && candidate) effect.oneTimeCosts += candidate.postingFee;
      effect.recruitment.push({ candidateId: p.targetId, salary, accepted });
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
    const preliminary = clinic.staff.map((person) => {
      const contractedHours = person.capacity * salaryCapacityMultiplier(person);
      // Last year's overtime carries into this year as extra absence.
      const fatigueRate = Math.min(.09, Number(person.lastOvertimeRatio || 0) * FATIGUE_ABSENCE_PER_OVERTIME);
      const expectedAbsenceHours = contractedHours * (hr.absenteeism + fatigueRate);
      const gross = contractedHours - expectedAbsenceHours;
      const roleTraining = person.role === "vet" ? effects.vetTrainingHours : effects.supportTrainingHours;
      const sameRoleCount = Math.max(1, clinic.staff.filter((item) => item.role === person.role).length);
      const trainingHours = roleTraining / sameRoleCount + Number(effects.trainingHoursByPerson?.[person.id] || 0);
      return { person, contractedHours, expectedAbsenceHours, fatigueAbsenceHours: contractedHours * fatigueRate, grossHours: gross, trainingHours, beforeDuties: Math.max(0, gross - trainingHours) };
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
    const willingness = segment.willingness[service.id] || service.price;
    const priceRatio = serviceState.price / Math.max(1, willingness);
    const priceEffect = priceRatio <= 1
      ? 1 + (1 - priceRatio) * service.elasticity * .35
      : Math.max(.25, 1 - (priceRatio - 1) * service.elasticity * 2.2 * segment.priceSensitivity);
    const monitoring = D.marketingStrategies.monitoring[clinic.marketing.monitoring];
    const communication = D.marketingStrategies.communication[clinic.marketing.communication];
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
      (1 + periods + emergency) * parking * accessDemand * actionDemand * (1 - effects.relocationLoss)
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

  function simulateYear(clinic, before, effects, actions) {
    const resources = initialResources(clinic, effects);
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
      const demand = projectedDemand(service, clinic, effects);
      const missing = missingRequirements(service, clinic);
      const vd = vetDuration(service, clinic);
      const sd = supportDuration(service, clinic);
      const vetPool = resources.vetByService[service.id] || 0;
      const supportPool = resources.supportByService[service.id] || 0;
      const facilityDuration = caseDuration(service, clinic);
      // Vet hours can cover the support part of a case; support hours cannot cover vet work.
      const unstaffed = vd > 0 && vetPool <= 0 ? { type: "unstaffed", id: "vet" } : vd + sd > 0 && vetPool + supportPool <= 0 ? { type: "unstaffed", id: "support" } : null;
      const staffCaps = { demand, vet: vd > 0 ? Math.floor(vetPool / vd) : Infinity, support: vd + sd > 0 ? Math.floor((vetPool + supportPool) / (vd + sd)) : Infinity };
      const runnable = serviceState.active && !missing.length && !unstaffed;
      const staffCap = runnable ? Math.min(...Object.values(staffCaps)) : 0;
      if (runnable) {
        service.roomIds.forEach((id) => { facilityNeed.room[id] = (facilityNeed.room[id] || 0) + staffCap * facilityDuration; });
        service.equipmentIds.forEach((id) => { facilityNeed.equipment[id] = (facilityNeed.equipment[id] || 0) + staffCap * facilityDuration; });
      }
      return { service, serviceState, demand, missing, vd, sd, supportPool, facilityDuration, unstaffed, staffCaps, staffCap };
    });
    // A full room or equipment item cuts every service using it by the same share.
    const facilityFactor = (kind, id) => {
      const need = facilityNeed[kind][id] || 0;
      return need > 0 ? Math.min(1, (facilityCapacity[kind][id] || 0) / need) : 1;
    };
    plans.forEach(({ service, serviceState, demand, missing, vd, sd, supportPool, facilityDuration, unstaffed, staffCaps, staffCap }) => {
      totalOpportunity += demand;
      let honored = 0;
      let vetUsed = 0;
      let supportUsed = 0;
      let bottleneck = serviceState.active ? { type: "demandMet" } : { type: "notOffered" };
      if (serviceState.active) {
        totalDemand += demand;
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
      results.push({ id: service.id, active: serviceState.active, demand, honored, price: serviceState.price, revenue: serviceRevenue, variableCosts: variable, contributionPerCase: serviceState.price * (1 - service.variableCost), missing, bottleneck, vetDuration: vd, supportDuration: sd, vetUsed, supportUsed, vetCoverHours: Math.max(0, vetUsed - honored * vd), staffCap });
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
    social.clientTrust = clamp(social.clientTrust + honoredRate * 3.2 - (1 - honoredRate) * 5.8 + communication.trust + accessTrust + paceTrust, 0, 100);
    const climateParts = { hr: hr.climate, openingHours: periodClimate, pay: payClimate, overtime: overtimeClimate, workload: staffUse > .94 ? -3 : staffUse >= .45 ? 1 : -1 };
    const trustParts = { served: honoredRate * 3.2 - (1 - honoredRate) * 5.8, communication: communication.trust, access: accessTrust, pace: paceTrust };
    social.staffClimate = clamp(social.staffClimate + Object.values(climateParts).reduce((sum, value) => sum + value, 0), 0, 100);
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
      actionRecords: actions.map((action) => clone({ key: action.key, ...action.payload })),
      legacyActions: [],
      clinicSnapshot: clinicSnapshot(clinic),
      serviceResults: results,
      financial: { revenue, baseVariableCosts, variableCosts, payroll, socialCharges, overtimeHours, overtimePay, overtimeCost, ownedMaintenance, leaseCosts, roomRent, locationRent: location.rent, facilityCosts, openingCosts, dropoffCost, stockCost: stock.cost, hrCost, marketingCost, sustainabilityCost, admin, loanPayment, loanPrincipalPayment, loanInterest, oneTimeCosts: effects.oneTimeCosts, cashAdjustment: financingCashAdjustment, fixedCosts, totalCosts, operatingResult, tax, netResult, treasury, margin: revenue ? netResult / revenue : 0, breakEvenCases: avgContribution ? Math.ceil(fixedCosts / avgContribution) : 0 },
      operational: { totalDemand, totalOpportunity, totalHonored, honoredRate, mainConstraint, staffUse, startVetHours: resources.totalVet, remainingVetHours: resources.remainingVet, startSupportHours: resources.totalSupport, remainingSupportHours: resources.remainingSupport, reservedSupportHours: resources.reservedSupport, roomUse: resourceUse(resources.startRooms, resources.rooms), equipmentUse: resourceUse(resources.startEquipment, resources.equipment), advancedServed, readyServices, facilityRows, staffRows: resources.staffRows, serviceHourRows },
      social: { before: clone(before.social || DEFAULT_SOCIAL), after: social, climateParts, trustParts },
      carbon,
      recruitment: effects.recruitment,
      next: { clients, reputation, social, loan: nextLoan }
    };
  }

  function simulatePlan(actions = pendingActions()) {
    const clinic = clone(state);
    const effects = emptyEffects();
    actions.forEach((action) => combineEffects(effects, applyAction(clinic, action, true)));
    return simulateYear(clinic, state, effects, actions);
  }

  function forecastPair() {
    return { baseline: simulatePlan([]), forecast: simulatePlan(pendingActions()) };
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
    const before = clone(state);
    const effects = emptyEffects();
    actions.forEach((action) => combineEffects(effects, applyAction(state, action, true)));
    const report = simulateYear(state, before, effects, actions);
    state.treasury = report.financial.treasury;
    state.clients = report.next.clients;
    state.reputation = report.next.reputation;
    state.social = report.next.social;
    state.finance.loan = report.next.loan;
    state.staff.forEach((person) => {
      const row = report.operational.staffRows.find((item) => item.id === person.id);
      person.lastOvertimeRatio = row?.availableHours ? row.overtimeHours / row.availableHours : 0;
    });
    state.history.push(report);
    state.pending = {};
    state.year += 1;
    state.domain = "results";
    ui.drawer = null;
    ui.drawerContext = null;
    ui.confirm = null;
    if (!state.sandboxMode) {
      if (state.treasury < state.rules.bankruptcyThreshold) state.endState = { type: "failure", reportTurn: report.turn };
      else if (report.turn >= state.rules.targetYear) state.endState = { type: "success", reportTurn: report.turn };
    }
    saveState();
    render();
    toast(t("toast.yearComplete", { year: report.turn }), "good");
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

  function priceSensitivity(value) {
    if (value <= .25) return L("Low", "Faible");
    if (value <= .50) return L("Medium", "Moyenne");
    return L("High", "Élevée");
  }

  function annualCostDrivers(forecast) {
    const financial = forecast.financial;
    return [
      { key: "payroll", label: L("payroll and employer costs", "les salaires et charges"), value: financial.payroll + financial.socialCharges },
      { key: "facilities", label: L("rooms, equipment, and rent", "les salles, l’équipement et le loyer"), value: financial.facilityCosts },
      { key: "supplies", label: L("direct supplies", "les fournitures directes"), value: financial.variableCosts },
      { key: "operations", label: L("other annual operating costs", "les autres coûts annuels de fonctionnement"), value: financial.openingCosts + financial.dropoffCost + financial.stockCost + financial.hrCost + financial.marketingCost + financial.sustainabilityCost + financial.admin + financial.loanInterest }
    ].sort((a, b) => b.value - a.value);
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
        action: L(`Open ${serviceName(first)}`, `Ouvrir ${serviceName(first)}`),
        secondary: { label: L("Move the hours", "Déplacer les heures"), destination: { drawer: "staffAllocation", context: onClosed.person.id } }
      });
    }
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
          `${pct(1 - forecast.operational.staffUse)} of available work hours are unused${person ? `; ${person.name} has ${number(idlest.unusedHours)} spare hours` : ""}.${openable ? ` ${serviceName(openable.id)} is ready to open, with about ${number(openable.demand)} requests a year.` : " Move hours to services that are short, or use spare support time for stock or market research."}`,
          `${pct(1 - forecast.operational.staffUse)} des heures de travail disponibles sont inutilisées${person ? ` ; ${person.name} a ${number(idlest.unusedHours)} heures libres` : ""}.${openable ? ` ${serviceName(openable.id)} peut ouvrir, avec environ ${number(openable.demand)} demandes par an.` : " Déplacez des heures vers les services en manque, ou utilisez le temps de soutien libre pour le stock ou l’étude de marché."}`
        ),
        action: openable ? L(`Explore ${serviceName(openable.id)}`, `Explorer ${serviceName(openable.id)}`) : L("Explore compatible services", "Explorer les services compatibles"),
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
    return signals.slice(0, 3).map((signal) => ({ ...signal, scenarioId: clinic.scenarioId }));
  }

  function formatMetric(value, type) {
    if (type === "money") return money(value);
    if (type === "percent") return pct(value);
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
          <div><span>${escapeHtml(t("app.actions"))}</span><strong>${pendingActions().length}/${escapeHtml(limitText)}</strong></div>
          <div class="hide-small"><span>${escapeHtml(t("app.scenario"))}</span><strong>${escapeHtml(itemLabel(D.scenarios[state.scenarioId].name))}</strong></div>
        </div>
        <div class="header-actions">
          <div class="language-switch" role="group" aria-label="${escapeHtml(t("app.language"))}">
            <button data-language="fr" class="${state.language === "fr" ? "active" : ""}" aria-pressed="${state.language === "fr"}">FR</button>
            <button data-language="en" class="${state.language === "en" ? "active" : ""}" aria-pressed="${state.language === "en"}">EN</button>
          </div>
          <button class="button secondary" data-help>${escapeHtml(t("app.help"))}</button>
          <button class="button secondary hide-small" data-export>${escapeHtml(t("app.export"))}</button>
        </div>
      </header>
    `;
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

  function renderPlanPanel(baseline, forecast) {
    const rows = [
      ["forecast.revenue", baseline.financial.revenue, forecast.financial.revenue, "money"],
      ["forecast.totalCosts", baseline.financial.totalCosts, forecast.financial.totalCosts, "money"],
      ["forecast.netResult", baseline.financial.netResult, forecast.financial.netResult, "money"],
      ["forecast.treasury", baseline.financial.treasury, forecast.financial.treasury, "money"],
      ["forecast.served", baseline.operational.totalHonored, forecast.operational.totalHonored, "number"],
      ["forecast.staffUse", baseline.operational.staffUse, forecast.operational.staffUse, "percent"],
      ["carbon.total", baseline.carbon.total, forecast.carbon.total, "carbon"]
    ];
    return `<aside class="plan-panel" aria-label="${escapeHtml(t("forecast.title"))}">
      <button class="mobile-plan-toggle" data-open-drawer="plan"><strong>${escapeHtml(L("Plan", "Plan"))} · ${pendingActions().length} ${escapeHtml(pendingActions().length === 1 ? t("common.action") : t("common.actions"))}</strong><span>${money(forecast.financial.treasury - baseline.financial.treasury)} · ${forecast.carbon.total - baseline.carbon.total > 0 ? "+" : ""}${tonnes(forecast.carbon.total - baseline.carbon.total)}</span></button>
      <div class="panel-heading"><div><h2>${escapeHtml(t("forecast.title"))}</h2><p>${escapeHtml(t("forecast.note"))}</p></div></div>
      <div class="forecast-table">
        <div class="forecast-head"><span></span><span>${escapeHtml(t("common.baseline"))}</span><span>${escapeHtml(t("common.planned"))}</span><span>${escapeHtml(t("common.delta"))}</span></div>
        ${rows.map(([key, base, plan, type]) => `<div class="forecast-row"><strong>${escapeHtml(key === "carbon.total" ? L("Carbon", "Carbone") : t(key))}</strong><span>${escapeHtml(type === "carbon" ? tonnes(base) : formatMetric(base, type))}</span><span>${escapeHtml(type === "carbon" ? tonnes(plan) : formatMetric(plan, type))}</span><em>${escapeHtml(type === "carbon" ? `${plan - base > 0 ? "+" : ""}${tonnes(plan - base)}` : signed(plan - base, type))}</em></div>`).join("")}
        <div class="forecast-row constraint"><strong>${escapeHtml(t("forecast.constraint"))}</strong><span>${escapeHtml(blockerText(baseline.operational.mainConstraint))}</span><span>${escapeHtml(blockerText(forecast.operational.mainConstraint))}</span><em>${baseline.operational.mainConstraint.type === forecast.operational.mainConstraint.type ? "=" : "↻"}</em></div>
      </div>
      <div class="plan-actions">
        ${pendingActions().length ? pendingActions().map((action) => `<div class="plan-action"><span>${escapeHtml(actionLabel(action.payload))}</span><button data-remove-action="${escapeHtml(action.key)}" aria-label="${escapeHtml(t("common.remove"))}">×</button></div>`).join("") : `<p class="empty">${escapeHtml(t("forecast.noActions"))}</p>`}
      </div>
      <div class="plan-footer"><button class="button primary pass-button" data-pass-year>${escapeHtml(t("app.pass"))}</button></div>
    </aside>`;
  }

  function previewAction(key, payload) {
    const without = pendingActions().filter((action) => action.key !== key);
    const before = simulatePlan(without);
    const after = simulatePlan([...without, { key, payload }]);
    return { before, after };
  }

  function effectWord(value, lowerIsBetter = false) {
    if (Math.abs(value) < .0001) return L("No direct effect", "Aucun effet direct");
    const improves = lowerIsBetter ? value < 0 : value > 0;
    return improves ? L("Improves", "Améliore") : L("Worsens", "Dégrade");
  }

  function consequencePreview(key, payload) {
    const { before, after } = previewAction(key, payload);
    const cash = after.financial.treasury - before.financial.treasury;
    const recurring = (after.financial.totalCosts - after.financial.oneTimeCosts) - (before.financial.totalCosts - before.financial.oneTimeCosts);
    const served = after.operational.totalHonored - before.operational.totalHonored;
    const workload = after.operational.staffUse - before.operational.staffUse;
    const carbon = after.carbon.total - before.carbon.total;
    const cells = [
      [L("Cash", "Trésorerie"), signed(cash, "money"), effectWord(cash)],
      [L("Recurring cost", "Coût récurrent"), signed(recurring, "money"), effectWord(recurring, true)],
      [L("Cases served", "Cas traités"), signed(served), effectWord(served)],
      [L("Team workload", "Charge de l’équipe"), signed(workload, "percent"), Math.abs(workload) < .0001 ? L("No direct effect", "Aucun effet direct") : L("Changes", "Change")],
      [L("Carbon", "Carbone"), `${carbon > 0 ? "+" : ""}${tonnes(carbon, 2)}`, effectWord(carbon, true)]
    ];
    const note = Math.abs(served) < .5 && Math.abs(workload) < .0001 ? noEffectReason(payload) : "";
    return `<div class="consequence-grid" aria-label="${escapeHtml(L("Expected consequences", "Conséquences attendues"))}">${cells.map(([label, value, word]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(word)}</em></div>`).join("")}</div>${note ? `<p class="no-effect"><strong>${escapeHtml(L("No effect on cases yet", "Pas encore d’effet sur les cas"))}:</strong> ${escapeHtml(note)}</p>` : ""}`;
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

  function reviewButton(key, payload, label) {
    return `<button class="button primary" data-review-key="${escapeHtml(key)}" data-review-payload="${escapeHtml(encodedPayload(payload))}">${escapeHtml(label || L("Review action", "Examiner l’action"))}</button>`;
  }

  function optionCard(title, description, key, payload, meta = "") {
    return `<article class="choice-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}${consequencePreview(key, payload)}${reviewButton(key, payload)}</article>`;
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
    if (!ui.settingsDraft) ui.settingsDraft = { actionLimit: state.rules.unlimited ? "unlimited" : String(state.rules.actionLimit), targetYear: state.rules.targetYear, bankruptcyThreshold: state.rules.bankruptcyThreshold };
    const settings = ui.settingsDraft;
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Clinic overview", "Vue d’ensemble de la clinique"))}</h1><p>${escapeHtml(L("See the situation, choose one area, and check the consequences before acting.", "Observez la situation, choisissez un domaine et vérifiez les conséquences avant d’agir."))}</p></div></div>
      ${showGuide ? `<section class="beginner-guide" aria-labelledby="beginner-guide-title"><div><span>${escapeHtml(L("Year 1 guide", "Guide de l’année 1"))}</span><h2 id="beginner-guide-title">${escapeHtml(L("Your first turn", "Votre premier tour"))}</h2></div><ol><li><strong>${escapeHtml(L("Read the clinic situation", "Comprenez la situation"))}</strong><span>${escapeHtml(L("Start with the signals below.", "Commencez par les signaux ci-dessous."))}</span></li><li><strong>${escapeHtml(L("Choose one priority", "Choisissez une priorité"))}</strong><span>${escapeHtml(L("Open only the area you want to improve.", "Ouvrez uniquement le domaine à améliorer."))}</span></li><li><strong>${escapeHtml(L("Compare before confirming", "Comparez avant de confirmer"))}</strong><span>${escapeHtml(L("Nothing is spent until you add a decision to the plan.", "Rien n’est dépensé avant l’ajout d’une décision au plan."))}</span></li></ol><button class="button secondary" data-dismiss-guide>${escapeHtml(L("Got it", "J’ai compris"))}</button></section>` : ""}
      <div class="dashboard-grid compact-four">
        ${metricCard(L("Net result", "Résultat net"), money(forecast.financial.netResult), pct(forecast.financial.margin), forecast.financial.netResult >= 0 ? "good" : "bad")}
        ${metricCard(L("Requests served", "Demandes traitées"), `${number(forecast.operational.totalHonored)} / ${number(forecast.operational.totalDemand)}`, pct(forecast.operational.honoredRate), forecast.operational.honoredRate >= .82 ? "good" : "warn")}
        ${metricCard(L("Team workload", "Charge de l’équipe"), pct(forecast.operational.staffUse), `${number(forecast.operational.reservedSupportHours)} ${L("support hours reserved", "heures de soutien réservées")}`, forecast.operational.staffUse > .94 ? "bad" : "")}
        ${metricCard(L("Carbon footprint", "Empreinte carbone"), tonnes(forecast.carbon.total), `${carbonDelta > 0 ? "+" : ""}${tonnes(carbonDelta)} ${L("vs start", "par rapport au départ")}`, carbonDelta <= 0 ? "good" : "warn")}
      </div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("What needs attention", "Points d’attention"))}</h2><p>${escapeHtml(L("Each signal explains what is happening and where you can investigate it.", "Chaque signal explique ce qui se passe et où l’examiner."))}</p></div></div><div class="priority-list">${signals.map((item) => `<article class="signal-${item.status}" data-signal-key="${item.key}"><div><span>${escapeHtml(item.title)}</span><strong>${escapeHtml(item.text)}</strong></div><div class="signal-actions">${signalButton(item.destination, item.action, "primary")}${item.secondary ? signalButton(item.secondary.destination, item.secondary.label, "secondary") : ""}</div></article>`).join("")}</div></section>
      <section class="card-section goals"><div class="panel-heading"><h2>${escapeHtml(L("Scenario goals", "Objectifs du scénario"))}</h2><strong>${passed}/${goals.length}</strong></div>${goals.map((goal) => `<div class="goal-row ${goal.ok ? "good" : "bad"}"><span aria-hidden="true">${goal.ok ? "✓" : "○"}</span><strong>${escapeHtml(itemLabel(goal.label))}</strong><em>${escapeHtml(goal.display)}</em></div>`).join("")}</section>
      <details class="card-section settings-details" data-settings ${ui.settingsOpen ? "open" : ""}><summary>${escapeHtml(L("Simulation settings and scenarios", "Paramètres et scénarios"))}</summary><div class="rules-grid">
        <label><span>${escapeHtml(t("app.actionLimit"))}</span><select data-settings-field="actionLimit">${Array.from({ length: 12 }, (_, index) => index + 1).map((count) => `<option value="${count}" ${String(settings.actionLimit) === String(count) ? "selected" : ""}>${count} ${escapeHtml(count === 1 ? L("action", "action") : L("actions", "actions"))}</option>`).join("")}<option value="unlimited" ${settings.actionLimit === "unlimited" ? "selected" : ""}>${escapeHtml(t("app.unlimited"))}</option></select></label>
        <label><span>${escapeHtml(t("app.targetYear"))}</span><input type="number" min="${state.year}" max="12" value="${settings.targetYear}" data-settings-field="targetYear"></label>
        <label><span>${escapeHtml(t("app.bankruptcy"))}</span><input type="number" min="-1000000" max="0" step="10000" value="${settings.bankruptcyThreshold}" data-settings-field="bankruptcyThreshold"></label>
        <button class="button primary" data-save-settings>${escapeHtml(L("Save settings", "Enregistrer les paramètres"))}</button>
      </div>${ui.settingsError ? `<p class="form-error" role="alert">${escapeHtml(ui.settingsError)}</p>` : ""}<div class="scenario-grid compact">${Object.entries(D.scenarios).map(([id, scenario]) => `<article class="choice-card ${state.scenarioId === id ? "selected" : ""}"><h3>${escapeHtml(itemLabel(scenario.name))}</h3><p>${escapeHtml(itemLabel(scenario.description))}</p><button class="button ${state.scenarioId === id ? "secondary" : "danger"}" data-scenario="${id}" ${state.scenarioId === id ? "disabled" : ""}>${escapeHtml(state.scenarioId === id ? t("common.current") : t("dashboard.chooseScenario"))}</button></article>`).join("")}</div><div class="button-row"><button class="button secondary" data-export>${escapeHtml(t("app.export"))}</button><button class="button danger" data-reset>${escapeHtml(t("app.reset"))}</button></div></details>
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
      <div class="dashboard-grid compact-four">${metricCard(L("Active services", "Services actifs"), number(active.length), `${forecast.operational.readyServices} ${L("ready and staffed", "prêts et dotés en personnel")}`)}${metricCard(L("Cases served", "Cas traités"), number(forecast.operational.totalHonored), pct(forecast.operational.honoredRate))}${metricCard(L("Rooms", "Salles"), number(roomCount))}${metricCard(L("Clinical equipment", "Équipement clinique"), number(equipmentCount))}</div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Current services", "Services actuels"))}</h2><p>${escapeHtml(L("Readiness and the current bottleneck are shown without exposing the whole catalog.", "La préparation et le blocage actuel sont visibles sans afficher tout le catalogue."))}</p></div><button class="button primary" data-open-drawer="services">${escapeHtml(L("Explore services", "Explorer les services"))}</button></div><div class="summary-list">${active.map((service) => { const row = forecast.serviceResults.find((item) => item.id === service.id); return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong><span>${escapeHtml(serviceStatusLabel(row))}</span></div><span>${number(row.honored)} / ${number(row.demand)} ${escapeHtml(L("served", "traités"))}</span><em>${escapeHtml(blockerText(row.bottleneck))}</em></article>`; }).join("")}</div></section>
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
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Current team", "Équipe actuelle"))}</h2><span class="panel-links"><button class="text-button" data-open-drawer="capabilities">${escapeHtml(L("Who can do what", "Qui peut faire quoi"))} ›</button><button class="text-button" data-open-drawer="hoursByService">${escapeHtml(L("See hours by service", "Voir les heures par service"))} ›</button></span></div><button class="button secondary" data-open-drawer="training">${escapeHtml(L("Plan training", "Planifier une formation"))}</button></div><div class="staff-grid">${planned.staff.map((person) => { const row = rows[person.id]; const summary = normalizeAllocations(person).map((allocation) => `${serviceName(allocation.serviceId)} ${Math.round(allocation.share * 100)}%`).join(" · "); return `<article class="staff-card"><div class="staff-head"><div><h3>${escapeHtml(person.name)}</h3><span>${escapeHtml(person.role === "vet" ? L("Veterinarian", "Vétérinaire") : L("Support", "Soutien"))}</span></div><strong>${pct(row?.workload || 0)}</strong></div><div class="chips" aria-label="${escapeHtml(L("Skills", "Compétences"))}">${person.skills.length ? person.skills.map((skill) => `<span class="chip">${escapeHtml(skillName(skill))}</span>`).join("") : `<span class="chip">${escapeHtml(L("No specialist skills", "Aucune compétence spécialisée"))}</span>`}</div><p class="allocation-summary">${escapeHtml(summary)}</p>${(() => { const zone = allocationZone(row?.assignedShare ?? 1); return `<p class="staff-zone ${zone.tone}">${escapeHtml(zone.text)}</p>`; })()}${(() => { const closed = closedAssignments(person, planned); if (!closed.length) return ""; const hours = closed.reduce((sum, item) => sum + (row?.availableHours || 0) * item.share, 0); const names = closed.map((item) => serviceName(item.serviceId)).join(", "); return `<p class="staff-zone bad">△ ${escapeHtml(L(`${number(hours)} h on closed services (${names}) produce nothing`, `${number(hours)} h sur des services fermés (${names}) ne produisent rien`))}</p>`; })()}<div class="staff-hours-line"><span>${escapeHtml(L("Hours used", "Heures utilisées"))}</span><strong>${number(row?.usedHours || 0)} / ${number(row?.availableHours || 0)}${row?.overtimeHours > 0 ? ` · ${escapeHtml(L("overtime", "heures sup."))} ${number(row.overtimeHours)}` : ""}</strong></div>${meter(row?.workload || 0, row?.workload > 1 ? "bad" : row?.workload > .94 ? "warn" : "good")}<div class="button-row"><button class="button primary" data-open-drawer="staffAllocation" data-context="${person.id}">${escapeHtml(L("Change time allocation", "Modifier l’affectation du temps"))}</button><button class="button secondary" data-open-drawer="staffPerson" data-context="${person.id}">${escapeHtml(L("Pay", "Salaire"))}</button></div></article>`; }).join("")}</div></section>
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
      return `<td class="cap-train"><button class="text-button" data-open-drawer="training" data-context="${escapeHtml(person.id)}">△ ${escapeHtml(L("Train", "Former"))}: ${escapeHtml(skillName(skill))}</button>${assigned}</td>`;
    };
    const facilityNote = (service) => missingRequirements(service, planned).filter((reason) => !reason.type.includes("Skill")).map((reason) => blockerText(reason)).join(" · ");
    return `<p>${escapeHtml(L("Each service needs work from a veterinarian, support staff, or both, and sometimes a specific skill. Allocate people only where they show ✓; △ hours stay blocked until that person is trained. Vets can also cover support tasks, but their hours cost more.", "Chaque service demande du travail vétérinaire, de soutien, ou les deux, et parfois une compétence précise. Affectez les personnes là où elles ont ✓ ; les heures △ restent bloquées jusqu’à la formation de cette personne. Les vétérinaires peuvent aussi assurer les tâches de soutien, mais leurs heures coûtent plus cher."))}</p><p class="cap-legend"><span class="cap-yes">✓ ${escapeHtml(L("qualified now", "qualifié maintenant"))}</span><span class="cap-train">△ ${escapeHtml(L("needs training", "formation nécessaire"))}</span><span class="cap-none">— ${escapeHtml(L("role not used by this service", "fonction non utilisée par ce service"))}</span></p><div class="table-scroll"><table class="capability-table"><thead><tr><th scope="col">${escapeHtml(L("Service", "Service"))}</th>${planned.staff.map((person) => `<th scope="col">${escapeHtml(person.name)}<small>${escapeHtml(roleLabel(person.role))}</small></th>`).join("")}</tr></thead><tbody>${services.map((service) => { const note = facilityNote(service); return `<tr><th scope="row">${escapeHtml(serviceName(service.id))}<small>${escapeHtml(planned.services[service.id].active ? L("Open", "Ouvert") : L("Closed", "Fermé"))}${note ? ` · ${escapeHtml(note)}` : ""}</small></th>${planned.staff.map((person) => cell(person, service)).join("")}</tr>`; }).join("")}</tbody></table></div>`;
  }

  function renderTrainingDrawer(planned) {
    const person = planned.staff.find((item) => item.id === ui.drawerContext);
    if (!person) return `<p>${escapeHtml(L("Training is given to one person at a time. Choose who to train.", "La formation concerne une personne à la fois. Choisissez qui former."))}</p><div class="drawer-menu">${planned.staff.map((item) => `<button data-drawer-context="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(roleLabel(item.role))} · ${escapeHtml(item.skills.map(skillName).join(", ") || L("No specialist skills", "Aucune compétence spécialisée"))}</span><em>›</em></button>`).join("")}</div>`;
    const options = Object.entries(D.trainings).filter(([, training]) => training.role === person.role);
    return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Choose another person", "Choisir une autre personne"))}</button><p>${escapeHtml(L(`Training takes hours from ${person.name} only, this year only.`, `La formation prend des heures à ${person.name} uniquement, cette année seulement.`))}</p><div class="drawer-cards">${options.map(([id, training]) => { const has = person.skills.includes(id); const unlocks = D.services.filter((service) => (person.role === "vet" ? service.vetSkills : service.supportSkills).includes(id)).map((service) => serviceName(service.id)).join(", "); const key = `training:${id}:${person.id}`; const payload = { kind: "training", targetId: id, personId: person.id }; return `<article class="choice-card"><h3>${escapeHtml(itemLabel(training.name))}</h3><p>${money(training.cost)} ${escapeHtml(L("once", "une fois"))} · ${number(training.hours)} ${escapeHtml(L("training hours", "heures de formation"))}</p><small>${escapeHtml(L("Unlocks", "Débloque"))}: ${escapeHtml(unlocks)}</small>${has ? `<strong>✓ ${escapeHtml(L("Already has this skill", "Possède déjà cette compétence"))}</strong>` : `${consequencePreview(key, payload)}${reviewButton(key, payload)}`}</article>`; }).join("")}</div>`;
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
    const meterText = percent === 0 ? L("0% assigned — give this person at least one service", "0 % affectés — donnez au moins un service à cette personne")
      : percent < 100 ? L(`${percent}% assigned · ${100 - percent}% unassigned (paid but idle)`, `${percent} % affectés · ${100 - percent} % non affectés (payés mais inoccupés)`)
      : percent === 100 ? L("100% assigned — fully booked, no overtime", "100 % affectés — temps plein, sans heures supplémentaires")
      : L(`${percent}% assigned · up to ${number(draftRow?.overtimeAssignedHours || 0)} overtime hours (max ${Math.round(MAX_ALLOCATION * 100)}%). Forecast worked: ${number(draftRow?.overtimeHours || 0)} h ≈ ${money(draftOvertimeCost)}`, `${percent} % affectés · jusqu’à ${number(draftRow?.overtimeAssignedHours || 0)} heures supplémentaires (max ${Math.round(MAX_ALLOCATION * 100)} %). Prévu : ${number(draftRow?.overtimeHours || 0)} h ≈ ${money(draftOvertimeCost)}`);
    const zoneClass = !valid ? "warn" : percent > 100 ? "overtime" : percent < 100 ? "idle" : "ready";
    const hoursFlow = currentRow ? L(`${number(currentRow.contractedHours)} contracted − ${number(currentRow.expectedAbsenceHours)} expected absence${currentRow.fatigueAbsenceHours > 1 ? ` (${number(currentRow.fatigueAbsenceHours)} from last year’s overtime)` : ""} − ${number(currentRow.trainingHours)} training − ${number(currentRow.nonClinicalHours)} other duties = ${number(currentRow.availableHours)} available hours`, `${number(currentRow.contractedHours)} contractuelles − ${number(currentRow.expectedAbsenceHours)} d’absence prévue${currentRow.fatigueAbsenceHours > 1 ? ` (${number(currentRow.fatigueAbsenceHours)} dues aux heures sup. de l’an dernier)` : ""} − ${number(currentRow.trainingHours)} de formation − ${number(currentRow.nonClinicalHours)} d’autres tâches = ${number(currentRow.availableHours)} heures disponibles`) : "";
    return `<div class="allocation-editor"><p class="callout">${escapeHtml(L(`Up to 100%, changing percentages moves existing hours; it does not create new hours. Above 100% is paid overtime (${OVERTIME_PREMIUM}× pay, maximum ${Math.round(MAX_ALLOCATION * 100)}%) and lowers staff climate. Below 100% is paid idle time.`, `Jusqu’à 100 %, modifier les pourcentages déplace des heures existantes ; cela ne crée pas de nouvelles heures. Au-delà de 100 %, ce sont des heures supplémentaires payées (${String(OVERTIME_PREMIUM).replace(".", ",")}× le salaire, ${Math.round(MAX_ALLOCATION * 100)} % maximum) qui dégradent le climat d’équipe. En dessous, le temps payé reste inoccupé.`))}</p>${hoursFlow ? `<p class="hours-flow">${escapeHtml(hoursFlow)}</p>` : ""}<div class="mini-hours">${[[L("Available hours", "Heures disponibles"), currentRow?.availableHours], [L("Hours used", "Heures utilisées"), currentRow?.usedHours], [L("Unused hours", "Heures inutilisées"), currentRow?.unusedHours], [L("Blocked hours", "Heures bloquées"), currentRow?.blockedHours]].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${number(value || 0)}</strong></div>`).join("")}</div><div class="allocation-total ${zoneClass}"><strong>${escapeHtml(meterText)}</strong>${meter(total / MAX_ALLOCATION, percent > 100 ? "bad" : valid && percent === 100 ? "good" : "warn")}</div><div class="allocation-rows">${draft.map((allocation, index) => { const service = SERVICE_BY_ID[allocation.serviceId]; const qualified = personQualified(person, service); const hours = (currentRow?.availableHours || 0) * allocation.share; return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong>${qualified ? "" : `<span class="qualification-warning">△ ${escapeHtml(L("Needs training", "Formation nécessaire"))}</span>`}<small>${number(hours)} ${escapeHtml(qualified ? L("assigned hours", "heures affectées") : L("hours blocked until training", "heures bloquées jusqu’à la formation"))}</small>${allocationRowNote(person, service, comparison.after, planned)}</div><div class="stepper" role="group" aria-label="${escapeHtml(serviceName(service.id))}"><button data-allocation-adjust="-5" data-allocation-index="${index}" aria-label="${escapeHtml(L("Reduce by 5%", "Réduire de 5 %"))}">−</button><output>${Math.round(allocation.share * 100)}%</output><button data-allocation-adjust="5" data-allocation-index="${index}" ${total >= MAX_ALLOCATION - .0001 ? "disabled" : ""} aria-label="${escapeHtml(L("Increase by 5%", "Augmenter de 5 %"))}">+</button><button class="remove-allocation" data-remove-allocation="${index}" aria-label="${escapeHtml(L("Remove service", "Retirer le service"))}">×</button></div></article>`; }).join("")}</div>${ordered.length ? `<div class="add-allocation"><label><span>${escapeHtml(L("Add another service", "Ajouter un autre service"))}</span><select data-allocation-service>${optionGroup(L("Active and planned services", "Services actifs et planifiés"), activeOptions)}${optionGroup(L("Other services", "Autres services"), otherOptions)}${optionGroup(L("Needs training", "Formation nécessaire"), trainingOptions)}</select></label><button class="button secondary" data-add-allocation>${escapeHtml(L("Add at 0%", "Ajouter à 0 %"))}</button></div>` : ""}${remainingBlockers.length ? `<div class="requirement-list"><strong>${escapeHtml(L("Other blockers still apply", "D’autres blocages restent à résoudre"))}</strong>${remainingBlockers.map((item) => `<div><span>△ ${escapeHtml(serviceName(item.serviceId))}: ${escapeHtml(blockerText(item.reason))}</span></div>`).join("")}</div>` : ""}<section class="allocation-impact"><h3>${escapeHtml(L("Live impact", "Impact en direct"))}</h3><div class="comparison-list"><div><strong>${escapeHtml(L("This person’s workload", "Charge de cette personne"))}</strong><span>${pct(currentRow?.workload || 0)}</span><em>→ ${pct(draftRow?.workload || 0)}</em></div><div><strong>${escapeHtml(L("Clinic workload", "Charge de la clinique"))}</strong><span>${pct(comparison.before.operational.staffUse)}</span><em>→ ${pct(comparison.after.operational.staffUse)}</em></div><div><strong>${escapeHtml(L("Cases served", "Cas traités"))}</strong><span>${number(comparison.before.operational.totalHonored)}</span><em>→ ${number(comparison.after.operational.totalHonored)}</em></div><div><strong>${escapeHtml(L("Net result", "Résultat net"))}</strong><span>${money(comparison.before.financial.netResult)}</span><em>→ ${money(comparison.after.financial.netResult)}</em></div><div><strong>${escapeHtml(L("Overtime cost", "Coût des heures supplémentaires"))}</strong><span>${money(comparison.before.financial.overtimeCost)}</span><em>→ ${money(comparison.after.financial.overtimeCost)}</em></div><div><strong>${escapeHtml(L("Staff climate", "Climat de l’équipe"))}</strong><span>${number(comparison.before.social.after.staffClimate)}</span><em>→ ${number(comparison.after.social.after.staffClimate)}</em></div><div><strong>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</strong><span>${tonnes(comparison.before.carbon.total)}</span><em>→ ${tonnes(comparison.after.carbon.total)}</em></div></div>${serviceDeltas.length ? `<ul>${serviceDeltas.map((row) => `<li><strong>${escapeHtml(serviceName(row.id))}:</strong> ${escapeHtml(row.cases > 0 ? L(`${row.cases} additional cases possible`, `${row.cases} cas supplémentaires possibles`) : L(`${Math.abs(row.cases)} fewer cases possible`, `${Math.abs(row.cases)} cas possibles en moins`))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No change in cases served with this draft.", "Aucun changement des cas traités avec ce brouillon."))}</p>`}</section><button class="button primary" data-review-allocation="${person.id}" ${valid ? "" : "disabled"}>${escapeHtml(L("Review allocation", "Examiner l’affectation"))}</button></div>`;
  }

  function renderHoursByService(forecast) {
    const rows = forecast.operational.serviceHourRows.filter((row) => state.services[row.serviceId]?.active || row.assignedHours > 0);
    return `<p>${escapeHtml(L("Hours assigned to a service remain there even when another room, skill, or equipment requirement blocks care.", "Les heures affectées à un service y restent même si une salle, une compétence ou un équipement bloque les soins."))}</p><div class="hours-table" role="table"><div role="row"><strong>${escapeHtml(L("Service", "Service"))}</strong><strong>${escapeHtml(L("Role", "Fonction"))}</strong><strong>${escapeHtml(L("Assigned", "Affectées"))}</strong><strong>${escapeHtml(L("Needed", "Nécessaires"))}</strong><strong>${escapeHtml(L("Used", "Utilisées"))}</strong><strong>${escapeHtml(L("Balance", "Solde"))}</strong></div>${rows.map((row) => `<div role="row"><span>${escapeHtml(serviceName(row.serviceId))}</span><span>${escapeHtml(row.role === "vet" ? L("Vet", "Vét.") : L("Support", "Soutien"))}</span><span>${number(row.assignedHours)}</span><span>${number(row.neededHours)}</span><span>${number(row.usedHours)}</span><strong class="${row.shortageHours > 0 ? "bad-text" : "good-text"}">${row.shortageHours > 0 ? `−${number(row.shortageHours)}` : `+${number(row.surplusHours)}`}</strong></div>`).join("")}</div>`;
  }

  function renderExportDrawer() {
    return `<p>${escapeHtml(L("Add optional participant details, then choose a readable report or the full analysis file.", "Ajoutez éventuellement les participants, puis choisissez un rapport lisible ou le fichier d’analyse complet."))}</p><div class="form-stack"><label><span>${escapeHtml(L("Team name", "Nom de l’équipe"))}</span><input type="text" maxlength="100" value="${escapeHtml(state.playerTeam.teamName)}" data-team-name></label><label><span>${escapeHtml(L("Participant names — one per line", "Noms des participants — un par ligne"))}</span><textarea rows="6" data-participant-names>${escapeHtml(state.playerTeam.participantNames.join("\n"))}</textarea></label></div><div class="export-choices"><article><h3>${escapeHtml(L("Printable report", "Rapport imprimable"))}</h3><p>${escapeHtml(L("A detailed report for every completed year, including actions, hours, carbon results, and the team’s written reflections.", "Un rapport détaillé pour chaque année terminée, avec les actions, les heures, les résultats carbone et les réflexions écrites de l’équipe."))}</p><button class="button primary" data-print-report>${escapeHtml(L("Print / Save as PDF", "Imprimer / Enregistrer en PDF"))}</button></article><article><h3>${escapeHtml(L("Analytical data", "Données analytiques"))}</h3><p>${escapeHtml(L("The complete structured clinic state and reports for further analysis.", "L’état complet et structuré de la clinique et les rapports pour une analyse ultérieure."))}</p><button class="button secondary" data-download-json>${escapeHtml(L("Download analytical JSON", "Télécharger le JSON analytique"))}</button></article></div>`;
  }

  function renderBusiness(planned, forecast) {
    const location = D.locations[planned.location.sectorId];
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Business", "Gestion"))}</h1><p>${escapeHtml(L("Prices, financing, market position, and location—opened one decision at a time.", "Prix, financement, marché et implantation — une décision à la fois."))}</p></div></div>
      <div class="dashboard-grid compact-four">${metricCard(L("Revenue", "Recettes"), money(forecast.financial.revenue))}${metricCard(L("Total costs", "Coûts totaux"), money(forecast.financial.totalCosts))}${metricCard(L("Net result", "Résultat net"), money(forecast.financial.netResult), pct(forecast.financial.margin), forecast.financial.netResult >= 0 ? "good" : "bad")}${metricCard(L("End treasury", "Trésorerie finale"), money(forecast.financial.treasury))}</div>
      <section class="card-section action-menu"><button data-open-drawer="pricing"><span>${escapeHtml(L("Service prices", "Prix des services"))}</span><strong>${escapeHtml(L("Review price sensitivity and money left after supplies", "Voir la sensibilité au prix et l’argent restant après les fournitures"))}</strong><em>›</em></button><button data-open-drawer="finance"><span>${escapeHtml(L("Financing", "Financement"))}</span><strong>${escapeHtml(planned.finance.loan ? money(planned.finance.loan.remaining) : L("No outstanding loan", "Aucun emprunt"))}</strong><em>›</em></button><button data-open-drawer="market"><span>${escapeHtml(L("Market focus", "Marché cible"))}</span><strong>${escapeHtml(itemLabel(D.segments[planned.marketFocus].name))}</strong><em>›</em></button><button data-open-drawer="location"><span>${escapeHtml(L("Location and parking", "Implantation et parking"))}</span><strong>${escapeHtml(itemLabel(location.name))}</strong><em>›</em></button><button data-open-drawer="marketing"><span>${escapeHtml(L("Market strategies", "Stratégies de marché"))}</span><strong>${escapeHtml(L("Communication, competitor monitoring, and local market research", "Communication, veille concurrentielle et étude du marché local"))}</strong><em>›</em></button></section>
    </section>`;
  }

  function renderSustainability(planned, forecast) {
    const baseline = state.carbonBaseline;
    const delta = forecast.carbon.total - baseline.total;
    const reduction = baseline.perCase ? 1 - forecast.carbon.perCase / baseline.perCase : 0;
    const sources = ["building", "clinical", "waste", "travel"];
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Sustainability", "Durabilité"))}</h1><p>${escapeHtml(L("Choose a source, see the trade-off, and decide whether it fits the clinic.", "Choisissez une source, observez le compromis et décidez s’il convient à la clinique."))}</p></div></div>
      <div class="dashboard-grid compact-four">${metricCard(L("Total footprint", "Empreinte totale"), tonnes(forecast.carbon.total), `${delta > 0 ? "+" : ""}${tonnes(delta)} ${L("vs start", "par rapport au départ")}`, delta <= 0 ? "good" : "warn")}${metricCard(L("Per treated case", "Par cas traité"), kilograms(forecast.carbon.perCase), `${pct(reduction)} ${L("change", "d’évolution")}`, reduction > 0 ? "good" : "warn")}${metricCard(L("Largest source", "Source principale"), sourceLabel(forecast.carbon.primaryDrivers[0]), tonnes(forecast.carbon.bySource[forecast.carbon.primaryDrivers[0]]))}${metricCard(L("Scenario target", "Objectif du scénario"), pct(({ balanced: .15, rescue: .08, growth: .20 })[state.scenarioId]), L("reduction per case while retaining 80% of starting care", "de réduction par cas en conservant 80 % des soins initiaux"))}</div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Where the footprint comes from", "Origine de l’empreinte"))}</h2><p>${escapeHtml(L("Select one source to see only the relevant choices.", "Sélectionnez une source pour ne voir que les choix pertinents."))}</p></div></div><div class="source-list">${sources.map((id) => { const value = forecast.carbon.bySource[id]; const share = forecast.carbon.total ? value / forecast.carbon.total : 0; return `<article><div><strong>${escapeHtml(sourceLabel(id))}</strong><span>${tonnes(value)} · ${pct(share)}</span></div>${meter(share, id === forecast.carbon.primaryDrivers[0] ? "warn" : "good")}<button class="button secondary" data-open-drawer="sustainability" data-context="${id}">${escapeHtml(L("See options", "Voir les options"))}</button></article>`; }).join("")}</div></section>
      <details class="card-section methodology"><summary>${escapeHtml(L("How is this calculated?", "Comment ce calcul est-il réalisé ?"))}</summary><p>${escapeHtml(L("The model combines building electricity and heating, volatile anaesthetic, waste treatment, and client travel. Official conversion factors are kept separate from the clinic activity assumptions used to make the simulation playable.", "Le modèle combine l’électricité et le chauffage du bâtiment, l’anesthésique volatil, le traitement des déchets et les déplacements des clients. Les facteurs de conversion officiels sont séparés des hypothèses d’activité qui rendent la simulation jouable."))}</p><dl><div><dt>${escapeHtml(L("Model version", "Version du modèle"))}</dt><dd>${escapeHtml(D.carbonModel.version)}</dd></div>${Object.values(D.carbonModel.factorRegistry).map((factor) => `<div><dt>${escapeHtml(itemLabel(factor.detail))}</dt><dd>${preciseNumber(factor.value)} ${escapeHtml(factor.unit)} · ${escapeHtml(String(factor.year))}<br>${escapeHtml(factor.source)}</dd></div>`).join("")}<div><dt>${escapeHtml(L("Simulation assumptions", "Hypothèses de simulation"))}</dt><dd>${escapeHtml(L("Energy and waste per service, building demand, room demand, client-trip patterns, and selected treatment routes.", "Énergie et déchets par service, besoins du bâtiment et des salles, déplacements des clients et filières de traitement retenues."))}</dd></div><div><dt>${escapeHtml(L("Not included", "Non inclus"))}</dt><dd>${escapeHtml(L("Medicines and other supply chains, staff commuting, equipment manufacture, construction, and refrigerants.", "Médicaments et autres chaînes d’approvisionnement, trajets du personnel, fabrication des équipements, construction et fluides frigorigènes."))}</dd></div></dl><p class="source-links"><a href="https://vetsustain.org/resources/the-veterinary-carbon-calculator-getting-started" target="_blank" rel="noreferrer">Vet Sustain</a><a href="https://www.eea.europa.eu/en/analysis/indicators/greenhouse-gas-emission-intensity-of-1-1751032678/greenhouse-gas-emission-intensity-of-electricity-generation-country-level" target="_blank" rel="noreferrer">EEA</a><a href="https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025" target="_blank" rel="noreferrer">UK 2025 factors</a><a href="https://www.gov.uk/guidance/fluorinated-gases-f-gases" target="_blank" rel="noreferrer">UK F-gas table</a><a href="https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=d27da7db-5c2c-4b9f-bf14-a4d18d3e6d4e" target="_blank" rel="noreferrer">DailyMed</a><a href="https://www.england.nhs.uk/long-read/nhs-clinical-waste-strategy/" target="_blank" rel="noreferrer">NHS clinical waste</a><a href="https://ghgprotocol.org/corporate-standard-frequently-asked-questions" target="_blank" rel="noreferrer">GHG Protocol</a></p></details>
    </section>`;
  }

  function requirementList(service, clinic) {
    const missing = missingRequirements(service, clinic);
    if (!missing.length) return `<p class="ready-note">✓ ${escapeHtml(L("All requirements are ready.", "Toutes les conditions sont réunies."))}</p>`;
    const target = (reason) => reason.type === "missingRoom" ? "rooms" : reason.type === "missingEquipment" ? "equipment" : reason.type === "opening" ? "opening" : reason.type.includes("Skill") ? "training" : "services";
    return `<div class="requirement-list"><strong>${escapeHtml(L("Missing requirements", "Conditions manquantes"))}</strong>${missing.map((reason) => `<div><span>○ ${escapeHtml(blockerText(reason))}</span><button class="text-button" data-open-drawer="${target(reason)}">${escapeHtml(L("Address this", "Agir"))} ›</button></div>`).join("")}</div>`;
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
      return `<button class="text-button" data-edit-vacancy>‹ ${escapeHtml(L("Revise vacancy", "Modifier l’offre"))}</button><p>${escapeHtml(L("Applicants are shown only after the role, skills, and budget are defined.", "Les candidats apparaissent uniquement après la définition du poste, des compétences et du budget."))}</p>${applicants.length ? `<div class="candidate-list">${applicants.slice(0, ui.candidateLimit).map((candidate) => { const hired = planned.staff.some((person) => person.id === candidate.id); const offer = ui.decisionDrafts[`offer:${candidate.id}`] ?? candidate.expectedSalary; return `<article class="choice-card"><h3>${escapeHtml(candidate.name)}</h3><div class="chips">${candidate.skills.map((skill) => `<span class="chip">${escapeHtml(skillName(skill))}</span>`).join("")}</div><p>${escapeHtml(itemLabel(candidate.pitch))}</p><small>${escapeHtml(L("Expected salary", "Salaire attendu"))}: ${money(candidate.expectedSalary)} · ${money(candidate.postingFee)} ${escapeHtml(L("posting fee", "de frais de publication"))}</small><label><span>${escapeHtml(L("Your offer", "Votre offre"))}</span><input type="number" min="${Math.round(candidate.expectedSalary * .8)}" max="${Math.round(candidate.expectedSalary * 1.3)}" step="500" value="${offer}" data-applicant-offer="${candidate.id}" data-draft-key="offer:${candidate.id}"></label><button class="button primary" data-review-hire="${candidate.id}" ${hired ? "disabled" : ""}>${escapeHtml(hired ? L("Already on staff", "Déjà dans l’équipe") : L("Review offer", "Examiner l’offre"))}</button></article>`; }).join("")}</div>${applicants.length > ui.candidateLimit ? `<button class="button secondary" data-more-applicants>${escapeHtml(L("Show more applicants", "Afficher plus de candidats"))}</button>` : ""}` : `<div class="empty-state"><strong>${escapeHtml(L("No applicant matches this vacancy.", "Aucun candidat ne correspond à cette offre."))}</strong><p>${escapeHtml(L("Increase the budget or revise the requested skills. No action or fee has been created.", "Augmentez le budget ou modifiez les compétences demandées. Aucune action ni aucun frais n’a été créé."))}</p></div>`}`;
  }

  function renderStaffPersonDrawer(planned) {
    const person = planned.staff.find((item) => item.id === ui.drawerContext);
    if (!person) return "";
    const draft = ui.decisionDrafts[`salary:${person.id}`] ?? person.salary;
    return `<div class="staff-editor"><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(L("Salary changes payroll, available work hours, and staff climate. Time allocation is managed separately.", "Le salaire modifie la masse salariale, les heures de travail disponibles et le climat de l’équipe. L’affectation du temps se gère séparément."))}</p><div class="form-stack"><label><span>${escapeHtml(L("Annual salary", "Salaire annuel"))}</span><input type="number" min="${Math.round(person.baseSalary * .8)}" max="${Math.round(person.baseSalary * 1.3)}" step="500" value="${draft}" data-draft-salary data-draft-key="salary:${person.id}"></label><small>${escapeHtml(L("Benchmark salary", "Salaire de référence"))}: ${money(person.baseSalary)}</small><button class="button primary" data-review-salary="${person.id}">${escapeHtml(L("Review salary change", "Examiner le changement de salaire"))}</button></div></div>`;
  }

  function renderServiceDrawer(planned, forecast) {
    const groups = {
      core: { label: L("Core care", "Soins essentiels"), ids: ["consult", "vaccination", "preventive", "emergency"] },
      diagnostics: { label: L("Diagnostics & imaging", "Diagnostic et imagerie"), ids: ["lab", "ultrasound", "radiography"] },
      surgery: { label: L("Surgery & dentistry", "Chirurgie et dentisterie"), ids: ["surgery", "dentistry", "orthopedic"] },
      hospital: { label: L("Hospital care", "Soins hospitaliers"), ids: ["hospital"] },
      commercial: { label: L("Pharmacy, retail & boarding", "Pharmacie, vente et pension"), ids: ["pharmacy", "retail", "boarding"] }
    };
    if (!ui.drawerContext || !groups[ui.drawerContext]) return `<p>${escapeHtml(L("Choose a service family to keep the catalog focused.", "Choisissez une famille de services pour limiter le catalogue."))}</p><div class="drawer-menu">${Object.entries(groups).map(([id, group]) => `<button data-drawer-context="${id}"><strong>${escapeHtml(group.label)}</strong><span>${escapeHtml(plural(group.ids.length, L("service", "service"), L("services", "services")))}</span><em>›</em></button>`).join("")}</div>`;
    const group = groups[ui.drawerContext];
    const selectedId = group.ids.includes(ui.selectedServiceId) ? ui.selectedServiceId : null;
    if (!selectedId) return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Service families", "Familles de services"))}</button><p>${escapeHtml(L("Select one service to see its requirements and consequences.", "Sélectionnez un service pour voir ses conditions et ses conséquences."))}</p><div class="service-choice-list">${group.ids.map((id) => { const service = SERVICE_BY_ID[id]; const row = forecast.serviceResults.find((item) => item.id === id); const active = planned.services[id].active; const missing = missingRequirements(service, planned); return `<button data-select-service="${id}"><span class="service-choice-name"><strong>${escapeHtml(serviceName(id))}</strong><em class="status-word ${missing.length ? "warn" : "good"}">${escapeHtml(active ? L("Open", "Ouvert") : L("Closed", "Fermé"))}</em></span><span>${escapeHtml(plural(row.demand, L("request", "demande"), L("requests", "demandes")))}</span><span>${money(planned.services[id].price)}</span><span>${escapeHtml(missing.length ? plural(missing.length, L("missing requirement", "condition manquante"), L("missing requirements", "conditions manquantes")) : L("Ready", "Prêt"))}</span><em aria-hidden="true">›</em></button>`; }).join("")}</div>`;
    const service = SERVICE_BY_ID[selectedId];
    const row = forecast.serviceResults.find((item) => item.id === selectedId);
    const active = planned.services[selectedId].active;
    const payload = { kind: "toggle-service", targetId: selectedId, value: !active };
    return `<button class="text-button" data-clear-service>‹ ${escapeHtml(L("Services in this family", "Services de cette famille"))}</button><article class="selected-service"><div class="card-status"><h3>${escapeHtml(serviceName(selectedId))}</h3><span>${escapeHtml(active ? L("Open", "Ouvert") : L("Closed", "Fermé"))}</span></div><div class="service-stats"><div><span>${escapeHtml(L("Expected requests", "Demandes prévues"))}</span><strong>${number(row.demand)}</strong></div><div><span>${escapeHtml(L("Current price", "Prix actuel"))}</span><strong>${money(planned.services[selectedId].price)}</strong></div><div><span>${escapeHtml(L("Money left after direct supplies", "Argent restant après les fournitures directes"))}</span><strong>${money(row.contributionPerCase)}</strong></div><div><span>${escapeHtml(L("Time per case", "Temps par cas"))}</span><strong>${decimal(caseDuration(service, planned), 1)} h</strong></div></div>${(() => { const staffers = planned.staff.filter((person) => roleCompatible(person, service)); const text = staffers.length ? staffers.map((person) => `${person.name} (${roleLabel(person.role).toLowerCase()}${personQualified(person, service) ? "" : `, ${L("needs training", "formation nécessaire")}`})`).join(", ") : L("Nobody on the current team", "Personne dans l’équipe actuelle"); return `<p class="who-can"><strong>${escapeHtml(L("Who can staff this", "Qui peut assurer ce service"))}:</strong> ${escapeHtml(text)}</p>`; })()}${requirementList(service, planned)}${consequencePreview(`service:${selectedId}:active`, payload)}${reviewButton(`service:${selectedId}:active`, payload, active ? L("Review closure", "Examiner la fermeture") : L("Review opening", "Examiner l’ouverture"))}${renderPaceOptions(service, planned)}</article>`;
  }

  function renderPaceOptions(service, planned) {
    const current = planned.services[service.id].pace || "standard";
    const active = planned.services[service.id].active;
    return `<section class="pace-options"><h4>${escapeHtml(L("Pace: time per case", "Rythme : temps par cas"))}</h4>${active ? "" : `<p class="disabled-note">${escapeHtml(L("Open the service first — pace has no effect while it is closed.", "Ouvrez d’abord le service — le rythme n’a aucun effet tant qu’il est fermé."))}</p>`}${Object.entries(D.servicePaces).map(([id, pace]) => `<article class="${id === current ? "current" : ""}"><div><strong>${escapeHtml(itemLabel(pace.name))} · ${decimal(service.duration * pace.duration, 1)} h</strong><p>${escapeHtml(itemLabel(pace.note))}</p></div>${id === current ? `<span class="status-word good">${escapeHtml(t("common.current"))}</span>` : active ? reviewButton(`service:${service.id}:pace`, { kind: "service-pace", targetId: service.id, value: id }, L("Review pace", "Examiner le rythme")) : ""}</article>`).join("")}</section>`;
  }

  function renderDrawerBody(planned, forecast) {
    if (ui.confirm) return renderConfirmation();
    if (ui.drawer === "recruitment") return renderRecruitmentDrawer(planned);
    if (ui.drawer === "plan") {
      const baseline = simulatePlan([]);
      const rows = [[L("End treasury", "Trésorerie finale"), money(baseline.financial.treasury), money(forecast.financial.treasury)], [L("Net result", "Résultat net"), money(baseline.financial.netResult), money(forecast.financial.netResult)], [L("Cases served", "Cas traités"), number(baseline.operational.totalHonored), number(forecast.operational.totalHonored)], [L("Team workload", "Charge de l’équipe"), pct(baseline.operational.staffUse), pct(forecast.operational.staffUse)], [L("Carbon", "Carbone"), tonnes(baseline.carbon.total), tonnes(forecast.carbon.total)]];
      return `<div class="mobile-plan-details"><div class="comparison-list">${rows.map(([label, base, plan]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(base)}</span><em>→ ${escapeHtml(plan)}</em></div>`).join("")}</div><div class="plan-actions">${pendingActions().length ? pendingActions().map((action) => `<div class="plan-action"><span>${escapeHtml(actionLabel(action.payload))}</span><button data-remove-action="${escapeHtml(action.key)}" aria-label="${escapeHtml(t("common.remove"))}">×</button></div>`).join("") : `<p class="empty">${escapeHtml(t("forecast.noActions"))}</p>`}</div><button class="button primary pass-button" data-pass-year>${escapeHtml(t("app.pass"))}</button></div>`;
    }
    if (ui.drawer === "staffPerson") return renderStaffPersonDrawer(planned);
    if (ui.drawer === "staffAllocation") return renderAllocationDrawer(planned, forecast);
    if (ui.drawer === "hoursByService") return renderHoursByService(forecast);
    if (ui.drawer === "capabilities") return renderCapabilitiesDrawer(planned);
    if (ui.drawer === "export") return renderExportDrawer();
    if (ui.drawer === "services") return renderServiceDrawer(planned, forecast);
    if (ui.drawer === "rooms") return `<div class="drawer-cards">${Object.entries(D.rooms).map(([id, room]) => { const qty = planned.rooms[id]; const add = { kind: "room-add", targetId: id }; return `<article class="choice-card"><h3>${escapeHtml(itemLabel(room.name))} · ${qty}</h3><p>${money(room.fitout)} ${escapeHtml(L("once", "une fois"))} · ${money(room.annualRent)}/${escapeHtml(L("year", "an"))}</p>${consequencePreview(`room:${id}`, add)}<div class="button-row">${reviewButton(`room:${id}`, add, L("Review fit-out", "Examiner l’aménagement"))}${qty > room.baseIncluded ? reviewButton(`room:${id}`, { kind: "room-close", targetId: id }, L("Review closure", "Examiner la fermeture")) : ""}</div></article>`; }).join("")}</div>`;
    if (ui.drawer === "equipment") return `<div class="drawer-cards">${Object.entries(D.equipment).map(([id, item]) => { const counts = planned.equipment[id]; const buy = { kind: "equipment-acquire", targetId: id, mode: "buy" }; const lease = { kind: "equipment-acquire", targetId: id, mode: "lease" }; return `<article class="choice-card"><h3>${escapeHtml(itemLabel(item.name))}</h3><p>${escapeHtml(L("Owned", "Acheté"))}: ${counts.owned} · ${escapeHtml(L("Leased", "Loué"))}: ${counts.leased}</p><small>${money(item.purchase)} ${escapeHtml(L("buy once", "achat unique"))} · ${money(item.lease)}/${escapeHtml(L("year lease", "an de location"))}</small><div class="choice-subgrid"><div>${consequencePreview(`equipment:${id}:buy`, buy)}${reviewButton(`equipment:${id}:buy`, buy, L("Review purchase", "Examiner l’achat"))}</div><div>${consequencePreview(`equipment:${id}:lease`, lease)}${reviewButton(`equipment:${id}:lease`, lease, L("Review lease", "Examiner la location"))}</div></div><div class="button-row">${counts.owned ? reviewButton(`equipment:${id}:buy`, { kind: "equipment-remove", targetId: id, mode: "buy" }, L("Sell one", "Vendre une unité")) : ""}${counts.leased ? reviewButton(`equipment:${id}:lease`, { kind: "equipment-remove", targetId: id, mode: "lease" }, L("Return one", "Restituer une unité")) : ""}</div></article>`; }).join("")}</div>`;
    if (ui.drawer === "training") return renderTrainingDrawer(planned);
    if (ui.drawer === "opening") return `<div class="drawer-cards">${Object.entries(D.openingPeriods).map(([id, period]) => { const active = planned.operations.openingPeriods[id]; const payload = { kind: "opening-period", targetId: id, value: !active }; return optionCard(itemLabel(period.name), `${number(period.hours)} ${L("available room/equipment hours; no staff hours added", "heures de salle/équipement disponibles ; aucune heure de personnel ajoutée")}`, `opening:${id}`, payload, `${money(period.cost)}/${L("year", "an")}`); }).join("")}</div>`;
    if (ui.drawer === "dropoff") { const payload = { kind: "dropoff", value: !planned.operations.dropoff }; return optionCard(L("Drop-off workflow", "Parcours de dépôt"), L("Suitable services use 10% less vet time and 10% more support time. Requires two support staff.", "Les services adaptés utilisent 10 % de temps vétérinaire en moins et 10 % de soutien en plus. Deux personnes de soutien sont nécessaires."), "operations:dropoff", payload, `${money(4000)}/${L("year", "an")}`); }
    if (ui.drawer === "stock") return `<div class="drawer-cards">${Object.entries(D.stockStrategies).map(([id, choice]) => { const change = Math.round((choice.multiplier - 1) * 100); const spending = change === 0 ? L("No change in supply spending", "Aucun changement des dépenses de fournitures") : change > 0 ? L(`${change}% more supply spending`, `${change} % de dépenses de fournitures en plus`) : L(`${Math.abs(change)}% less supply spending`, `${Math.abs(change)} % de dépenses de fournitures en moins`); return optionCard(itemLabel(choice.name), spending, "operations:stock", { kind: "stock-strategy", targetId: id }, `${number(choice.supportHours)} ${L("support hours", "heures de soutien")} · ${money(choice.cost)}/${L("year", "an")}`); }).join("")}</div>`;
    if (ui.drawer === "hr") return `<div class="drawer-cards">${Object.entries(D.hrStrategies).map(([id, choice]) => optionCard(itemLabel(choice.name), `${pct(choice.absenteeism)} ${L("expected work time lost to absence", "de temps de travail susceptible d’être perdu pour absence")} · ${L("staff climate", "climat de travail")} ${signed(choice.climate)}`, "hr:strategy", { kind: "hr-strategy", targetId: id }, `${money(choice.cost)}/${L("year", "an")}`)).join("")}</div>`;
    if (ui.drawer === "pricing") return `<p>${escapeHtml(L("Price sensitivity shows how strongly requests may change when the price changes. Only open services are listed: open a service first to price it.", "La sensibilité au prix indique dans quelle mesure les demandes peuvent changer lorsque le prix évolue. Seuls les services ouverts sont listés : ouvrez d’abord un service pour fixer son prix."))}</p><div class="price-editor">${D.services.filter((service) => planned.services[service.id].active).map((service) => { const current = ui.decisionDrafts[`price:${service.id}`] ?? planned.services[service.id].price; return `<article><div><strong>${escapeHtml(serviceName(service.id))}</strong><span>${escapeHtml(L("Price sensitivity", "Sensibilité au prix"))}: ${escapeHtml(priceSensitivity(service.elasticity))}</span><span>${escapeHtml(L("Money left after direct supplies", "Argent restant après les fournitures directes"))}: ${money(current * (1 - service.variableCost))}</span></div><label><span>${escapeHtml(L("Price", "Prix"))}</span><input type="number" min="1" max="5000" value="${current}" data-draft-price="${service.id}" data-draft-key="price:${service.id}"></label><button class="button primary" data-review-price="${service.id}">${escapeHtml(L("Review price", "Examiner le prix"))}</button></article>`; }).join("")}</div>`;
    if (ui.drawer === "finance") { const loan = planned.finance.loan; return loan ? `${optionCard(L("Repay loan early", "Rembourser l’emprunt par anticipation"), `${money(loan.remaining)} ${L("remaining principal", "de capital restant")}`, "finance:loan", { kind: "repay-loan" })}` : `<div class="drawer-cards">${[50000, 100000].map((amount) => optionCard(L("Five-year loan", "Emprunt sur cinq ans"), L("6% interest on remaining principal; one outstanding loan at a time.", "Intérêt de 6 % sur le capital restant ; un seul emprunt à la fois."), "finance:loan", { kind: "loan", value: amount }, money(amount))).join("")}</div>`; }
    if (ui.drawer === "market") return `<div class="drawer-cards">${Object.entries(D.segments).map(([id, segment]) => optionCard(itemLabel(segment.name), `${number(segment.size)} ${L("reachable clients", "clients accessibles")}`, "market:focus", { kind: "market-focus", targetId: id })).join("")}</div>`;
    if (ui.drawer === "location") return `<div class="drawer-cards">${Object.entries(D.locations).map(([id, location]) => optionCard(itemLabel(location.name), itemLabel(location.description), "location:sector", { kind: "location", targetId: id }, `${money(location.rent)}/${L("year", "an")} · ${decimal(location.averageRoundTripKm, 0)} km ${L("average return trip", "aller-retour moyen")}`)).join("")}${optionCard(planned.location.parking ? L("Remove parking", "Supprimer le parking") : L("Add parking", "Ajouter un parking"), L("Parking improves access and some demand, but increases the modelled share of car travel.", "Le parking améliore l’accès et une partie de la demande, mais augmente la part modélisée des déplacements en voiture."), "location:parking", { kind: "parking", value: !planned.location.parking })}</div>`;
    if (ui.drawer === "marketing") {
      if (!ui.drawerContext) return `<div class="drawer-menu">${Object.keys(D.marketingStrategies).map((id) => `<button data-drawer-context="${id}"><strong>${escapeHtml(strategyLabel(id))}</strong><span>${escapeHtml(itemLabel(D.marketingStrategies[id][planned.marketing[id]].name))}</span><em>›</em></button>`).join("")}</div>`;
      return `<button class="text-button" data-drawer-context="">‹ ${escapeHtml(L("Market strategies", "Stratégies de marché"))}</button><div class="drawer-cards">${Object.entries(D.marketingStrategies[ui.drawerContext]).map(([id, choice]) => optionCard(itemLabel(choice.name), `${choice.demand ? signed(choice.demand, "percent") + " " + L("demand", "demande") : L("Demand unchanged", "Demande inchangée")}`, `marketing:${ui.drawerContext}`, { kind: "marketing-strategy", strategy: ui.drawerContext, targetId: id }, `${money(choice.cost)}/${L("year", "an")} · ${number(choice.supportHours || 0)} ${L("support hours", "heures de soutien")}`)).join("")}</div>`;
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

  function drawerTitle() {
    const titles = { plan: L("Current plan", "Plan actuel"), recruitment: L("Post a vacancy", "Publier une offre"), staffPerson: L("Manage pay", "Gérer le salaire"), staffAllocation: L("Change time allocation", "Modifier l’affectation du temps"), hoursByService: L("Hours by service", "Heures par service"), export: L("Export report", "Exporter le rapport"), services: L("Explore services", "Explorer les services"), rooms: L("Manage rooms", "Gérer les salles"), equipment: L("Manage equipment", "Gérer l’équipement"), training: L("Plan training", "Planifier une formation"), capabilities: L("Who can do what", "Qui peut faire quoi"), opening: L("Opening schedule", "Horaires d’ouverture"), dropoff: L("Drop-off workflow", "Parcours de dépôt"), stock: L("Stock strategy", "Stratégie de stock"), hr: L("HR strategy", "Stratégie RH"), pricing: L("Service prices", "Prix des services"), finance: L("Financing", "Financement"), market: L("Market focus", "Marché cible"), location: L("Location and parking", "Implantation et parking"), marketing: L("Market strategies", "Stratégies de marché"), sustainability: L("Transition options", "Options de transition") };
    return titles[ui.drawer] || "";
  }

  function renderDrawer(planned, forecast) {
    if (!ui.drawer) return "";
    return `<div class="drawer-backdrop" data-close-drawer><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-head"><div><span>${escapeHtml(L("Decision workspace", "Espace de décision"))}</span>${ui.confirm ? "" : `<h2 id="drawer-title">${escapeHtml(drawerTitle())}</h2>`}</div><button data-close-drawer aria-label="${escapeHtml(t("app.close"))}">×</button></div><div class="drawer-body">${renderDrawerBody(planned, forecast)}</div></aside></div>`;
  }

  function renderWhyChanged(latest, previous) {
    const top = (entries) => entries.filter(([, value]) => Math.abs(value) >= .05).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
    const points = (value) => `${value > 0 ? "+" : ""}${decimal(value, 1)}`;
    const operating = (f) => (f.fixedCosts || 0) - (f.payroll || 0) - (f.socialCharges || 0) - (f.facilityCosts || 0) - (f.oneTimeCosts || 0);
    const staffCost = (f) => (f.payroll || 0) + (f.socialCharges || 0) + (f.overtimeCost || 0);
    const f = latest.financial;
    const p = previous?.financial;
    const moneyItems = top(p
      ? [[L("Revenue", "Recettes"), f.revenue - p.revenue], [L("Staff costs incl. overtime", "Coûts du personnel, heures sup. comprises"), -(staffCost(f) - staffCost(p))], [L("Facilities", "Installations"), -(f.facilityCosts - p.facilityCosts)], [L("Supplies", "Fournitures"), -(f.variableCosts - p.variableCosts)], [L("Operations", "Opérations"), -(operating(f) - operating(p))], [L("One-time costs", "Coûts ponctuels"), -(f.oneTimeCosts - p.oneTimeCosts)]]
      : [[L("Revenue", "Recettes"), f.revenue], [L("Staff costs incl. overtime", "Coûts du personnel, heures sup. comprises"), -staffCost(f)], [L("Facilities", "Installations"), -f.facilityCosts], [L("Supplies", "Fournitures"), -f.variableCosts], [L("Operations", "Opérations"), -operating(f)], [L("One-time costs", "Coûts ponctuels"), -f.oneTimeCosts]]
    ).map(([label, value]) => [label, signed(value, "money"), value]);
    const caseItems = (p
      ? latest.serviceResults.map((row) => [row, row.honored - (previous.serviceResults.find((item) => item.id === row.id)?.honored || 0)]).filter(([, delta]) => delta).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      : latest.serviceResults.filter((row) => row.active).map((row) => [row, row.honored]).sort((a, b) => b[1] - a[1])
    ).slice(0, 3).map(([row, value]) => [`${serviceName(row.id)} — ${blockerText(row.bottleneck)}`, signed(value), value]);
    const climateLabels = { hr: L("HR strategy", "Stratégie RH"), openingHours: L("Extra opening hours", "Horaires étendus"), pay: L("Pay vs benchmark", "Salaire vs référence"), overtime: L("Overtime", "Heures supplémentaires"), workload: L("Workload level", "Niveau de charge") };
    const trustLabels = { served: L("Share of requests served", "Part des demandes traitées"), communication: L("Client communication", "Communication client"), access: L("Low-carbon access plan", "Plan d’accès bas carbone"), pace: L("Service pace", "Rythme des services") };
    const partItems = (parts, labels) => top(Object.entries(parts || {}).map(([id, value]) => [labels[id] || id, value])).map(([label, value]) => [label, points(value), value]);
    const blocks = [
      [L("Net result", "Résultat net"), money(f.netResult), moneyItems],
      [L("Cases served", "Cas traités"), number(latest.operational.totalHonored), caseItems],
      [L("Staff climate", "Climat de l’équipe"), number(latest.social.after.staffClimate), partItems(latest.social.climateParts, climateLabels)],
      [L("Client trust", "Confiance des clients"), number(latest.social.after.clientTrust), partItems(latest.social.trustParts, trustLabels)]
    ];
    return `<section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("Why each number changed", "Pourquoi chaque indicateur a changé"))}</h2><p>${escapeHtml(p ? L("Largest contributions compared with the previous year.", "Principales contributions par rapport à l’année précédente.") : L("Largest contributions this year.", "Principales contributions cette année."))}</p></div></div><div class="why-grid">${blocks.map(([title, value, items]) => `<article><h3>${escapeHtml(title)}</h3><strong>${escapeHtml(value)}</strong><ul>${items.length ? items.map(([label, shown, raw]) => `<li><span>${escapeHtml(label)}</span><em class="${raw >= 0 ? "good-text" : "bad-text"}">${escapeHtml(shown)}</em></li>`).join("") : `<li><span>${escapeHtml(L("No notable change", "Aucun changement notable"))}</span></li>`}</ul></article>`).join("")}</div></section>`;
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
      { label: L("Financial result", "Résultat financier"), value: money(latest.financial.netResult), good: latest.financial.netResult >= 0 },
      { label: L("Care delivered", "Soins réalisés"), value: `${number(latest.operational.totalHonored)} / ${number(latest.operational.totalDemand)}`, good: latest.operational.honoredRate >= .82 },
      { label: L("Staff climate", "Climat de travail"), value: number(latest.social.after.staffClimate), good: latest.social.after.staffClimate >= latest.social.before.staffClimate },
      { label: L("Carbon footprint", "Empreinte carbone"), value: carbon ? tonnes(carbon.total) : L("Not available for migrated year", "Non disponible pour l’année migrée"), good: carbon ? (!previous?.carbon || carbon.total <= previous.carbon.total) : false }
    ];
    const costDrivers = [
      [L("Payroll and charges", "Salaires et charges"), latest.financial.payroll + latest.financial.socialCharges],
      [L("Facilities", "Installations"), latest.financial.facilityCosts],
      [L("External purchases", "Achats externes"), latest.financial.variableCosts],
      [L("Operations", "Opérations"), latest.financial.openingCosts + latest.financial.dropoffCost + latest.financial.stockCost + latest.financial.hrCost + latest.financial.marketingCost + (latest.financial.sustainabilityCost || 0) + latest.financial.admin],
      [L("One-time investments", "Investissements ponctuels"), latest.financial.oneTimeCosts]
    ].sort((a, b) => b[1] - a[1]);
    const mainCarbon = carbon?.primaryDrivers[0];
    const causeRows = `<article><span>${escapeHtml(L("Main service constraint", "Contrainte principale des services"))}</span><strong>${escapeHtml(blockerText(latest.operational.mainConstraint))}</strong><em>${escapeHtml(L("Explains unmet requests or weak revenue", "Explique les demandes non traitées ou les revenus insuffisants"))}</em></article><article><span>${escapeHtml(L("Largest cost", "Coût principal"))}</span><strong>${escapeHtml(costDrivers[0][0])}: ${money(costDrivers[0][1])}</strong><em>${escapeHtml(L("Largest annual financial pressure", "Principale pression financière annuelle"))}</em></article>${carbon ? `<article><span>${escapeHtml(L("Largest carbon source", "Principale source de carbone"))}</span><strong>${escapeHtml(sourceLabel(mainCarbon))}: ${tonnes(carbon.bySource[mainCarbon])}</strong><em>${escapeHtml(mainCarbon === "building" ? L("Opening hours, rooms, and energy choices", "Horaires, salles et choix énergétiques") : mainCarbon === "clinical" ? L("Anaesthetic use in eligible procedures", "Gaz anesthésiques des actes concernés") : mainCarbon === "waste" ? L("Waste produced by treated cases", "Déchets produits par les cas traités") : L("Client numbers, location, and parking", "Nombre de clients, implantation et parking"))}</em></article>` : ""}`;
    return `<section class="page"><div class="page-heading"><div><h1>${escapeHtml(L("Year results", "Résultats de l’année"))}</h1><p>${escapeHtml(L("See the outcome, identify the causes, then record what the team learned.", "Observez le résultat, identifiez les causes, puis consignez les apprentissages de l’équipe."))}</p></div><strong>${escapeHtml(t("app.year", { year: latest.turn, target: state.rules.targetYear }))}</strong></div>
      <div class="dashboard-grid compact-four">${changes.map((item) => metricCard(item.label, item.value, item.good ? L("Improved or on track", "Amélioration ou objectif atteint") : L("Needs attention", "À surveiller"), item.good ? "good" : "warn")).join("")}</div>
      <section class="card-section"><div class="panel-heading"><div><h2>${escapeHtml(L("What drove the result", "Origine du résultat"))}</h2><p>${escapeHtml(L("Largest modelled contributors—not a judgement about the choices.", "Principales contributions modélisées — sans jugement sur les choix."))}</p></div></div><div class="cause-list">${causeRows}</div><h3>${escapeHtml(L("Actions taken", "Actions réalisées"))}</h3><div class="chips">${latest.actions?.length ? latest.actions.map((action) => `<span class="chip">${escapeHtml(actionLabel(action))}</span>`).join("") : `<span class="chip">${escapeHtml(t("results.noAction"))}</span>`}</div>${latest.recruitment?.length ? `<div class="recruitment-results">${latest.recruitment.map((row) => `<p class="${row.accepted ? "good-text" : "bad-text"}">${escapeHtml(candidateById(row.candidateId)?.name || row.candidateId)}: ${escapeHtml(row.accepted ? t("staff.accepted") : t("staff.refused"))}</p>`).join("")}</div>` : ""}</section>
      ${renderWhyChanged(latest, previous)}
      <section class="card-section reflection-step"><div class="panel-heading"><div><h2>${escapeHtml(L("Team reflection", "Réflexion de l’équipe"))}</h2><p>${ui.reflectionStep + 1}/${fields.length}</p></div></div><label><span>${escapeHtml(t(`results.${field}`))}</span><textarea data-reflection="${field}" data-year="${latest.turn}">${escapeHtml(reflection[field] || "")}</textarea></label><div class="button-row"><button class="button secondary" data-reflection-prev ${ui.reflectionStep === 0 ? "disabled" : ""}>‹ ${escapeHtml(L("Previous", "Précédent"))}</button><button class="button primary" data-save-reflection="${latest.turn}">${escapeHtml(t("results.saveReflection"))}</button><button class="button secondary" data-reflection-next ${ui.reflectionStep === fields.length - 1 ? "disabled" : ""}>${escapeHtml(L("Next", "Suivant"))} ›</button></div></section>
      <section class="card-section"><div class="panel-heading"><h2>${escapeHtml(L("Earlier years", "Années précédentes"))}</h2></div><div class="history-accordions">${state.history.slice().reverse().map((report) => `<details ${report.turn === latest.turn ? "open" : ""}><summary><strong>${escapeHtml(t("app.year", { year: report.turn, target: state.rules.targetYear }))}</strong><span>${money(report.financial.netResult)} · ${number(report.operational.totalHonored)} ${escapeHtml(t("common.cases"))}${report.carbon ? ` · ${tonnes(report.carbon.total)}` : ""}</span></summary><p>${escapeHtml(blockerText(report.operational.mainConstraint))}</p></details>`).join("")}</div></section>
    </section>`;
  }

  function renderHelp() {
    if (!state.helpOpen) return "";
    const sections = ["requests", "actions", "forecast", "goals", "costs", "sustainability", "reflection"];
    return `<div class="modal-backdrop"><section class="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="modal-head"><h2 id="help-title">${escapeHtml(t("help.title"))}</h2><button data-close-help aria-label="${escapeHtml(t("app.close"))}">×</button></div><p class="lead">${escapeHtml(t("help.intro"))}</p><article class="help-example"><h3>${escapeHtml(L("A first-turn example", "Exemple de premier tour"))}</h3><ol><li>${escapeHtml(L("The overview says the clinic is losing money and that much team time is unused.", "La vue d’ensemble indique que la clinique perd de l’argent et qu’une grande partie du temps de l’équipe est inutilisée."))}</li><li>${escapeHtml(L("You explore a compatible service and read its five consequences.", "Vous explorez un service compatible et lisez ses cinq conséquences."))}</li><li>${escapeHtml(L("You add it to the plan only if the trade-off makes sense. Looking and cancelling cost no action.", "Vous ne l’ajoutez au plan que si le compromis vous convient. Consulter et annuler ne coûte aucune action."))}</li></ol><button class="button secondary" data-reopen-guide>${escapeHtml(L("Show the Year 1 guide", "Afficher le guide de l’année 1"))}</button></article>${sections.map((id) => `<article><h3>${escapeHtml(t(`help.${id}Title`))}</h3><p>${escapeHtml(t(`help.${id}Text`))}</p></article>`).join("")}<article><h3>${escapeHtml(L("Short glossary", "Petit glossaire"))}</h3><dl class="help-glossary"><div><dt>${escapeHtml(L("Requests", "Demandes"))}</dt><dd>${escapeHtml(L("Potential cases from clients this year.", "Cas potentiels demandés par les clients cette année."))}</dd></div><div><dt>${escapeHtml(L("Cases served", "Cas traités"))}</dt><dd>${escapeHtml(L("Requests the clinic has enough people, rooms, equipment, and skills to complete.", "Demandes que la clinique peut traiter avec son équipe, ses salles, son équipement et ses compétences."))}</dd></div><div><dt>${escapeHtml(L("Net result", "Résultat net"))}</dt><dd>${escapeHtml(L("Annual income minus all annual and one-time costs.", "Recettes annuelles moins tous les coûts annuels et ponctuels."))}</dd></div><div><dt>${escapeHtml(L("Ready vs staffed", "Prêt ou doté en personnel"))}</dt><dd>${escapeHtml(L("A service is ready when its rooms, equipment, and skills exist. It only serves cases when someone is also assigned to it.", "Un service est prêt quand ses salles, équipements et compétences existent. Il ne traite des cas que si quelqu’un y est aussi affecté."))}</dd></div><div><dt>${escapeHtml(L("Overtime and idle time", "Heures supplémentaires et temps inoccupé"))}</dt><dd>${escapeHtml(L("Assigning more than 100% of a person’s hours creates paid overtime (up to 130%) that lowers staff climate; less than 100% leaves paid idle time.", "Affecter plus de 100 % des heures d’une personne crée des heures supplémentaires payées (jusqu’à 130 %) qui dégradent le climat ; moins de 100 % laisse du temps payé inoccupé."))}</dd></div><div><dt>${escapeHtml(L("Shared rooms", "Salles partagées"))}</dt><dd>${escapeHtml(L("When a room or machine is full, every service using it loses the same share of cases.", "Quand une salle ou un appareil est saturé, chaque service qui l’utilise perd la même part de cas."))}</dd></div><div><dt>${escapeHtml(L("Vets covering support work", "Vétérinaires en soutien"))}</dt><dd>${escapeHtml(L("Vets can do the support part of any service, but a vet hour costs more than a support hour.", "Les vétérinaires peuvent assurer la partie soutien de tout service, mais une heure vétérinaire coûte plus cher."))}</dd></div><div><dt>${escapeHtml(L("Carbon per treated case", "Carbone par cas traité"))}</dt><dd>${escapeHtml(L("The clinic’s modelled footprint divided by completed cases.", "L’empreinte modélisée de la clinique divisée par les cas traités."))}</dd></div></dl></article><button class="button primary" data-close-help>${escapeHtml(t("app.close"))}</button></section></div>`;
  }

  function renderEndModal() {
    if (!state.endState) return "";
    const latest = state.history.find((report) => report.turn === state.endState.reportTurn) || state.history[state.history.length - 1];
    const goals = goalChecks(latest, state);
    const passed = goals.filter((goal) => goal.ok).length;
    const failed = state.endState.type === "failure";
    return `<div class="modal-backdrop"><section class="modal end-modal" role="dialog" aria-modal="true" aria-labelledby="end-title"><div class="end-symbol ${failed ? "bad" : "good"}" aria-hidden="true">${failed ? "!" : "✓"}</div><h2 id="end-title">${escapeHtml(t(failed ? "end.failureTitle" : "end.successTitle"))}</h2><p>${escapeHtml(t(failed ? "end.failureText" : "end.successText"))}</p><strong>${escapeHtml(t("end.score", { passed, total: goals.length }))}</strong><div class="goal-summary">${goals.map((goal) => `<span class="${goal.ok ? "good" : "bad"}">${goal.ok ? "✓" : "○"} ${escapeHtml(itemLabel(goal.label))}</span>`).join("")}</div><div class="button-row"><button class="button primary" data-continue>${escapeHtml(t("app.continue"))}</button><button class="button secondary" data-export>${escapeHtml(t("app.export"))}</button><button class="button danger" data-reset>${escapeHtml(t("app.restart"))}</button></div></section></div>`;
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
    document.querySelector("#app").innerHTML = `${renderHeader(planned)}${renderNav()}<div class="workspace"><main class="content">${renderDomain(planned, forecast)}</main>${renderPlanPanel(baseline, forecast)}</div>${renderHelp()}${renderEndModal()}${renderDrawer(planned, forecast)}`;
    const drawer = document.querySelector(".drawer");
    if (drawer && ui.restore) {
      const restore = ui.restore;
      ui.restore = null;
      window.setTimeout(() => {
        const body = drawer.querySelector(".drawer-body");
        if (body) body.scrollTop = restore.scrollTop;
        if (restore.selector) drawer.querySelector(restore.selector)?.focus();
      }, 0);
    } else if (drawer && ui.autoFocusDrawer) {
      ui.autoFocusDrawer = false;
      window.setTimeout(() => drawer.querySelector("button, input, select, textarea")?.focus(), 0);
    }
  }

  function saveVisibleReflection() {
    document.querySelectorAll("[data-reflection][data-year]").forEach((node) => {
      const year = node.dataset.year;
      state.reflections[year] = { ...(state.reflections[year] || {}), [node.dataset.reflection]: node.value };
    });
    saveState();
  }

  function syncPlayerTeam() {
    const teamName = document.querySelector("[data-team-name]");
    const participantNames = document.querySelector("[data-participant-names]");
    if (teamName) state.playerTeam.teamName = teamName.value.trim();
    if (participantNames) state.playerTeam.participantNames = participantNames.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).slice(0, 20);
    saveState();
  }

  function buildExportPayload() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      locale: locale(),
      scenario: { id: state.scenarioId, label: itemLabel(D.scenarios[state.scenarioId].name) },
      rules: clone(state.rules),
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
    const participants = state.playerTeam.participantNames.length ? state.playerTeam.participantNames.join(", ") : L("Not provided", "Non renseignés");
    const start = initialState(state.scenarioId, state.language);
    const goals = state.history.length ? goalChecks(state.history[state.history.length - 1], state) : [];
    const reflectionFields = ["rationale", "expected", "observed", "surprise", "uncertainty"];
    const yearSections = state.history.map((report, reportIndex) => {
      const staffRows = report.operational.staffRows || [];
      const hourRows = report.operational.serviceHourRows || [];
      const reflection = state.reflections[report.turn] || {};
      const snapshotStaff = report.clinicSnapshot?.staff || [];
      const staffTable = staffRows.length ? reportTable([L("Person", "Personne"), L("Available", "Disponibles"), L("Assigned", "Affecté"), L("Used", "Utilisées"), L("Overtime", "Heures sup."), L("Idle", "Inoccupées"), L("Unused", "Inutilisées"), L("Blocked", "Bloquées"), L("Workload", "Charge"), L("Allocations", "Affectations")], staffRows.map((row) => { const person = snapshotStaff.find((item) => item.id === row.id); return [escapeHtml(person?.name || row.id), number(row.availableHours), pct(row.assignedShare ?? 1), number(row.usedHours), number(row.overtimeHours || 0), number(row.idleHours || 0), number(row.unusedHours), number(row.blockedHours), pct(row.workload), escapeHtml((row.assignments || []).map((assignment) => `${serviceName(assignment.serviceId)} ${Math.round(assignment.share * 100)}%`).join(" · "))]; })) : `<p class="notice">${escapeHtml(L("Detailed staff allocation was not recorded for this migrated year.", "L’affectation détaillée du personnel n’a pas été enregistrée pour cette année migrée."))}</p>`;
      const serviceRows = report.serviceResults || [];
      const services = serviceRows.length ? reportTable([L("Service", "Service"), L("Requests", "Demandes"), L("Served", "Traités"), L("Price", "Prix"), L("Revenue", "Recettes"), L("Direct costs", "Coûts directs"), L("Blocker", "Blocage")], serviceRows.filter((row) => row.active).map((row) => [escapeHtml(serviceName(row.id)), number(row.demand), number(row.honored), money(row.price), money(row.revenue), money(row.variableCosts), escapeHtml(blockerText(row.bottleneck))])) : `<p class="notice">${escapeHtml(L("Detailed service results were not recorded for this migrated year.", "Les résultats détaillés des services n’ont pas été enregistrés pour cette année migrée."))}</p>`;
      const hours = hourRows.length ? reportTable([L("Service", "Service"), L("Role", "Fonction"), L("Assigned", "Affectées"), L("Needed", "Nécessaires"), L("Used", "Utilisées"), L("Shortage", "Manque")], hourRows.map((row) => [escapeHtml(serviceName(row.serviceId)), escapeHtml(row.role === "vet" ? L("Veterinarian", "Vétérinaire") : L("Support", "Soutien")), number(row.assignedHours), number(row.neededHours), number(row.usedHours), number(row.shortageHours)])) : "";
      const actions = (report.actions || []).length ? `<ul>${report.actions.map((action) => `<li>${escapeHtml(actionLabel(action))}</li>`).join("")}</ul>` : `<p>${escapeHtml(L("No action", "Aucune action"))}</p>`;
      const carbon = report.carbon ? `<div class="summary-grid"><p><span>${escapeHtml(L("Total footprint", "Empreinte totale"))}</span><strong>${tonnes(report.carbon.total)}</strong></p><p><span>${escapeHtml(L("Per treated case", "Par cas traité"))}</span><strong>${kilograms(report.carbon.perCase)}</strong></p>${Object.entries(report.carbon.bySource).map(([id, value]) => `<p><span>${escapeHtml(sourceLabel(id))}</span><strong>${tonnes(value)}</strong></p>`).join("")}</div>` : `<p>${escapeHtml(L("Carbon detail unavailable for this migrated year.", "Détail carbone indisponible pour cette année migrée."))}</p>`;
      const hasHourTotals = Number.isFinite(report.operational.startVetHours) && Number.isFinite(report.operational.startSupportHours);
      const previousCarbon = reportIndex ? state.history[reportIndex - 1].carbon?.total : state.carbonBaseline?.total;
      const carbonChange = report.carbon && Number.isFinite(previousCarbon) ? report.carbon.total - previousCarbon : null;
      return `<section class="year"><h2>${escapeHtml(L("Year", "Année"))} ${report.turn}</h2><div class="summary-grid"><p><span>${escapeHtml(L("Revenue", "Recettes"))}</span><strong>${money(report.financial.revenue)}</strong></p><p><span>${escapeHtml(L("Direct costs", "Coûts directs"))}</span><strong>${money(report.financial.variableCosts)}</strong></p><p><span>${escapeHtml(L("Payroll and charges", "Salaires et charges"))}</span><strong>${money((report.financial.payroll || 0) + (report.financial.socialCharges || 0))}</strong></p><p><span>${escapeHtml(L("Overtime pay and charges", "Heures supplémentaires et charges"))}</span><strong>${money(report.financial.overtimeCost || 0)}</strong></p><p><span>${escapeHtml(L("Facilities", "Installations"))}</span><strong>${money(report.financial.facilityCosts)}</strong></p><p><span>${escapeHtml(L("Operating costs", "Coûts d’exploitation"))}</span><strong>${money((report.financial.openingCosts || 0) + (report.financial.dropoffCost || 0) + (report.financial.stockCost || 0) + (report.financial.hrCost || 0) + (report.financial.marketingCost || 0) + (report.financial.sustainabilityCost || 0) + (report.financial.admin || 0))}</strong></p><p><span>${escapeHtml(L("One-time costs", "Coûts ponctuels"))}</span><strong>${money(report.financial.oneTimeCosts)}</strong></p><p><span>${escapeHtml(L("Tax", "Impôt"))}</span><strong>${money(report.financial.tax)}</strong></p><p><span>${escapeHtml(L("Net result", "Résultat net"))}</span><strong>${money(report.financial.netResult)}</strong></p><p><span>${escapeHtml(L("Closing treasury", "Trésorerie de clôture"))}</span><strong>${money(report.financial.treasury)}</strong></p></div><h3>${escapeHtml(L("Actions and recruitment", "Actions et recrutement"))}</h3>${actions}${(report.recruitment || []).map((row) => `<p>${escapeHtml(candidateById(row.candidateId)?.name || row.candidateId)} — ${escapeHtml(row.accepted ? L("accepted", "accepté") : L("refused", "refusé"))}</p>`).join("")}<h3>${escapeHtml(L("Services", "Services"))}</h3>${services}<h3>${escapeHtml(L("Staff hours", "Heures du personnel"))}</h3>${hasHourTotals ? `<p>${escapeHtml(L("Veterinary hours available / used", "Heures vétérinaires disponibles / utilisées"))}: ${number(report.operational.startVetHours)} / ${number(report.operational.startVetHours - report.operational.remainingVetHours)} · ${escapeHtml(L("Support hours available / used", "Heures de soutien disponibles / utilisées"))}: ${number(report.operational.startSupportHours)} / ${number(report.operational.startSupportHours - report.operational.remainingSupportHours)}</p>` : `<p class="notice">${escapeHtml(L("Detailed hour totals were not recorded for this migrated year.", "Les totaux d’heures détaillés n’ont pas été enregistrés pour cette année migrée."))}</p>`}${staffTable}${hours}<h3>${escapeHtml(L("People and clients", "Équipe et clients"))}</h3><p>${escapeHtml(L("Staff climate", "Climat de l’équipe"))}: ${number(report.social?.after?.staffClimate || 0)} · ${escapeHtml(L("Client trust", "Confiance des clients"))}: ${number(report.social?.after?.clientTrust || 0)}</p><h3>${escapeHtml(L("Carbon footprint", "Empreinte carbone"))}</h3>${carbon}${carbonChange === null ? "" : `<p><strong>${escapeHtml(L("Annual change", "Évolution annuelle"))}:</strong> ${carbonChange > 0 ? "+" : ""}${tonnes(carbonChange)}</p>`}<h3>${escapeHtml(L("Team reflections", "Réflexions de l’équipe"))}</h3>${reflectionFields.map((field) => `<div class="reflection"><strong>${escapeHtml(t(`results.${field}`))}</strong><p>${escapeHtml(reflection[field] || L("No response", "Aucune réponse"))}</p></div>`).join("")}</section>`;
    }).join("");
    return `<!doctype html><html lang="${state.language}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;color:#17201d;margin:32px;line-height:1.4}header{border-bottom:3px solid #146c5a;margin-bottom:24px}.print{position:fixed;right:24px;top:18px;padding:10px 16px}.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.summary-grid p{border:1px solid #ccd8d4;padding:10px;margin:0}.summary-grid span{display:block;font-size:12px}.summary-grid strong{font-size:16px}table{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:12px}th,td{text-align:left;border:1px solid #ccd8d4;padding:7px;vertical-align:top}th{background:#eef5f2}.year{break-before:page}.reflection{border-left:3px solid #7c9f96;padding-left:12px}.notice{font-style:italic}@media(max-width:700px){.summary-grid{grid-template-columns:1fr}table{font-size:10px}}@media print{body{margin:10mm}.print{display:none}.year:first-of-type{break-before:auto}}</style></head><body><button class="print" onclick="window.print()">${escapeHtml(L("Print / Save as PDF", "Imprimer / Enregistrer en PDF"))}</button><header><h1>${escapeHtml(title)}</h1><p><strong>${escapeHtml(L("Scenario", "Scénario"))}:</strong> ${escapeHtml(itemLabel(D.scenarios[state.scenarioId].name))}<br><strong>${escapeHtml(L("Team", "Équipe"))}:</strong> ${escapeHtml(state.playerTeam.teamName || L("Not provided", "Non renseignée"))}<br><strong>${escapeHtml(L("Participants", "Participants"))}:</strong> ${escapeHtml(participants)}<br><strong>${escapeHtml(L("Exported", "Exporté"))}:</strong> ${escapeHtml(new Intl.DateTimeFormat(locale(), { dateStyle: "long", timeStyle: "short" }).format(new Date()))}</p></header><section><h2>${escapeHtml(L("Rules and goals", "Règles et objectifs"))}</h2><p>${escapeHtml(L("Action limit", "Limite d’actions"))}: ${escapeHtml(state.rules.unlimited ? L("Unlimited", "Illimitée") : state.rules.actionLimit)} · ${escapeHtml(L("Target year", "Année cible"))}: ${state.rules.targetYear} · ${escapeHtml(L("Bankruptcy threshold", "Seuil de faillite"))}: ${money(state.rules.bankruptcyThreshold)}</p><ul>${goals.map((goal) => `<li>${goal.ok ? "✓" : "○"} ${escapeHtml(itemLabel(goal.label))}: ${escapeHtml(goal.display)}</li>`).join("")}</ul><h2>${escapeHtml(L("Starting versus current clinic", "Clinique de départ et actuelle"))}</h2>${reportTable([L("Measure", "Mesure"), L("Starting", "Départ"), L("Current", "Actuel")], [[escapeHtml(L("Treasury", "Trésorerie")), money(start.treasury), money(state.treasury)], [escapeHtml(L("Clients", "Clients")), number(start.clients), number(state.clients)], [escapeHtml(L("Reputation", "Réputation")), number(start.reputation), number(state.reputation)], [escapeHtml(L("Staff", "Personnel")), number(start.staff.length), number(state.staff.length)], [escapeHtml(L("Active services", "Services actifs")), number(Object.values(start.services).filter((service) => service.active).length), number(Object.values(state.services).filter((service) => service.active).length)], [escapeHtml(L("Carbon footprint", "Empreinte carbone")), state.carbonBaseline ? tonnes(state.carbonBaseline.total) : "—", state.history.at(-1)?.carbon ? tonnes(state.history.at(-1).carbon.total) : "—"]])}</section>${yearSections || `<p>${escapeHtml(L("No completed year yet.", "Aucune année terminée."))}</p>`}<footer><p>${escapeHtml(L("Carbon method", "Méthode carbone"))}: ${escapeHtml(D.carbonModel.version)}. ${escapeHtml(L("Boundary: building electricity and heating, anaesthetic gases, waste treatment, and client car travel. Service activity values are simulation assumptions.", "Périmètre : électricité et chauffage du bâtiment, gaz anesthésiques, traitement des déchets et déplacements automobiles des clients. Les valeurs d’activité des services sont des hypothèses de simulation."))}</p></footer></body></html>`;
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
    state = initialState(scenarioId, language);
    ui.allocationDrafts = {};
    ui.decisionDrafts = {};
    ui.settingsDraft = null;
    ui.settingsOpen = false;
    ui.settingsError = "";
    saveState();
    render();
  }

  document.addEventListener("click", (event) => {
    if (event.target.classList?.contains("drawer-backdrop")) {
      const focus = ui.lastFocus;
      ui.drawer = null; ui.drawerContext = null; ui.selectedServiceId = null; ui.confirm = null;
      render();
      window.setTimeout(() => {
        if (!focus) return;
        const selector = `[data-open-drawer="${CSS.escape(focus.drawer)}"]${focus.context ? `[data-context="${CSS.escape(focus.context)}"]` : ""}`;
        document.querySelector(selector)?.focus();
      }, 0);
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.domain) { saveVisibleReflection(); state.domain = button.dataset.domain; ui.drawer = null; ui.confirm = null; saveState(); render(); return; }
    if (button.dataset.openDrawer) {
      saveVisibleReflection();
      ui.lastFocus = { drawer: button.dataset.openDrawer, context: button.dataset.context || "" };
      ui.drawer = button.dataset.openDrawer;
      ui.drawerContext = button.dataset.context || null;
      ui.selectedServiceId = button.dataset.service || null;
      ui.drawerStep = 1;
      ui.confirm = null;
      ui.candidateLimit = 4;
      ui.autoFocusDrawer = true;
      render();
      announce(drawerTitle());
      return;
    }
    if (button.dataset.closeDrawer !== undefined) {
      const focus = ui.lastFocus;
      ui.drawer = null; ui.drawerContext = null; ui.selectedServiceId = null; ui.confirm = null;
      render();
      window.setTimeout(() => {
        if (!focus) return;
        const selector = `[data-open-drawer="${CSS.escape(focus.drawer)}"]${focus.context ? `[data-context="${CSS.escape(focus.context)}"]` : ""}`;
        document.querySelector(selector)?.focus();
      }, 0);
      return;
    }
    if (button.dataset.drawerContext !== undefined) { ui.drawerContext = button.dataset.drawerContext || null; ui.selectedServiceId = null; ui.confirm = null; render(); return; }
    if (button.dataset.selectService) { ui.selectedServiceId = button.dataset.selectService; render(); return; }
    if (button.dataset.clearService !== undefined) { ui.selectedServiceId = null; render(); return; }
    if (button.dataset.dismissGuide !== undefined) { state.uiPreferences.beginnerGuideDismissed = true; ui.reopenBeginnerGuide = false; saveState(); render(); return; }
    if (button.dataset.reopenGuide !== undefined) { ui.reopenBeginnerGuide = true; state.helpOpen = false; state.domain = "overview"; saveState(); render(); return; }
    if (button.dataset.reviewKey) {
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-key="${CSS.escape(button.dataset.reviewKey)}"]` };
      ui.confirm = { key: button.dataset.reviewKey, payload: JSON.parse(decodeURIComponent(button.dataset.reviewPayload)) };
      render();
      return;
    }
    if (button.dataset.cancelReview !== undefined) { ui.confirm = null; ui.restore = ui.returnFocus; render(); return; }
    if (button.dataset.confirmReview !== undefined && ui.confirm) {
      const { key, payload } = ui.confirm;
      if (!state.pending[key] && pendingActions().length >= actionLimit()) {
        toast(`${t("forecast.limitReached")} ${t("forecast.removeHint")}`, "warn");
        return;
      }
      if (payload.kind === "staff-allocation") ui.allocationDrafts[payload.targetId] = clone(payload.value.allocations);
      ui.confirm = null;
      ui.restore = ui.returnFocus;
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
      render(); return;
    }
    if (button.dataset.saveSettings !== undefined) {
      const draft = ui.settingsDraft || {};
      const unlimited = draft.actionLimit === "unlimited";
      const limit = unlimited ? state.rules.actionLimit : Number(draft.actionLimit);
      const targetYear = Number(draft.targetYear);
      const threshold = Number(draft.bankruptcyThreshold);
      if (!unlimited && limit < pendingActions().length) ui.settingsError = L(`The limit cannot be below the ${pendingActions().length} actions already planned.`, `La limite ne peut pas être inférieure aux ${pendingActions().length} actions déjà planifiées.`);
      else if (!Number.isInteger(targetYear) || targetYear < state.year || targetYear > 12) ui.settingsError = L(`Choose a target year from Year ${state.year} to Year 12.`, `Choisissez une année cible entre l’année ${state.year} et l’année 12.`);
      else if (!Number.isFinite(threshold) || threshold < -1000000 || threshold > 0) ui.settingsError = L("Choose a bankruptcy threshold between −€1,000,000 and €0.", "Choisissez un seuil de faillite entre −1 000 000 € et 0 €.");
      else {
        state.rules = { ...state.rules, unlimited, actionLimit: clamp(limit, 1, 12), targetYear, bankruptcyThreshold: threshold };
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
      const offeredSalary = Number(document.querySelector(`[data-applicant-offer="${CSS.escape(candidate.id)}"]`)?.value || 0);
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-hire="${CSS.escape(candidate.id)}"]` };
      ui.confirm = { key: `hire:${candidate.id}`, payload: { kind: "hire", targetId: candidate.id, value: { role: ui.vacancy.role, desiredSkills: ui.vacancy.skills, salaryBudget: ui.vacancy.budget, offeredSalary } } };
      render();
      return;
    }
    if (button.dataset.reviewSalary) {
      const offered = Number(document.querySelector("[data-draft-salary]")?.value || 0);
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-salary="${CSS.escape(button.dataset.reviewSalary)}"]` };
      ui.confirm = { key: `salary:${button.dataset.reviewSalary}`, payload: { kind: "salary", targetId: button.dataset.reviewSalary, value: offered } };
      render();
      return;
    }
    if (button.dataset.reviewPrice) {
      const id = button.dataset.reviewPrice;
      const value = Number(document.querySelector(`[data-draft-price="${CSS.escape(id)}"]`)?.value || 0);
      const body = document.querySelector(".drawer-body");
      ui.returnFocus = { scrollTop: body?.scrollTop || 0, selector: `[data-review-price="${CSS.escape(id)}"]` };
      ui.confirm = { key: `service:${id}:price`, payload: { kind: "price", targetId: id, value } };
      render();
      return;
    }
    if (button.dataset.reflectionPrev !== undefined) { saveVisibleReflection(); ui.reflectionStep = Math.max(0, ui.reflectionStep - 1); render(); return; }
    if (button.dataset.reflectionNext !== undefined) { saveVisibleReflection(); ui.reflectionStep = Math.min(4, ui.reflectionStep + 1); render(); return; }
    if (button.dataset.language) { saveVisibleReflection(); syncPlayerTeam(); state.language = button.dataset.language; saveState(); render(); toast(t("toast.languageChanged")); return; }
    if (button.dataset.help !== undefined) { state.helpOpen = true; saveState(); render(); return; }
    if (button.dataset.closeHelp !== undefined) { state.helpOpen = false; saveState(); render(); return; }
    if (button.dataset.removeAction) { removeAction(button.dataset.removeAction); return; }
    if (button.dataset.passYear !== undefined) { saveVisibleReflection(); resolveTurn(); return; }
    if (button.dataset.export !== undefined) { saveVisibleReflection(); ui.lastFocus = { drawer: "export", context: "" }; ui.drawer = "export"; ui.drawerContext = null; ui.confirm = null; ui.autoFocusDrawer = true; render(); return; }
    if (button.dataset.downloadJson !== undefined) { downloadJson(); return; }
    if (button.dataset.printReport !== undefined) { printReport(); return; }
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
    if (input.dataset.teamName !== undefined) { state.playerTeam.teamName = input.value; saveState(); return; }
    if (input.dataset.participantNames !== undefined) { state.playerTeam.participantNames = input.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).slice(0, 20); saveState(); }
  });

  document.addEventListener("toggle", (event) => {
    if (event.target.matches?.("[data-settings]")) ui.settingsOpen = event.target.open;
  }, true);

  window.addEventListener?.("pagehide", () => { saveVisibleReflection(); syncPlayerTeam(); });

  document.addEventListener("keydown", (event) => {
    const drawer = document.querySelector(".drawer");
    if (!drawer) return;
    if (event.key === "Escape") {
      event.preventDefault();
      const focus = ui.lastFocus;
      ui.drawer = null; ui.drawerContext = null; ui.confirm = null;
      render();
      window.setTimeout(() => {
        if (!focus) return;
        const selector = `[data-open-drawer="${CSS.escape(focus.drawer)}"]${focus.context ? `[data-context="${CSS.escape(focus.context)}"]` : ""}`;
        document.querySelector(selector)?.focus();
      }, 0);
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

  globalThis.ClinicTest = { initialState, hydrate, applyAction, simulateYear, simulatePlan, calculateCarbon, missingRequirements, projectedDemand, actionLabel, goalChecks, getBeginnerSignals, emptyEffects, combineEffects, clone, validAllocations, buildExportPayload, buildPrintableReportHtml, data: D, getState: () => clone(state), renderState: (next) => { state = hydrate(next); ui.selectedServiceId = null; ui.settingsDraft = null; render(); return document.querySelector("#app").innerHTML; }, renderUiForTest: (changes) => { ui = { ...ui, ...changes }; render(); return document.querySelector("#app").innerHTML; } };
  render();
})();
