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
if (!overtimeDraft.includes("120% assigned") || !overtimeDraft.includes("overtime hours")) throw new Error("Above 100% the meter must say how many overtime hours are allowed");
if (!/Forecast worked: 0 h/.test(overtimeDraft)) throw new Error("The meter must also say how many overtime hours will actually be worked, not just how many are allowed");
if (overtimeDraft.includes("Overtime cost")) throw new Error("With no overtime actually worked, the cost row is 0 to 0 and should stay hidden");
{
  // With a capacity-constrained person the hours really are worked, and then the cost must appear.
  const small = ClinicTest.initialState("balanced", "en");
  small.services.vaccination.active = true;
  small.staff.find((person) => person.id === "support-maya").capacity = 300;
  ClinicTest.renderState(small);
  const worked = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "support-maya", confirm: null, allocationDrafts: { "support-maya": [{ serviceId: "vaccination", share: 1.3 }] } });
  if (!worked.includes("Overtime cost")) throw new Error("When overtime is actually worked, its cost must be shown");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}
// The meter described the assignment while the hours were blocked: a student read "fully booked"
// at the exact moment their clinic collapsed.
{
  const untrained = ClinicTest.initialState("balanced", "en");
  untrained.services.lab.active = true;
  ClinicTest.renderState(untrained);
  const blocked = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "support-maya", confirm: null, allocationDrafts: { "support-maya": [{ serviceId: "lab", share: 1 }] } });
  if (blocked.includes("fully booked")) throw new Error("Hours blocked until training must not be described as fully booked");
  if (!/blocked until training/.test(blocked)) throw new Error("The meter must say the hours are blocked, since no case can be handled");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}
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
if (!/Operating costs/.test(openDrawer)) throw new Error("A recurring decision must name the cost line its annual charge lands on");
if (!/€12,000/.test(openDrawer)) throw new Error("The annual charge in the preview must equal the price printed on the card");

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

// The hours grid used to read the SAVED allocation, so it printed the same four figures whatever
// the student was dragging — and contradicted the workload line three rows below it. It must move
// with the draft, and the cells must add up at every share, overtime included.
function hoursGridCells(share, mutate) {
  const setup = ClinicTest.initialState("balanced", "en");
  setup.services.vaccination.active = true;
  if (mutate) mutate(setup);
  ClinicTest.renderState(setup);
  const html = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "support-maya", confirm: null, allocationDrafts: { "support-maya": [{ serviceId: "vaccination", share }] } });
  const grid = html.match(/<div class="mini-hours">([\s\S]*?)<\/div><div class="allocation-total/);
  if (!grid) throw new Error("The allocation drawer must render an hours grid");
  const cells = {};
  for (const match of grid[1].matchAll(/<span>([^<]*)<\/span><strong>([^<]*)<\/strong>/g)) cells[match[1]] = Number(match[2].replace(/[^\d]/g, ""));
  return cells;
}
const lightDraft = hoursGridCells(.2);
const heavyDraft = hoursGridCells(1);
if (lightDraft["Hours used"] === heavyDraft["Hours used"]) throw new Error("The hours grid must follow the draft, not the saved allocation");
// available + overtime = used + unused + blocked, at every share. The model's own unusedHours falls
// back to assigned hours above 100%, which is what made these cells stop adding up.
[[.2, null], [.65, null], [1, null], [1.3, null], [.65, (s) => { s.staff.find((p) => p.id === "support-maya").capacity = 300; }], [1.3, (s) => { s.staff.find((p) => p.id === "support-maya").capacity = 300; }]].forEach(([share, mutate]) => {
  const c = hoursGridCells(share, mutate);
  const left = c["Available hours"] + (c["Overtime hours"] || 0);
  const right = c["Hours used"] + c["Unused hours"] + c["Blocked hours"];
  if (Math.abs(left - right) > 1) throw new Error(`The hours grid must reconcile at ${Math.round(share * 100)}%: ${left} vs ${right}`);
});
// The sentence above the grid and the grid itself must never describe different clinics. The
// meter used to talk about the assignment ("35% unassigned", "fully booked") while the hours told
// a different story underneath it — three-quarters idle, or every hour blocked.
function meterAndGrid(share, mutate, service = "vaccination") {
  const setup = ClinicTest.initialState("balanced", "en");
  setup.services[service].active = true;
  if (mutate) mutate(setup);
  ClinicTest.renderState(setup);
  const html = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "support-maya", confirm: null, allocationDrafts: { "support-maya": [{ serviceId: service, share }] } });
  const meter = html.match(/<div class="allocation-total[^"]*"><strong>([^<]*)</)?.[1] || "";
  const grid = html.match(/<div class="mini-hours">([\s\S]*?)<\/div><div class="allocation-total/)?.[1] || "";
  const cells = {};
  for (const cell of grid.matchAll(/<span>([^<]*)<\/span><strong>([^<]*)<\/strong>/g)) cells[cell[1]] = Number(cell[2].replace(/[^\d]/g, ""));
  return { meter, cells };
}
const shrink = (setup) => { setup.staff.find((person) => person.id === "support-maya").capacity = 300; };
[[.65, null], [1, null], [1, shrink]].forEach(([share, mutate]) => {
  const { meter, cells } = meterAndGrid(share, mutate);
  if (cells["Unused hours"] >= 1 && !meter.includes(`${cells["Unused hours"].toLocaleString("en-GB").replace(/,/g, ",")} h paid and unused`)) {
    throw new Error(`The meter must report the hours the grid calls unused (${cells["Unused hours"]}), not a share of the assignment: "${meter}"`);
  }
});
// Overtime the model will actually work has to reach the sentence, not only the allowance.
{
  const { meter, cells } = meterAndGrid(1.3, shrink);
  if (!meter.includes(`Forecast worked: ${cells["Overtime hours"]} h`)) throw new Error(`The meter must name the overtime actually worked (${cells["Overtime hours"]} h): "${meter}"`);
}

