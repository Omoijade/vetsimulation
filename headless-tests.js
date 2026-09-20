"use strict";

const fs = require("fs");

const resultItems = [];
const elements = {
  "#app": { innerHTML: "" },
  "#announcer": null,
  "#results": { appendChild: (item) => resultItems.push(item) },
  "#summary": { textContent: "" },
  ".drawer": null
};

Object.defineProperty(globalThis, "navigator", { value: { language: "en-GB" }, configurable: true });
globalThis.window = globalThis;
globalThis.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
globalThis.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); }
};
globalThis.document = {
  documentElement: { lang: "en" },
  title: "",
  body: { appendChild() {} },
  addEventListener() {},
  querySelector(selector) { return elements[selector] || null; },
  querySelectorAll() { return []; },
  createElement() { return { className: "", textContent: "", style: {}, setAttribute() {}, appendChild() {}, remove() {} }; }
};

require("./i18n.js");
require("./data.js");
require("./app.js");
const initialHtml = elements["#app"].innerHTML;
const initialNav = initialHtml.match(/<nav class="domain-nav[\s\S]*?<\/nav>/)?.[0] || "";
if ((initialNav.match(/data-domain=/g) || []).length !== 6) throw new Error("Expected six primary work areas");
if (!initialHtml.includes("Carbon footprint")) throw new Error("Overview does not expose the carbon dimension");
if (!initialHtml.includes("Income does not cover annual costs") || !initialHtml.includes("paid time is unused")) throw new Error("Balanced startup lacks causal beginner signals");
if (!initialHtml.includes("Your first turn")) throw new Error("Year 1 guide is not visible by default");
if (!initialHtml.includes("hours go to closed services") || !initialHtml.includes('data-service="vaccination"')) throw new Error("Overview does not point at Maya's wasted hours with a direct fix");
if (!initialHtml.includes("Investigate Vaccination")) throw new Error("Signals should point at the problem rather than hand over the answer");
if (initialHtml.includes("Dr Leo Martin")) throw new Error("Candidate details must remain hidden before vacancy criteria are submitted");
const frenchState = ClinicTest.getState();
frenchState.language = "fr";
const frenchHtml = ClinicTest.renderState(frenchState);
if (!frenchHtml.includes("Empreinte carbone")) throw new Error("French overview does not translate the carbon dimension");
const frenchNav = frenchHtml.match(/<nav class="domain-nav[\s\S]*?<\/nav>/)?.[0] || "";
if ((frenchNav.match(/data-domain=/g) || []).length !== 6) throw new Error("French view lost a primary work area");
if (!frenchHtml.includes("Votre premier tour")) throw new Error("French beginner guide is incomplete");
frenchState.language = "en";
frenchState.domain = "sustainability";
const methodologyHtml = ClinicTest.renderState(frenchState);
if (!methodologyHtml.includes("0.00468568")) throw new Error("Methodology rounds small carbon factors to zero");
if (!methodologyHtml.includes("Simulation assumptions")) throw new Error("Methodology does not separate assumptions from conversion factors");
const vacancyStepOne = ClinicTest.renderUiForTest({ drawer: "recruitment", drawerStep: 1, confirm: null });
if (vacancyStepOne.includes("Dr Leo Martin")) throw new Error("Vacancy step one exposed candidate data");
if (!vacancyStepOne.includes("General practice") || vacancyStepOne.includes("Animal care")) throw new Error("Veterinarian vacancy shows role-irrelevant skills");
const supportVacancy = ClinicTest.renderUiForTest({ drawer: "recruitment", drawerStep: 1, vacancy: { role: "support", skills: [], budget: 40000 }, confirm: null });
if (!supportVacancy.includes("Animal care") || supportVacancy.includes("Orthopedic surgery")) throw new Error("Support vacancy shows role-irrelevant skills");
const vacancyStepTwo = ClinicTest.renderUiForTest({ drawer: "recruitment", drawerStep: 2, vacancy: { role: "vet", skills: ["general"], budget: 60000 }, confirm: null });
if (!vacancyStepTwo.includes("Dr Leo Martin")) throw new Error("Matching applicant was not revealed after vacancy criteria");
const careState = ClinicTest.getState();
careState.domain = "care";
if (!ClinicTest.renderState(careState).includes("Rooms &amp; equipment use")) throw new Error("Care page does not show room and equipment use");
const roomsHtml = ClinicTest.renderUiForTest({ drawer: "rooms", drawerContext: null, confirm: null });
if (!roomsHtml.includes("No effect on cases yet") || !roomsHtml.includes("still needs")) throw new Error("Room previews do not explain why a purchase has no effect yet");
const fullState = ClinicTest.getState();
fullState.domain = "care";
fullState.rooms.consult = 1;
fullState.services.vaccination.active = true;
fullState.services.preventive.active = true;
fullState.pending = {};
const fullCare = ClinicTest.renderState(fullState);
if (!fullCare.includes(">Full<") || !fullCare.includes("requests turned away")) throw new Error("Care page does not flag a full room with the requests turned away");
const serviceFamilies = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: null, selectedServiceId: null, confirm: null });
if (!serviceFamilies.includes("1 service")) throw new Error("English service singular/plural is incorrect");
const serviceRows = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: null, confirm: null });
if (!serviceRows.includes("Select one service") || serviceRows.includes("Expected consequences")) throw new Error("Service family expands more than compact rows");
const selectedService = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: "consult", confirm: null });
if ((selectedService.match(/Expected consequences/g) || []).length !== 1) throw new Error("Selected service must show exactly one consequence panel");
if (/elasticity|contribution\/case|geomarketing|kWh\/case/i.test(selectedService)) throw new Error("Selected service exposes beginner-facing technical jargon");
const carbonDrawer = ClinicTest.renderUiForTest({ drawer: "sustainability", drawerContext: "building", confirm: null });
if (!carbonDrawer.includes("Expected consequences")) throw new Error("Sustainability choices lack consequence previews");
const pricingState = ClinicTest.getState();
pricingState.domain = "business";
const businessHtml = ClinicTest.renderState(pricingState) + ClinicTest.renderUiForTest({ drawer: "pricing", drawerContext: null, confirm: null });
if (/elasticity|contribution\/case|geomarketing|kWh\/case/i.test(businessHtml)) throw new Error("Business decision surfaces expose technical jargon");
const teamState = ClinicTest.getState();
teamState.domain = "team";
const teamHtml = ClinicTest.renderState(teamState);
if (!teamHtml.includes("Change time allocation") || !teamHtml.includes("Unused team hours")) throw new Error("Team page does not expose readable staffing-hour choices");
if (teamHtml.includes("Secondary allocation")) throw new Error("Obsolete primary/secondary allocation UI is still visible");
if (!teamHtml.includes("Let go")) throw new Error("Staff cards do not offer letting someone go");
const exitHtml = ClinicTest.renderUiForTest({ drawer: "staffExit", drawerContext: "support-maya", confirm: null });
if (!exitHtml.includes("severance") || !exitHtml.includes('data-add-key="fire:support-maya"')) throw new Error("The letting-go card does not show its consequences and a direct add");
const allocationHtml = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "vet-founder", confirm: null, allocationDrafts: {} });
if (!allocationHtml.includes("does not create new hours") || !allocationHtml.includes("100% assigned") || !allocationHtml.includes("Live impact")) throw new Error("Allocation drawer lacks conservation guidance or live consequences");
if ((allocationHtml.match(/data-allocation-adjust/g) || []).length < 4) throw new Error("Allocation drawer lacks accessible 5% controls");
if (!teamHtml.includes("Who can do what") || !teamHtml.includes("General practice")) throw new Error("Team page does not show skills or the capability matrix entry");
const capabilityHtml = ClinicTest.renderUiForTest({ drawer: "capabilities", drawerContext: null, confirm: null });
if (!capabilityHtml.includes("capability-table") || !capabilityHtml.includes("Can do") || !capabilityHtml.includes("Train") || !capabilityHtml.includes("Not this role")) throw new Error("Capability matrix does not explain who can do what");
const trainingPeople = ClinicTest.renderUiForTest({ drawer: "training", drawerContext: null, confirm: null });
if (!trainingPeople.includes("Dr Amina Kone") || trainingPeople.includes("Expected consequences")) throw new Error("Training must start by choosing a person");
const trainingOptions = ClinicTest.renderUiForTest({ drawer: "training", drawerContext: "vet-founder", confirm: null });
if (!trainingOptions.includes("Ultrasound") || trainingOptions.includes("Animal care") || !trainingOptions.includes("Unlocks")) throw new Error("Per-person training shows the wrong role's skills");
const paceService = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: "consult", confirm: null });
if (!paceService.includes("Pace: time per appointment") || !paceService.includes("Who can staff this")) throw new Error("Service detail lacks pace or staffing clarity");
if (!paceService.includes("Vet time per case") || !paceService.includes("Support time per case")) throw new Error("Service detail must show the vet and support time separately");
if (/>Time per case</.test(paceService)) throw new Error("The blended time-per-case stat should be gone");
const overtimeDraft = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "vet-founder", confirm: null, allocationDrafts: { "vet-founder": [{ serviceId: "consult", share: .9 }, { serviceId: "preventive", share: .3 }] } });
if (!overtimeDraft.includes("120% assigned") || !overtimeDraft.includes("overtime hours") || !overtimeDraft.includes("Overtime cost")) throw new Error("Allocation drawer does not show overtime consequences");
ClinicTest.renderUiForTest({ allocationDrafts: {} });
const frenchTeamState = ClinicTest.getState();
frenchTeamState.language = "fr";
ClinicTest.renderState(frenchTeamState);
const frenchAllocation = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "vet-founder", confirm: null, allocationDrafts: {} });
if (!frenchAllocation.includes("ne crée pas de nouvelles heures") || !frenchAllocation.includes("Impact en direct") || !frenchAllocation.includes("Formation nécessaire")) throw new Error("French allocation workspace is incomplete");
frenchTeamState.language = "en";
ClinicTest.renderState(frenchTeamState);
const hoursHtml = ClinicTest.renderUiForTest({ drawer: "hoursByService", drawerContext: null, confirm: null });
if (!hoursHtml.includes("Hours by service") || !hoursHtml.includes("Assigned") || !hoursHtml.includes("Needed")) throw new Error("Service-hour comparison is missing");
const exportHtml = ClinicTest.renderUiForTest({ drawer: "export", drawerContext: null, confirm: null });
if (!exportHtml.includes("Print / Save as PDF") || !exportHtml.includes("Download analytical JSON")) throw new Error("Export drawer lacks both readable and analytical formats");
const settingsState = ClinicTest.getState();
settingsState.domain = "overview";
ClinicTest.renderState(settingsState);
const settingsHtml = ClinicTest.renderUiForTest({ drawer: "setup", drawerContext: null, confirm: null });
if (!settingsHtml.includes('data-settings-field="actionLimit"') || !settingsHtml.includes("Save settings")) throw new Error("Settings are not a saved draft with one action-limit selector");
if (settingsHtml.includes('data-rule="actionLimit"')) throw new Error("Immediate legacy action-limit control is still visible");
if (!settingsHtml.includes('data-settings-field="startingTreasury"') || !settingsHtml.includes('data-settings-field="forecastPrecision"') || !settingsHtml.includes('data-settings-field="classCode"') || !settingsHtml.includes('data-settings-field="studyGroup"') || !settingsHtml.includes("data-adjust-cash")) throw new Error("Game setup fields are missing");
const exportDrawerHtml = ClinicTest.renderUiForTest({ drawer: "export", drawerContext: null, confirm: null });
if (!exportDrawerHtml.includes("data-team-code")) throw new Error("The export drawer must collect a team code");
if (exportDrawerHtml.includes("data-team-name") || exportDrawerHtml.includes("data-participant-names")) throw new Error("The export drawer must not collect names");
const costsState = ClinicTest.getState();
costsState.domain = "overview";
costsState.setup.forecastPrecision = "costs";
if (!ClinicTest.renderState(costsState).includes("Revealed at year end")) throw new Error("Costs-only forecasts still reveal outcomes");
const rangeState = ClinicTest.getState();
rangeState.setup.forecastPrecision = "ranges";
if (!ClinicTest.renderState(rangeState).includes(" … ")) throw new Error("Range forecasts are not shown as ranges");
const lockedState = ClinicTest.getState();
lockedState.setup.forecastPrecision = "exact";
lockedState.history = [ClinicTest.simulateYear(ClinicTest.clone(lockedState), lockedState, ClinicTest.emptyEffects(), [])];
ClinicTest.renderState(lockedState);
if (!ClinicTest.renderUiForTest({ drawer: "setup", confirm: null }).includes('data-settings-field="startingTreasury" disabled')) throw new Error("Starting treasury should lock after Year 1");
const unlockedState = ClinicTest.getState();
unlockedState.history = [];
ClinicTest.renderState(unlockedState);
ClinicTest.renderUiForTest({ drawer: null, confirm: null });
const addState = ClinicTest.getState();
addState.pending = {};
addState.domain = "overview";
ClinicTest.renderState(addState);
const addHtml = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: null, selectedServiceId: "vaccination", confirm: null });
if (!addHtml.includes('data-add-key="service:vaccination:active"') || !addHtml.includes("3 left")) throw new Error("Service cards should add directly to the plan and show the remaining budget");
if ((addHtml.match(/class="service-row/g) || []).length !== 14) throw new Error("The service list should show every service on one screen");
addState.pending = { "service:vaccination:active": { key: "service:vaccination:active", payload: { kind: "toggle-service", targetId: "vaccination", value: true } } };
ClinicTest.renderState(addState);
const inPlanHtml = ClinicTest.renderUiForTest({ drawer: "services", selectedServiceId: "vaccination", confirm: null });
if (!inPlanHtml.includes("In plan") || !inPlanHtml.includes('data-remove-action="service:vaccination:active"')) throw new Error("A planned decision should show In plan with Undo");
addState.rules.actionLimit = 1;
ClinicTest.renderState(addState);
if (!ClinicTest.renderUiForTest({ drawer: "services", selectedServiceId: "preventive", confirm: null }).includes("Limit reached")) throw new Error("Cards should show when the action limit is reached");
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
const passHtml = ClinicTest.renderUiForTest({ drawer: null, passCheck: true, confirm: null });
if (!passHtml.includes("Pass Year 1") || !passHtml.includes("3 actions unused") || !passHtml.includes("hours on closed services")) throw new Error("Passing the year should show a checklist with unused actions and warnings");
ClinicTest.renderUiForTest({ passCheck: false });
const routed = ClinicTest.parseRoute("#team/person/support-maya/pay");
if (routed.domain !== "team" || routed.drawer !== "person" || routed.context !== "support-maya" || routed.detail !== "pay") throw new Error("Hash routes do not parse");
ClinicTest.openDrawer("staffPerson", "support-maya");
if (ClinicTest.routeFor() !== "#team/person/support-maya/pay") throw new Error("Hash routes do not round-trip or legacy drawers do not open the person hub");
ClinicTest.openDrawer("services", null, "vaccination");
if (ClinicTest.getState().domain !== "care") throw new Error("Opening a service drawer should move the page to Care & facilities");
const personHtml = ClinicTest.renderUiForTest({ drawer: "person", drawerContext: "support-maya", personTab: "exit", confirm: null });
if (!personHtml.includes('data-person-tab="time"') || !personHtml.includes("severance") || !personHtml.includes("Team &amp; operations › Maya Chen")) throw new Error("The person drawer should combine the staff tasks with a breadcrumb");
ClinicTest.renderUiForTest({ drawer: null, drawerContext: null, selectedServiceId: null, confirm: null });
const bannerState = ClinicTest.initialState("balanced", "en");
const bannerHtml = ClinicTest.renderState(bannerState);
if (!bannerHtml.includes("Before you start")) throw new Error("The game setup banner should appear before Year 1");
if ((bannerHtml.match(/>Investigate Vaccination</g) || []).length !== 1) throw new Error("Signals should not repeat the same destination");
bannerState.setupLog = [{ year: 1, at: "test", changes: [] }];
if (ClinicTest.renderState(bannerState).includes("Before you start")) throw new Error("The setup banner should disappear once setup is saved");
const resultsState = ClinicTest.getState();
resultsState.domain = "results";
resultsState.history = [ClinicTest.simulateYear(ClinicTest.clone(resultsState), resultsState, ClinicTest.emptyEffects(), [])];
resultsState.year = 2;
if (!ClinicTest.renderState(resultsState).includes("Plan Year 2")) throw new Error("Results should lead into planning the next year");
const resetNavigation = ClinicTest.getState();
resetNavigation.history = [];
resetNavigation.year = 1;
resetNavigation.setupLog = [];
resetNavigation.domain = "overview";
ClinicTest.renderState(resetNavigation);
ClinicTest.renderUiForTest({ drawer: null, drawerContext: null, confirm: null });
const css = fs.readFileSync("./styles.css", "utf8");
if (!/\.button\s*\{[\s\S]*?min-height:\s*44px/.test(css)) throw new Error("Primary controls are smaller than 44px");
if (!/@media \(max-width: 1000px\)[\s\S]*?\.plan-panel\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*auto;[\s\S]*?max-height:\s*none;/.test(css)) throw new Error("Tablet Plan bar does not clear desktop positioning");
if (!/\.drawer\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?max-height:\s*100dvh;/.test(css)) throw new Error("Drawer is not constrained to the dynamic viewport");
if (!/@media \(max-width: 480px\)[\s\S]*?\.consequence-grid\s*\{\s*grid-template-columns:\s*1fr;/.test(css)) throw new Error("Phone consequence cards do not collapse to one column");
if (!/\.allocation-rows article[\s\S]*?grid-template-columns:[\s\S]*?@media \(max-width: 480px\)[\s\S]*?\.allocation-rows article\s*\{\s*grid-template-columns:\s*1fr;/.test(css)) throw new Error("Allocation rows do not collapse safely on phones");

// --- Pass 6: clarity of numbers ---
const mkt = ClinicTest.renderUiForTest({ drawer: "market", drawerContext: null, confirm: null });
if (/reachable clients/.test(mkt)) throw new Error("The market drawer must not show the unused segment size");
if (!/Asks most for:/.test(mkt) || !/Price sensitivity:/.test(mkt)) throw new Error("Market segments must describe demand and price tolerance");

const equip = ClinicTest.renderUiForTest({ drawer: "equipment", drawerContext: null, confirm: null });
if (!/One-time costs/.test(equip)) throw new Error("A purchase must show its one-time cost in the preview");
if (!/year upkeep if owned/.test(equip)) throw new Error("Owned equipment must show its annual upkeep");
if (!/Net result/.test(equip) || /Net cash this year/.test(equip)) throw new Error("The preview outcome row must use the app-wide name Net result");

const openDrawer = ClinicTest.renderUiForTest({ drawer: "opening", drawerContext: null, confirm: null });
if (/One-time costs/.test(openDrawer)) throw new Error("A purely recurring decision must not show a one-time cost row");
if (!/Added cost per year/.test(openDrawer)) throw new Error("A recurring decision must name its annual charge");

const loc = ClinicTest.renderUiForTest({ drawer: "location", drawerContext: null, confirm: null });
if (!/once to move/.test(loc)) throw new Error("Relocation must show its one-time move cost");
if (!/Add parking[\s\S]{0,400}?once/.test(loc)) throw new Error("The parking card must show a price");

// Inspect the preview grids only: the Overview behind the drawer also names staff climate.
const previewGrids = (html) => html.split('class="consequence-grid"').slice(1);
const stockGrids = previewGrids(ClinicTest.renderUiForTest({ drawer: "stock", drawerContext: null, confirm: null }));
if (!stockGrids.length) throw new Error("The stock drawer should preview each strategy");
if (stockGrids.some((grid) => /Staff climate/.test(grid))) throw new Error("Climate rows must appear only when the decision moves climate");
const openingGrids = previewGrids(ClinicTest.renderUiForTest({ drawer: "opening", drawerContext: null, confirm: null }));
if (!openingGrids.every((grid) => /Staff climate/.test(grid))) throw new Error("Every opening period changes climate and must show it");

const vetId = ClinicTest.getState().staff[0].id;
const partial = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: vetId, confirm: null, allocationDrafts: { [vetId]: [{ serviceId: "consult", share: .65 }] } });
if (!/data-allocation-fill/.test(partial)) throw new Error("Under 100% the allocation row must offer the remaining hours");
const filled = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: vetId, confirm: null, allocationDrafts: { [vetId]: [{ serviceId: "consult", share: 1 }] } });
if (/data-allocation-fill/.test(filled)) throw new Error("At 100% there are no remaining hours to offer");
if (Math.abs(ClinicTest.allocationRemainder([{ share: .3 }, { share: .25 }], 1) - .45) > 1e-9) throw new Error("allocationRemainder must return the exact unassigned share");
if (ClinicTest.allocationRemainder([{ share: 1 }], 0) !== 0) throw new Error("A full allocation has no remainder");

const helpState = ClinicTest.getState();
helpState.helpOpen = true;
const helpHtml = ClinicTest.renderState(helpState);
if (!helpHtml.includes("open services only")) throw new Error("The glossary must say requests count open services only");
helpState.helpOpen = false;
ClinicTest.renderState(helpState);


// --- Pass 7 Phase 0: one quantity, one name, everywhere ---
// Renders every page and drawer in both languages and fails if a retired name reappears.
const RETIRED_NAMES = ["Staff use", "Clinic workload", "Requests served", "Care delivered", "Closing treasury", "Climat de travail", "Utilisation du personnel", "Charge de la clinique", "Soins realises", "Demandes traitees", "Tresorerie de cloture"];
const ALL_DOMAINS = ["overview", "care", "team", "business", "sustainability", "results"];
const ALL_DRAWERS = ["services", "rooms", "equipment", "person", "staffAllocation", "staffPerson", "staffExit", "training", "capabilities", "hoursByService", "recruitment", "opening", "dropoff", "stock", "hr", "pricing", "finance", "market", "location", "marketing", "sustainability", "plan", "export", "setup"];
const stripAccents = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
["en", "fr"].forEach((language) => {
  const base = ClinicTest.initialState("balanced", language);
  Object.keys(base.services).forEach((id) => { base.services[id].active = true; });
  base.history = [ClinicTest.simulateYear(ClinicTest.clone(base), base, ClinicTest.emptyEffects(), [])];
  let seen = "";
  ALL_DOMAINS.forEach((domain) => { const next = ClinicTest.clone(base); next.domain = domain; seen += ClinicTest.renderState(next); });
  ClinicTest.renderState(base);
  ALL_DRAWERS.forEach((drawer) => { seen += ClinicTest.renderUiForTest({ drawer, drawerContext: null, selectedServiceId: "surgery", confirm: null }); });
  seen += ClinicTest.buildPrintableReportHtml();
  const plain = stripAccents(seen);
  RETIRED_NAMES.forEach((name) => {
    if (plain.includes(stripAccents(name))) throw new Error(`Retired name "${name}" still reaches the screen in ${language}: one quantity must carry one name everywhere`);
  });
});


// --- Pass 7 Phase 1: dead model data stays dead ---
const DEAD_NAMESPACES = ["money", "services", "operations", "market"];
DEAD_NAMESPACES.forEach((ns) => {
  if (ClinicI18n.dictionaries.en[ns] || ClinicI18n.dictionaries.fr[ns]) throw new Error(`i18n namespace "${ns}" drives nothing and must not return`);
});
if (Object.keys(ClinicI18n.dictionaries.en.dashboard).length !== 1) throw new Error("Only dashboard.chooseScenario is still used");
const serialisedData = JSON.stringify(ClinicTest.data);
["\"size\"", "\"reachable\"", "\"reputationSensitivity\""].forEach((field) => {
  if (serialisedData.includes(field)) throw new Error(`Data field ${field} is read by nothing and must not return`);
});


// --- Pass 7 Phase 2: what the model knows must reach the screen ---
const balancedStart = ClinicTest.initialState("balanced", "en");
const overviewHtml = ClinicTest.renderState(balancedStart);
// Assert on the Cases-served card itself: the scenario-goal text also contains "of open requests",
// so a page-wide regex stays green even when the caption is deleted.
const servedCaption = (html) => (html.match(/Cases served<\/span><strong>[^<]*<\/strong><em>([^<]*)</) || [])[1] || "";
const overviewCaption = servedCaption(overviewHtml);
if (!/of open requests/.test(overviewCaption)) throw new Error("The Cases-served card must say the rate is of OPEN requests");
if (!/not offered/.test(overviewCaption)) throw new Error("The Cases-served card must show how many requests are not offered");
const careStart = ClinicTest.clone(balancedStart); careStart.domain = "care";
const careCaption = servedCaption(ClinicTest.renderState(careStart));
if (!/of open requests/.test(careCaption) || !/not offered/.test(careCaption)) throw new Error("The Care page Cases-served card must show the unmet market too");

const ramping = ClinicTest.initialState("balanced", "en");
ramping.services.vaccination.active = true;
ramping.services.vaccination.openedYear = ramping.year;
ramping.domain = "care";
if (!/first year · 60% of demand/.test(ClinicTest.renderState(ramping))) throw new Error("A service in its opening year must say its demand is reduced");
const established = ClinicTest.clone(ramping);
established.services.vaccination.openedYear = established.year - 1;
if (/first year · 60% of demand/.test(ClinicTest.renderState(established))) throw new Error("An established service must not claim to be in its first year");

const withYear = (lang, loan) => {
  const clinic = ClinicTest.initialState("balanced", lang);
  if (loan) clinic.finance.loan = { principal: 50000, remaining: 50000, yearsRemaining: 5, rate: .06 };
  clinic.history = [ClinicTest.simulateYear(ClinicTest.clone(clinic), clinic, ClinicTest.emptyEffects(), [])];
  clinic.domain = "results";
  return clinic;
};
const resultsHtml = ClinicTest.renderState(withYear("en", false));
if (!/Referral support/.test(resultsHtml) || !/Access pressure/.test(resultsHtml)) throw new Error("Referral support and access pressure shift demand and must be visible");
const frResults = ClinicTest.renderState(withYear("fr", false));
if (!/Soutien des référents/.test(frResults) || !/Pression d’accès/.test(frResults)) throw new Error("The social indicators must be translated");
ClinicTest.renderState(withYear("en", true));
if (!/Loan interest/.test(ClinicTest.buildPrintableReportHtml())) throw new Error("A loan year must report its interest as its own line");
ClinicTest.renderState(withYear("en", false));
if (/Loan interest/.test(ClinicTest.buildPrintableReportHtml())) throw new Error("A year with no loan must not show a loan-interest line");


// --- Pass 7 Phase 3: price response must never plateau ---
// Two earlier attempts flattened instead: a .25 clamp held demand at 475 from about 3x willingness,
// and a flat .02 clamp merely moved the cliff. Each service's linear term reached zero at a
// different ratio (1.65 retail to 5.55 emergency), so only a decaying curve is monotonic for all.
const priceProbe = ClinicTest.initialState("balanced", "en");
const consultService = ClinicTest.data.services.find((service) => service.id === "consult");
const demandAt = (price) => { const clinic = ClinicTest.clone(priceProbe); clinic.services.consult.price = price; return ClinicTest.projectedDemand(consultService, clinic); };
const ladder = [100, 150, 240, 500, 5000].map(demandAt);
ladder.forEach((value, index) => {
  if (index && value >= ladder[index - 1]) throw new Error(`Demand must keep falling as price rises: ${ladder.join(" -> ")}`);
});
if (demandAt(5000) > 5) throw new Error("An absurd price must destroy the market, not plateau");


// --- Pass 7: a badge must never contradict the figure beside it ---
// referralSupport drifts 50 -> 49.5 in a normal first year. Rounded for display that is still "50",
// so judging the badge on the raw float warned about a number the card showed as unchanged.
const badgeClinic = ClinicTest.initialState("balanced", "en");
const badgeReport = ClinicTest.simulateYear(ClinicTest.clone(badgeClinic), badgeClinic, ClinicTest.emptyEffects(), []);
badgeReport.social.before.referralSupport = 50;
badgeReport.social.after.referralSupport = 49.5;
badgeClinic.history = [badgeReport];
badgeClinic.domain = "results";
const badgeCard = ClinicTest.renderState(badgeClinic).match(/Referral support<\/span><strong>([^<]*)<\/strong><em>([^<]*)</);
if (!badgeCard) throw new Error("The referral-support card should render");
if (badgeCard[1] === "50" && /Needs attention/.test(badgeCard[2])) throw new Error("A metric card must not warn about a value it displays as unchanged");


// --- Pass 8: a price rise must be a real decision ---
// Two anchors pin the steepness of the above-willingness curve. The previous pass softened it
// without noticing (exponential decay retains more than the linear curve it replaced at every
// ratio below ~2.6), so this guards the slope itself rather than only its monotonicity.
const priceCurveClinic = ClinicTest.initialState("balanced", "en");
const consultForCurve = ClinicTest.data.services.find((service) => service.id === "consult");
const keptAtPrice = (price) => {
  const clinic = ClinicTest.clone(priceCurveClinic);
  clinic.services.consult.price = price;
  return ClinicTest.projectedDemand(consultForCurve, clinic) / ClinicTest.projectedDemand(consultForCurve, priceCurveClinic);
};
if (keptAtPrice(75) >= .75) throw new Error(`Half again the willingness price must cost real requests, kept ${(keptAtPrice(75) * 100).toFixed(1)}%`);
if (keptAtPrice(100) >= .55) throw new Error(`Doubling the price must cost about half the requests, kept ${(keptAtPrice(100) * 100).toFixed(1)}%`);


// --- Pass 8: marketing must still be worth buying when capacity binds ---
// Before this pass, paid marketing only scaled demand, so once honored = min(demand, caps) the fee
// bought nothing and lowered honoredRate, which lowers trust. Paid tiers now also raise what
// clients accept paying, which keeps returning after the ceiling is reached.
const capacityBound = (tier) => {
  const clinic = ClinicTest.initialState("growth", "en");
  Object.keys(clinic.services).forEach((id) => { clinic.services[id].active = true; });
  clinic.marketing.communication = tier;
  return ClinicTest.simulateYear(ClinicTest.clone(clinic), clinic, ClinicTest.emptyEffects(), []);
};
const boundBasic = capacityBound("basic");
if (boundBasic.operational.honoredRate > .8) throw new Error("This probe is meant to be capacity-bound; it is not");
const boundTargeted = capacityBound("targeted");
if (boundTargeted.financial.netResult - boundBasic.financial.netResult < 2000) throw new Error("Paid communication must still pay for itself on a capacity-bound clinic");

// The calibration firewall: the default tier carries no willingness field, so the multiplier is
// exactly 1 and every scenario baseline is untouched by this feature.
if (ClinicTest.data.marketingStrategies.communication.basic.willingness) throw new Error("The default communication tier must stay free of any willingness boost");
if (!ClinicTest.data.marketingStrategies.communication.targeted.willingness) throw new Error("Paid communication must raise the price clients accept");
// Test the mechanism, not just the field: above the willingness line the pivot itself has moved,
// so the same price costs fewer requests. The capacity test above cannot see this on its own,
// because its probe clinic still has demand headroom on several services.
const pivotProbe = (tier) => {
  const clinic = ClinicTest.initialState("balanced", "en");
  clinic.marketing.communication = tier;
  clinic.services.consult.price = 100;
  return ClinicTest.projectedDemand(ClinicTest.data.services.find((service) => service.id === "consult"), clinic);
};
if (pivotProbe("targeted") <= pivotProbe("basic") * 1.02) throw new Error("Above the willingness price, paid communication must visibly soften the loss of requests");


// --- Pass 8: the supplies percentage, and the stock drawer naming every affected service ---
const suppliesPattern = /(?:supplies|fournitures)\s[0-9][0-9,.\s\u00a0\u202f]*%/;
["en", "fr"].forEach((language) => {
  const clinic = ClinicTest.initialState("balanced", language);
  Object.keys(clinic.services).forEach((id) => { clinic.services[id].active = true; });
  ClinicTest.renderState(clinic);
  const detail = (ClinicTest.renderUiForTest({ drawer: "services", selectedServiceId: "consult", confirm: null }).match(suppliesPattern) || [])[0];
  const pricing = (ClinicTest.renderUiForTest({ drawer: "pricing", drawerContext: null, confirm: null }).match(suppliesPattern) || [])[0];
  if (!detail) throw new Error(`The service card must show the supplies percentage (${language})`);
  if (!pricing) throw new Error(`The pricing drawer must show the supplies percentage (${language})`);
  if (detail !== pricing) throw new Error(`Both surfaces must show the same supplies percentage for one service: "${detail}" vs "${pricing}"`);
});

// Iterate the real set, so adding a service to STOCK_SERVICES without naming it here fails here
// rather than silently misinforming students, which is how orthopedics went unmentioned.
const STOCK_WORDS = {
  pharmacy: [/pharmacy/i, /pharmacie/i], surgery: [/surgery/i, /chirurgie/i],
  hospital: [/hospital/i, /hospitalisation/i], dentistry: [/dentistry/i, /dentisterie/i],
  orthopedic: [/orthoped/i, /orthop\u00e9d/i], vaccination: [/vaccination/i, /vaccination/i],
  preventive: [/preventive/i, /pr\u00e9vention/i]
};
["en", "fr"].forEach((language, index) => {
  ClinicTest.renderState(ClinicTest.initialState("balanced", language));
  const stockHtml = ClinicTest.renderUiForTest({ drawer: "stock", drawerContext: null, confirm: null });
  [...ClinicTest.stockServices].forEach((id) => {
    const pattern = (STOCK_WORDS[id] || [])[index];
    if (!pattern) throw new Error(`No keyword for stock-dependent service "${id}" — add one when adding the service`);
    if (!pattern.test(stockHtml)) throw new Error(`The stock drawer must name every stock-dependent service; "${id}" is missing (${language})`);
  });
});


// --- Pass 8: every decision says how long it lasts ---
// The marker rides with consequencePreview, so any surface that previews a decision must carry one.
const DURATION_SURFACES = [
  ["services", "core", "vaccination"], ["rooms", null, null], ["equipment", null, null],
  ["training", null, null], ["pricing", null, null], ["staffExit", "support-maya", null],
  ["staffPerson", "vet-founder", null], ["opening", null, null], ["dropoff", null, null],
  ["stock", null, null], ["hr", null, null], ["finance", null, null], ["market", null, null],
  ["location", null, null], ["marketing", "communication", null], ["sustainability", "building", null]
];
["en", "fr"].forEach((language) => {
  ClinicTest.renderState(ClinicTest.initialState("balanced", language));
  DURATION_SURFACES.forEach(([drawer, drawerContext, selectedServiceId]) => {
    const html = ClinicTest.renderUiForTest({ drawer, drawerContext, selectedServiceId, confirm: null });
    const previews = (html.match(/class="consequence-grid"/g) || []).length;
    const markers = (html.match(/class="lasts"/g) || []).length;
    if (previews && markers < previews) throw new Error(`Every previewed decision must say how long it lasts; ${drawer} has ${markers} of ${previews} (${language})`);
  });
});

// The five effects that used to be invisible, each named where the decision is made.
const riderFor = (drawer, payload) => {
  const html = ClinicTest.renderUiForTest({ drawer, drawerContext: null, confirm: { key: "probe", payload } });
  return (html.match(/class="lasts">([^<]*)</) || [])[1] || "";
};
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
const RIDERS = [
  ["services", { kind: "toggle-service", targetId: "vaccination", value: true }, "first year 60% of demand"],
  ["market", { kind: "market-focus", targetId: "advanced" }, "first year −10% requests"],
  ["location", { kind: "location", targetId: "centre" }, "first year −5% requests"],
  ["recruitment", { kind: "hire", targetId: "vet-generalist", value: { role: "vet", desiredSkills: ["general"], salaryBudget: 60000, offeredSalary: 52000 } }, "first year 25% settling in"],
  ["staffExit", { kind: "fire", targetId: "support-maya" }, "no rehire for one year"]
];
RIDERS.forEach(([drawer, payload, expected]) => {
  if (!riderFor(drawer, payload).includes(expected)) throw new Error(`A one-year effect must be named where the decision is made: "${expected}" missing from ${drawer}`);
});
// Leasing recurs; buying is once plus upkeep. Same action kind, two different commitments.
if (riderFor("equipment", { kind: "equipment-acquire", targetId: "ultrasound", mode: "lease" }) === riderFor("equipment", { kind: "equipment-acquire", targetId: "ultrasound", mode: "buy" })) throw new Error("Leasing and buying must not claim the same duration");

require("./tests.js");

for (const item of resultItems) console.log(item.textContent);
console.log(elements["#summary"].textContent);
if (resultItems.some((item) => item.className === "fail")) process.exitCode = 1;