// Worked overtime belongs where the hours are, not only inside a sentence.
const overtimeCells = hoursGridCells(1.3, (s) => { s.staff.find((p) => p.id === "support-maya").capacity = 300; });
if (!(overtimeCells["Overtime hours"] > 0)) throw new Error("Overtime hours must appear in the grid when they are worked");
if (hoursGridCells(.65)["Overtime hours"] !== undefined) throw new Error("The overtime cell must stay hidden when no overtime is worked");

const stateBeforePlanRowTests = ClinicTest.getState();
// The mobile plan drawer built its own rows with raw money()/number()/pct(), so a game set to
// ranges or costs precision printed exact figures on a phone — defeating an instructor setting.
// Desktop and mobile must draw the same rows from the same formatter.
function planLabels(html) {
  return [...html.matchAll(/<(?:strong)>([^<]*)<\/strong><span>/g)].map((match) => match[1]);
}
["en", "fr"].forEach((language) => {
  ["ranges", "costs"].forEach((precision) => {
    const setup = ClinicTest.initialState("balanced", language);
    setup.setup.forecastPrecision = precision;
    const desktop = ClinicTest.renderState(setup);
    const mobile = ClinicTest.renderUiForTest({ drawer: "plan", drawerContext: null, confirm: null });
    const leak = precision === "costs" ? /Revealed at year end|Révélé en fin d’année/ : /…/;
    const details = mobile.match(/<div class="mobile-plan-details">[\s\S]*?<div class="plan-actions">/)?.[0] || "";
    if (!details) throw new Error("The mobile plan drawer must render its comparison list");
    if (!leak.test(details)) throw new Error(`The mobile plan drawer leaks exact figures under ${precision} precision (${language})`);
    const panel = desktop.match(/<div class="forecast-table">[\s\S]*?<\/div>\s*<div class="plan-actions">/)?.[0] || desktop;
    ["forecast.revenue", "forecast.totalCosts", "forecast.netResult", "forecast.treasury", "forecast.served", "forecast.staffUse"].forEach((key) => {
      const label = ClinicTest.planRowLabel(key);
      if (!details.includes(label)) throw new Error(`The mobile plan drawer drops "${label}" (${language}/${precision})`);
      if (!panel.includes(label)) throw new Error(`The desktop plan panel drops "${label}" (${language}/${precision})`);
    });
  });
});
ClinicTest.renderState(stateBeforePlanRowTests);

// A link and a click must land on the same screen. applyRoute did not fold the legacy per-person
// drawers into the person hub the way openDrawer does, so the workbook's own link opened a
// different, untabbed screen than the button next to it.
const WORKBOOK_LINKS = ["#overview", "#business/finance", "#care", "#care/services/core/vaccination", "#team", "#team/staffAllocation/support-maya"];
WORKBOOK_LINKS.forEach((link) => {
  const route = ClinicTest.parseRoute(link);
  if (!route.domain) throw new Error(`The workbook link ${link} does not name a real area`);
  ClinicTest.applyRoute(route);
  const landed = ClinicTest.routeFor();
  const again = ClinicTest.parseRoute(landed);
  ClinicTest.applyRoute(again);
  if (ClinicTest.routeFor() !== landed) throw new Error(`The workbook link ${link} does not settle: ${landed} then ${ClinicTest.routeFor()}`);
});
ClinicTest.applyRoute(ClinicTest.parseRoute("#team/staffAllocation/support-maya"));
const viaLink = ClinicTest.routeFor();
ClinicTest.openDrawer("staffAllocation", "support-maya");
if (ClinicTest.routeFor() !== viaLink) throw new Error(`The workbook link and the button must open one screen: ${viaLink} vs ${ClinicTest.routeFor()}`);

// Friday's proposal is financed by a 30 000 € loan. Without it the exercise cannot be modelled.
const financeHtml = ClinicTest.renderUiForTest({ drawer: "finance", drawerContext: null, confirm: null });
[30000, 50000, 100000].forEach((amount) => {
  if (!financeHtml.includes(`%22value%22%3A${amount}%7D`)) throw new Error(`The financing drawer must offer a ${amount} loan`);
});
// Borrowing and selling equipment move cash without passing through costs. Without a treasury row
// a loan reads as pure loss: the interest is charged and the money received appears nowhere.
if (!/Treasury|Trésorerie/.test(financeHtml)) throw new Error("A loan preview must show what it does to the treasury");

// --- "Agir" lands on the thing you came to buy ------------------------------------------------
// The link used to open the drawer at the top of a list, leaving the student to find the room or
// the course themselves — the opposite of what a one-click shortcut is for.
{
  const clinic = ClinicTest.initialState("balanced", "en");
  const surgery = ClinicTest.data.services.find((service) => service.id === "surgery");
  const missing = ClinicTest.missingRequirements(surgery, clinic);
  if (!missing.length) throw new Error("Surgery should still be missing requirements in a fresh balanced clinic");
  const list = ClinicTest.requirementList(surgery, clinic);
  missing.forEach((reason) => {
    if (!list.includes(`data-focus="${reason.id}"`)) throw new Error(`"Address this" must carry the missing item ${reason.id}, or it opens a list to scroll`);
  });
  // A missing skill needs a person before it can be acted on, so the link carries one.
  const skill = missing.find((reason) => reason.type.includes("Skill"));
  if (skill && !/data-focus="[^"]*"\s+data-context="/.test(list)) throw new Error("A missing skill must carry the person who would learn it");

  // The wanted card comes first and is marked, in every drawer the link can reach.
  [["rooms", "surgery"], ["equipment", "orthopedicKit"], ["training", "surgery"]].forEach(([drawer, id]) => {
    const html = ClinicTest.renderUiForTest({ drawer, drawerContext: drawer === "training" ? "support-maya" : null, confirm: null, focusItem: id });
    if (!html.includes("data-target-card")) throw new Error(`The ${drawer} drawer must mark the card the student was sent to`);
    const cards = html.match(/<article[^>]*class="choice-card[^"]*"/g) || [];
    if (!cards.length) throw new Error(`The ${drawer} drawer renders no choice cards`);
    if (!/^<article data-target-card/.test(cards[0])) throw new Error(`The card the student was sent to must come first in ${drawer}, not buried in the list`);
  });
  // Without a target, nothing is marked and the original order is kept.
  const plain = ClinicTest.renderUiForTest({ drawer: "rooms", drawerContext: null, confirm: null, focusItem: null });
  if (plain.includes("data-target-card")) throw new Error("Opening a drawer normally must not mark any card");
}

// --- The verdict must follow the clinic, not the calendar -------------------------------------
// endState was decided by the year counter alone, so four years of doing nothing ended balanced at
// -89,389 € under a green tick reading "Target year complete", with the treasury shown nowhere.
["balanced", "rescue"].forEach((scenario) => {
  ClinicTest.renderState(ClinicTest.initialState(scenario, "en"));
  for (let year = 0; year < 4; year += 1) ClinicTest.resolveTurn();
  const finished = ClinicTest.getState();
  if (!(finished.treasury < 0)) throw new Error(`${scenario} was expected to end insolvent when nothing is done; this test no longer exercises the case`);
  if (finished.endState.type === "success") throw new Error(`${scenario} ends at ${Math.round(finished.treasury)} and must not be reported as a success`);
  const modal = document.querySelector("#app").innerHTML;
  if (!/Final treasury/.test(modal)) throw new Error("The end modal must show the treasury the verdict is based on");
  if (!/insolvent/i.test(modal)) throw new Error("The end modal must say the clinic is insolvent, not only show a symbol");
});
// A clinic that ends solvent at the target year is still a success.
{
  ClinicTest.renderState(ClinicTest.initialState("growth", "en"));
  for (let year = 0; year < 4; year += 1) ClinicTest.resolveTurn();
  const finished = ClinicTest.getState();
  if (finished.treasury < 0) throw new Error("growth was expected to end solvent; this test no longer exercises the case");
  if (finished.endState.type !== "success") throw new Error("A solvent clinic reaching the target year must still be a success");
}
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));

// --- The hiring pool must not be one person deep -----------------------------------------------
// Every skill but `general` used to have exactly one source candidate, so firing that person took
// the skill off the market for a year (rehireBlocked). Three fields have no default and break
// loudly or silently if a new candidate omits them.
{
  const pool = ClinicTest.data.candidates;
  pool.forEach((candidate) => {
    if (candidate.expectedSalary === undefined) throw new Error(`${candidate.id} has no expectedSalary: it could never be hired and would not even be listed`);
    if (candidate.postingFee === undefined) throw new Error(`${candidate.id} has no postingFee: one-time costs would become NaN`);
    if (!Array.isArray(candidate.skills)) throw new Error(`${candidate.id} has no skills array: the applicant list would throw while rendering`);
  });
  // Every skill needs a second route. `general` cannot be trained, so it needs several hires;
  // everything else is dual-sourced by hiring, by training, or both.
  const trainable = new Set(Object.keys(ClinicTest.data.trainings));
  Object.keys(ClinicTest.data.skills).forEach((skill) => {
    const hires = pool.filter((candidate) => candidate.skills.includes(skill)).length;
    const routes = hires + (trainable.has(skill) ? 1 : 0);
    if (routes < 2) throw new Error(`"${skill}" has only one route into the clinic (${hires} candidates, trainable: ${trainable.has(skill)})`);
    if (skill === "general" && hires < 2) throw new Error("`general` cannot be trained, so it needs more than one candidate offering it");
  });
  // Each candidate must be able to work the service they are pitched for, or their hours are
  // blocked on arrival.
  const byId = Object.fromEntries(ClinicTest.data.services.map((service) => [service.id, service]));
  pool.forEach((candidate) => {
    const service = byId[candidate.primaryService];
    if (!service) throw new Error(`${candidate.id} names a service that does not exist: ${candidate.primaryService}`);
    if (candidate.role === "support" && !(service.supportShare > 0)) throw new Error(`${candidate.id} is support but ${service.id} has no support work; the allocation would be dropped silently`);
    const required = candidate.role === "vet" ? service.vetSkills : service.supportSkills;
    required.forEach((skill) => {
      if (!candidate.skills.includes(skill)) throw new Error(`${candidate.id} lacks "${skill}" for ${service.id}: their hours would arrive blocked`);
    });
  });
  // The default vacancy budget used to reveal exactly one vet, so the specialists looked absent.
  const affordable = pool.filter((candidate) => candidate.role === "vet" && candidate.expectedSalary <= 60000);
  if (affordable.length < 2) throw new Error(`Only ${affordable.length} vet is visible at the default 60,000 budget; the pool reads as empty`);
}

// --- "Exact figures" must mean exact ---------------------------------------------------------
// The plan panel's End treasury used to come in above the realised figure, always. The forecast
// clips demand at capacity BEFORE the class-seeded swing is applied, so an upward swing bought
// nothing while a downward swing cost money: over 300 class codes the largest year-3 gap was
// exactly 0.00 €. In exact mode the swing is now off on both sides.
["", "VET-1", "GRP7"].forEach((classCode) => {
  const setup = ClinicTest.initialState("balanced", "en");
  setup.setup.classCode = classCode;
  setup.setup.forecastPrecision = "exact";
  ClinicTest.renderState(setup);
  for (let year = 1; year <= 4; year += 1) {
    const projected = ClinicTest.simulatePlan(ClinicTest.pendingActions()).financial.treasury;
    ClinicTest.resolveTurn();
    const realised = ClinicTest.getState().treasury;
    if (Math.abs(realised - projected) > 0.01) throw new Error(`With exact figures the year must land on its own forecast: class "${classCode}" year ${year} projected ${projected}, got ${realised}`);
  }
});
// ...but the variance itself must survive where it is the lesson.
{
  const varied = ClinicTest.initialState("balanced", "en");
  varied.setup.classCode = "VET-1";
  varied.setup.forecastPrecision = "ranges";
  ClinicTest.renderState(varied);
  let sawADifference = false;
  for (let year = 1; year <= 4; year += 1) {
    const projected = ClinicTest.simulatePlan(ClinicTest.pendingActions()).financial.treasury;
    ClinicTest.resolveTurn();
    if (Math.abs(ClinicTest.getState().treasury - projected) > 0.01) sawADifference = true;
  }
  if (!sawADifference) throw new Error("Ranges mode must keep the demand variance; it was deleted globally rather than gated on the precision setting");
}
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));

// --- Hours parked on closed services must be named where they are edited --------------------
// A fresh clinic assigns its support person entirely to services that are not open. That is the
// Monday lesson and it stays — but the drawer used to call it "100% assigned" in a positive tone
// while the workload underneath read 0%. The same applies to a new hire, who lands on the
// specialist service they were recruited for, before it exists.
{
  const fresh = ClinicTest.initialState("balanced", "en");
  ClinicTest.renderState(fresh);
  const drawer = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "support-maya", confirm: null });
  if (!drawer.includes("closed-hours")) throw new Error("The allocation drawer must say when a person's hours sit on closed services");
  if (!/assigned to services that are not open/.test(drawer)) throw new Error("The closed-hours warning must name what is wrong");
  ["Vaccination", "Preventive care"].forEach((name) => {
    if (!drawer.includes(name)) throw new Error(`The closed-hours warning must name the service: ${name}`);
  });
  // ...and must fall silent once the services are open, or it becomes noise.
  const open = ClinicTest.initialState("balanced", "en");
  open.services.vaccination.active = true;
  open.services.preventive.active = true;
  ClinicTest.renderState(open);
  const quiet = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "support-maya", confirm: null });
  if (quiet.includes("closed-hours")) throw new Error("With every assigned service open, the warning must not appear");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// The relations drawer is an action on the team, not a setting: it belongs beside "Plan training",
// not in the settings menu whose other rows each name the option you are currently on.
{
  const team = ClinicTest.initialState("balanced", "en");
  team.domain = "team";
  const html = ClinicTest.renderState(team);
  const menu = html.match(/<div class="operation-rows">[\s\S]*?<\/div>/)?.[0] || "";
  if (menu.includes('data-open-drawer="relations"')) throw new Error("The relations drawer is an action, not a setting; it must not sit in the operations menu");
  if (!/Act on climate and trust/.test(html)) throw new Error("The team page must offer the climate and trust actions by name");
  if (/Climate \d+ · Trust \d+/.test(menu)) throw new Error("The settings menu must not carry forecast numbers; the Overview cards already show them with their thresholds");
}

// --- Staff climate and client trust must be things you can act on ----------------------------
// Four social actions were fully built — costs, effects, a reducer, an action label, a click
// handler — and no screen ever rendered a button for them, so students could watch the two
// indicators move and had no direct way to change either.
["en", "fr"].forEach((language) => {
  ClinicTest.renderState(ClinicTest.initialState("balanced", language));
  const html = ClinicTest.renderUiForTest({ drawer: "relations", drawerContext: null, confirm: null });
  const cards = html.match(/<article[^>]*class="choice-card[^"]*"/g) || [];
  if (cards.length !== Object.keys(ClinicTest.data.socialActions).length) throw new Error(`Every social action needs a card a student can press (${language}): ${cards.length} of ${Object.keys(ClinicTest.data.socialActions).length}`);
  Object.keys(ClinicTest.data.socialActions).forEach((id) => {
    if (!html.includes(`%22targetId%22%3A%22${id}%22`)) throw new Error(`"${id}" is defined in the model but no button offers it (${language})`);
  });
  // Each one must visibly move something, or it reads as a decision that does nothing.
  const climate = language === "en" ? "Staff climate" : "Climat de l’équipe";
  const trust = language === "en" ? "Client trust" : "Confiance des clients";
  const referral = language === "en" ? "Referral support" : "Soutien des référents";
  [climate, trust, referral].forEach((label) => {
    if (!html.includes(label)) throw new Error(`The team-and-clients drawer must show ${label} moving, or its action looks inert (${language})`);
  });
});
// The drawer has to be reachable from the Team page, not only by typing a URL.
{
  const team = ClinicTest.initialState("balanced", "en");
  team.domain = "team";
  if (!ClinicTest.renderState(team).includes('data-open-drawer="relations"')) throw new Error("Team and clients must be offered on the Team page");
}
// The drawer context comes from the hash, so a typo must not take the whole app down.
{
  ClinicTest.applyRoute(ClinicTest.parseRoute("#business/marketing/typo"));
  ClinicTest.renderUiForTest({});
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// --- Variable costs are readable, and the three buckets still add up -------------------------
// The workbook's Tuesday exercise is `coûts fixes = coûts totaux − coûts variables`, done on
// screen. Both operands must be on the Business page, in both languages.
["en", "fr"].forEach((language) => {
  const base = ClinicTest.initialState("balanced", language);
  base.domain = "business";
  const html = ClinicTest.renderState(base);
  const label = language === "en" ? "Variable costs" : "Coûts variables";
  const total = language === "en" ? "Total costs" : "Coûts totaux";
  if (!html.includes(label)) throw new Error(`The Business page must show ${label}: the workbook tells students to read it there`);
  if (!html.includes(total)) throw new Error(`The Business page must show ${total}`);
  const perCase = language === "en" ? /per case treated/ : /par cas traité/;
  if (!perCase.test(html)) throw new Error(`Variable costs must say how they scale with the number of cases (${language})`);
  // Overtime sits in neither bucket, so the subtraction is only exact while it is zero. Disclose it
  // exactly when it exists, and stay silent otherwise.
  const quiet = language === "en" ? /incl\. .* of overtime/ : /dont .* d’heures supplémentaires/;
  if (quiet.test(html)) throw new Error(`With no overtime the Total costs card must not mention it (${language})`);
});
// totalCosts = variableCosts + fixedCosts + overtimeCost. Nothing may quietly join or leave a
// bucket: that identity is what makes the students' subtraction honest.
{
  const clinic = ClinicTest.initialState("balanced", "en");
  const run = ClinicTest.simulateYear(ClinicTest.clone(clinic), clinic, ClinicTest.emptyEffects(), []);
  const f = run.financial;
  const gap = f.totalCosts - f.variableCosts - f.fixedCosts - f.overtimeCost;
  if (Math.abs(gap) > 0.01) throw new Error(`Total costs must be variable + fixed + overtime; ${gap} is unaccounted for`);
}

// --- Undoing a year -------------------------------------------------------------------------
// The model has no random generator, so undoing a year and passing it again must reproduce it
// exactly. If this ever fails, something non-deterministic has entered the model.
const undoStart = ClinicTest.initialState("balanced", "en");
undoStart.setup.classCode = "UNDO7";
ClinicTest.renderState(undoStart);
ClinicTest.queueAction("service:vaccination", { kind: "toggle-service", targetId: "vaccination", value: true });
ClinicTest.resolveTurn();
const afterFirstPass = JSON.stringify(ClinicTest.getState());
if (!ClinicTest.getState().undo) throw new Error("Passing a year must leave a snapshot to undo");
if (!ClinicTest.undoYear()) throw new Error("undoYear must report that it restored the year");
const undone = ClinicTest.getState();
if (undone.undo) throw new Error("An undo consumes its snapshot; there is no second step back");
if (undone.year !== 1) throw new Error(`Undo must return to the year that was passed, not ${undone.year}`);
if (undone.history.length !== 0) throw new Error("Undo must drop the year's report from the history");
if (!Object.keys(undone.pending).length) throw new Error("Undo must hand the team back the plan they had queued");
ClinicTest.resolveTurn();
const afterSecondPass = JSON.stringify(ClinicTest.getState());
const scrub = (json) => JSON.parse(json, (key, value) => (key === "at" || key === "updatedAt" || key === "queuedAt" || key === "confirmedAt" ? null : value));
if (JSON.stringify(scrub(afterFirstPass).history) !== JSON.stringify(scrub(afterSecondPass).history)) throw new Error("Passing the same year twice must produce the same result — the model is no longer deterministic");
// The snapshot must stay flat. Letting `history` or a nested `undo` in makes the save grow by a
// full year's report every year, which is what excluding them prevents.
const snapshotSize = JSON.stringify(ClinicTest.getState().undo.snapshot).length;
if (snapshotSize > 8000) throw new Error(`The undo snapshot must stay flat, not ${snapshotSize} bytes — is history or a nested undo leaking in?`);
if (ClinicTest.getState().undo.snapshot.history !== undefined) throw new Error("The undo snapshot must not carry the history");
if (ClinicTest.getState().undo.snapshot.undo !== undefined) throw new Error("The undo snapshot must not nest the previous snapshot");

// An undo restores the clinic but never erases the record of it.
const logged = ClinicTest.getState();
const undoEntries = logged.decisionLog.filter((entry) => entry.event === "undo-year");
if (undoEntries.length !== 1) throw new Error("Every undo must be written to the decision log");
if (!ClinicTest.buildPrintableReportHtml().includes("year undone")) throw new Error("The instructor's report must show that a year was undone");

// A grant announced after the year was passed sits outside the snapshot; restoring must re-apply
// it rather than silently deleting money the cash log still claims was given.
ClinicTest.resolveTurn();
const beforeGrant = ClinicTest.getState().treasury;
ClinicTest.adjustCash(12000, "grant");
if (ClinicTest.getState().treasury !== beforeGrant + 12000) throw new Error("A cash adjustment must reach the treasury");
const cashLogLength = ClinicTest.getState().cashLog.length;
const snapshotTreasury = ClinicTest.getState().undo.snapshot.treasury;
ClinicTest.undoYear();
const restored = ClinicTest.getState();
if (restored.cashLog.length !== cashLogLength) throw new Error("Undo must keep the cash log");
if (!restored.cashLog.some((entry) => entry.amount === 12000)) throw new Error("Undo must keep the grant that was announced after the pass");
// ...and the money itself must still be there. The snapshot predates the grant, so without the
// re-apply the treasury would quietly lose 12 000 while the log went on claiming it was given.
if (restored.treasury !== snapshotTreasury + 12000) throw new Error(`Undo must re-apply a cash adjustment made after the pass: expected ${snapshotTreasury + 12000}, got ${restored.treasury}`);
// Leave the harness on a clean state: these tests changed scenario, class code and year.
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));

// --- Settings survive a restart -------------------------------------------------------------
// The instructor's block already survived; the rules of play did not, so every restart silently
// went back to 3 actions, year 4 and a -200 000 threshold whatever the class had been told.
const configured = ClinicTest.initialState("balanced", "en");
configured.rules = { actionLimit: 6, unlimited: true, targetYear: 8, bankruptcyThreshold: -50000 };
configured.setup = { ...configured.setup, forecastPrecision: "ranges", classCode: "GRP7", studyGroup: "S2", startingTreasury: 120000, customTreasury: true };
configured.playerTeam = { teamCode: "TEAM9" };
configured.treasury = 120000;
ClinicTest.renderState(configured);
ClinicTest.resetScenario();
const sameScenario = ClinicTest.getState();
if (sameScenario.rules.actionLimit !== 6 || sameScenario.rules.unlimited !== true || sameScenario.rules.targetYear !== 8 || sameScenario.rules.bankruptcyThreshold !== -50000) throw new Error("A restart must keep the rules of play the instructor set");
if (sameScenario.setup.forecastPrecision !== "ranges" || sameScenario.setup.classCode !== "GRP7" || sameScenario.setup.studyGroup !== "S2") throw new Error("A restart must keep the instructor's game setup");
if (sameScenario.playerTeam.teamCode !== "TEAM9") throw new Error("A restart must keep the team code, or the export stops being attributable");
if (sameScenario.treasury !== 120000) throw new Error(`Restarting the same scenario must keep the starting cash that was set, not ${sameScenario.treasury}`);
if (sameScenario.year !== 1 || sameScenario.history.length) throw new Error("A restart must return to year 1");

// A *different* scenario is a different opening position, so the custom starting cash is released.
ClinicTest.renderState(configured);
ClinicTest.resetScenario("rescue");
const other = ClinicTest.getState();
if (other.rules.actionLimit !== 6 || other.setup.classCode !== "GRP7" || other.setup.forecastPrecision !== "ranges") throw new Error("Choosing another scenario must still keep the rules and the class seed");
if (other.setup.customTreasury !== false) throw new Error("Choosing another scenario must release the custom starting cash");
if (other.treasury !== ClinicTest.data.scenarios.rescue.treasury) throw new Error(`Choosing another scenario must use its own starting cash, not ${other.treasury}`);
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));

// --- Closing a drawer returns you where you came from ---------------------------------------
// Opening a drawer moves the page behind it to the drawer's own area, which is deliberate and
// tested above. What was wrong is that closing left the student on that area instead of the screen
// they started from — so the drawer's own home became a place they never chose to be.
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
if (ClinicTest.getState().domain !== "overview") throw new Error("A fresh clinic starts on the overview");
ClinicTest.openDrawer("services", null, "vaccination");
if (ClinicTest.getState().domain !== "care") throw new Error("Opening a service drawer should move the page to Care & facilities");
ClinicTest.closeDrawer();
if (ClinicTest.getState().domain !== "overview") throw new Error("Closing a drawer must return to the screen it was opened from");
if (ClinicTest.routeFor() !== "#overview") throw new Error(`Closing must leave the route on the origin, not ${ClinicTest.routeFor()}`);

// A drawer that replaces another steps back one at a time: buying the missing room must return to
// the service that sent you, or the student believes they opened it when they only bought the room.
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
ClinicTest.openDrawer("services", null, "vaccination");
const serviceRoute = ClinicTest.routeFor();
ClinicTest.openDrawer("rooms");
ClinicTest.closeDrawer();
if (ClinicTest.routeFor() !== serviceRoute) throw new Error(`Closing the room drawer must return to the service card, not ${ClinicTest.routeFor()}`);
// ...and closing again leaves the chain entirely.
ClinicTest.closeDrawer();
if (ClinicTest.getState().domain !== "overview") throw new Error("Closing the last drawer must return to the screen the chain began on");

// The same chain on the team side: the capability matrix must come back after training someone.
ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
ClinicTest.openDrawer("capabilities");
const matrixRoute = ClinicTest.routeFor();
ClinicTest.openDrawer("person", "support-maya", "training");
ClinicTest.closeDrawer();
if (ClinicTest.routeFor() !== matrixRoute) throw new Error(`Closing the person drawer must return to the capability matrix, not ${ClinicTest.routeFor()}`);

ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));



const helpState = ClinicTest.getState();
helpState.helpOpen = true;
const helpHtml = ClinicTest.renderState(helpState);
if (!helpHtml.includes("open services only")) throw new Error("The glossary must say requests count open services only");
helpState.helpOpen = false;
ClinicTest.renderState(helpState);


// --- Pass 7 Phase 0: one quantity, one name, everywhere ---
// Renders every page and drawer in both languages and fails if a retired name reappears.
// --- One quantity, one name -------------------------------------------------------------------
// A denylist of retired names cannot catch a SECOND name nobody has thought of yet — and it was
// case-sensitive, which is how a lowercase "revenus" survived the last cleanup. This is an
// allowlist instead: every label rendered into a label slot must be a name we chose on purpose.
const CANONICAL = [
  { id: "financial.revenue", en: "Revenue", fr: "Recettes", aliases: ["Revenus"] },
  { id: "financial.variableCosts", en: "Variable costs", fr: "Coûts variables", aliases: ["Direct costs", "Coûts directs", "Supplies", "Fournitures", "External purchases", "Achats externes"] },
  { id: "financial.totalCosts", en: "Total costs", fr: "Coûts totaux", aliases: [] },
  { id: "financial.netResult", en: "Net result", fr: "Résultat net", aliases: ["Financial result", "Résultat financier", "Net cash this year"] },
  { id: "financial.treasury", en: "End treasury", fr: "Trésorerie finale", aliases: ["Closing treasury", "Tresorerie de cloture"] },
  { id: "financial.oneTimeCosts", en: "One-time costs", fr: "Coûts ponctuels", aliases: ["One-time investments", "Investissements ponctuels"] },
  { id: "financial.overtimeCost", en: "Overtime", fr: "Heures supplémentaires", aliases: ["Overtime pay and charges", "Heures supplémentaires et charges"] },
  { id: "financial.operating", en: "Operating costs", fr: "Coûts d’exploitation", aliases: ["Operations", "Opérations"] },
  { id: "carbon.total", en: "Carbon footprint", fr: "Empreinte carbone", aliases: ["Total footprint", "Empreinte totale"] },
  { id: "operational.totalHonored", en: "Cases served", fr: "Cas traités", aliases: ["Requests served", "Care delivered", "Soins realises", "Demandes traitees"] },
  { id: "operational.staffUse", en: "Team workload", fr: "Charge de l’équipe", aliases: ["Staff use", "Clinic workload", "Utilisation du personnel", "Charge de la clinique"] },
  { id: "operational.mainConstraint", en: "Main constraint", fr: "Contrainte principale", aliases: ["Main service constraint", "Contrainte principale des services"] },
  { id: "social.staffClimate", en: "Staff climate", fr: "Climat de l’équipe", aliases: ["Climat de travail"] },
  { id: "social.clientTrust", en: "Client trust", fr: "Confiance des clients", aliases: [] }
];
const ALL_DOMAINS = ["overview", "care", "team", "business", "sustainability", "results"];
const ALL_DRAWERS = ["services", "rooms", "equipment", "person", "staffAllocation", "staffPerson", "staffExit", "training", "capabilities", "hoursByService", "recruitment", "opening", "dropoff", "stock", "hr", "pricing", "finance", "market", "location", "marketing", "sustainability", "plan", "export", "setup"];
const stripAccents = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Labels that live in the same slots but do not name a model quantity. Anything not here and not
// canonical fails, which is the whole point: adding a new label has to be a deliberate act.
const NOT_A_QUANTITY = new Set([
  "Salaries", "Salaires", "Employer charges", "Charges sociales", "Facilities", "Installations",
  "Administration", "Frais d’administration", "Payroll and charges", "Salaires et charges",
  "Payroll, charges and overtime", "Salaires, charges et heures supplémentaires",
  "Loan interest", "Intérêts d’emprunt", "Tax", "Impôt", "Per treated case", "Par cas traité",
  "Largest cost", "Coût principal", "Largest carbon source", "Principale source de carbone",
  "Available hours", "Heures disponibles", "Hours used", "Heures utilisées",
  "Unused hours", "Heures inutilisées", "Blocked hours", "Heures bloquées",
  "Overtime hours", "Heures supplémentaires travaillées",
  "Overtime cost", "Coût des heures supplémentaires",
  "This person’s workload", "Charge de cette personne",
  "Referral support", "Soutien des référents", "Access pressure", "Pression d’accès",
  "Demand vs forecast", "Demande par rapport à la prévision",
  "Lost to stock-outs", "Perdus par rupture de stock",
  "Scenario target", "Objectif du scénario", "Main source", "Source principale",
  "Reputation", "Réputation", "Clients", "Starting treasury", "Trésorerie de départ",
  "Active services", "Services actifs", "Rooms", "Salles",
  "Veterinary hours available", "Heures vétérinaires disponibles",
  "Support hours available", "Heures de soutien disponibles",
  "Unused team hours", "Heures d’équipe inutilisées",
  "Largest source", "Source principale",
  // the carbon sources, which name where the footprint comes from rather than a quantity
  "Clinical care", "Soins cliniques", "Clinical equipment", "Équipement clinique",
  "Building and energy", "Bâtiment et énergie", "Client travel", "Déplacements des clients",
  "Materials and waste", "Matériaux et déchets"
]);

const LABEL_SLOTS = [
  /<article class="metric-card[^"]*"><span>([^<]*)<\/span>/g,
  /<div class="consequence-grid"[^>]*>(?:<div><span>([^<]*)<\/span>)/g,
  /<div class="consequence-grid"[^>]*>[\s\S]*?<\/div><\/div>/g,
  /<div class="forecast-row[^"]*"><strong>([^<]*)<\/strong>/g,
  /<div class="comparison-list"[^>]*>[\s\S]*?<\/div><\/div>/g,
  /<div class="summary-grid"><p><span>([^<]*)<\/span>/g
];

function extractLabels(html) {
  const labels = [];
  for (const match of html.matchAll(/<article class="metric-card[^"]*"><span>([^<]*)<\/span>/g)) labels.push(match[1]);
  for (const match of html.matchAll(/<div class="forecast-row[^"]*"><strong>([^<]*)<\/strong>/g)) labels.push(match[1]);
  for (const block of html.matchAll(/<div class="consequence-grid"[^>]*>([\s\S]*?)<\/div>(?=<\/div>|<p|$)/g)) {
    for (const cell of block[1].matchAll(/<span>([^<]*)<\/span>/g)) labels.push(cell[1]);
  }
  for (const block of html.matchAll(/<div class="comparison-list"[^>]*>([\s\S]*?)<\/div>(?=<\/div>|<p|$)/g)) {
    for (const cell of block[1].matchAll(/<strong>([^<]*)<\/strong>/g)) labels.push(cell[1]);
  }
  for (const grid of html.matchAll(/<div class="summary-grid">([\s\S]*?)<\/div>/g)) {
    for (const cell of grid[1].matchAll(/<p><span>([^<]*)<\/span>/g)) labels.push(cell[1]);
  }
  return labels.map((label) => label.trim()).filter(Boolean);
}

const decode = (text) => text.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

["en", "fr"].forEach((language) => {
  const base = ClinicTest.initialState("balanced", language);
  Object.keys(base.services).forEach((id) => { base.services[id].active = true; });
  base.history = [ClinicTest.simulateYear(ClinicTest.clone(base), base, ClinicTest.emptyEffects(), [])];
  let seen = "";
  ALL_DOMAINS.forEach((domain) => { const next = ClinicTest.clone(base); next.domain = domain; seen += ClinicTest.renderState(next); });
  ClinicTest.renderState(base);
  ALL_DRAWERS.forEach((drawer) => { seen += ClinicTest.renderUiForTest({ drawer, drawerContext: null, selectedServiceId: "surgery", confirm: null }); });
  seen += ClinicTest.buildPrintableReportHtml();

  const names = new Set(CANONICAL.map((row) => row[language]));
  const labels = extractLabels(seen).map(decode);
  // A broken regex must fail loudly rather than pass by finding nothing.
  if (labels.length < 40) throw new Error(`Label extraction found only ${labels.length} labels in ${language}; the slot patterns are broken`);

  // (a) Closure: every label is a name we chose, or explicitly not a quantity. This is what fails
  // when someone introduces a second name for something that already has one.
  labels.forEach((label) => {
    if (names.has(label) || NOT_A_QUANTITY.has(label)) return;
    if (/^[\d\s+\-–—.,%€/…]*$/.test(label)) return;
    throw new Error(`Unknown label "${label}" reached a label slot in ${language}. If it names a model quantity, add it to CANONICAL; if not, add it to NOT_A_QUANTITY. Do not invent a second name for a quantity that already has one.`);
  });

  // (b) Coverage: a canonical name that appears nowhere has silently disappeared — which is exactly
  // how clinic-wide variable costs stayed off every screen.
  ["financial.revenue", "financial.totalCosts", "financial.variableCosts", "financial.netResult", "operational.totalHonored", "carbon.total"].forEach((id) => {
    const row = CANONICAL.find((item) => item.id === id);
    if (!seen.includes(row[language])) throw new Error(`"${row[language]}" no longer appears anywhere in ${language}: a quantity has gone missing from the interface`);
  });

  // (c) Alias ban. Canonical names are stripped first, so "Carbone" can be banned while
  // "Empreinte carbone" is the name we keep.
  let haystack = stripAccents(seen);
  CANONICAL.forEach((row) => { haystack = haystack.split(stripAccents(row[language])).join(" "); });
  CANONICAL.forEach((row) => {
    row.aliases.forEach((alias) => {
      if (haystack.includes(stripAccents(alias))) throw new Error(`Retired name "${alias}" still reaches the screen in ${language}: ${row.id} must carry one name everywhere`);
    });
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
