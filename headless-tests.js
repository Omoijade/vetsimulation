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
if (!/<div class="needs"[\s\S]*?<span class="need-tag">✗ /.test(roomsHtml)) throw new Error("Room previews must mark what a purchase still needs before it serves cases");
if (/No effect on cases yet|still needs|longer-term indicators rather than/.test(roomsHtml)) throw new Error("Room previews mark what is missing; they do not explain it in a sentence");
const fullState = ClinicTest.getState();
fullState.domain = "care";
fullState.rooms.consult = 1;
fullState.services.vaccination.active = true;
fullState.services.preventive.active = true;
fullState.pending = {};
const fullCare = ClinicTest.renderState(fullState);
if (!/<article class="full"><div class="facility-head"><strong>Consult room<\/strong><span>[\d,]+ \/ [\d,]+ h · (9[5-9]|100)%/.test(fullCare)) throw new Error("Care page must show a nearly full room by its measured use");
if (/refused here|>Full</.test(fullCare)) throw new Error("Before the year is passed, the care page measures the room; it does not say what it refuses");
const serviceFamilies = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: null, selectedServiceId: null, confirm: null });
if (!serviceFamilies.includes("1 service")) throw new Error("English service singular/plural is incorrect");
const serviceRows = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: null, confirm: null });
if (!serviceRows.includes("Select one service") || serviceRows.includes("What this choice changes")) throw new Error("Service family expands more than compact rows");
const selectedService = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: "consult", confirm: null });
if ((selectedService.match(/What this choice changes/g) || []).length !== 1) throw new Error("Selected service must show exactly one consequence panel");
if (/elasticity|contribution\/case|geomarketing|kWh\/case/i.test(selectedService)) throw new Error("Selected service exposes beginner-facing technical jargon");
const carbonDrawer = ClinicTest.renderUiForTest({ drawer: "sustainability", drawerContext: "building", confirm: null });
if (!carbonDrawer.includes("What this choice changes")) throw new Error("Sustainability choices lack consequence previews");
const pricingState = ClinicTest.getState();
pricingState.domain = "business";
const businessHtml = ClinicTest.renderState(pricingState) + ClinicTest.renderUiForTest({ drawer: "pricing", drawerContext: null, confirm: null });
if (/elasticity|contribution\/case|geomarketing|kWh\/case/i.test(businessHtml)) throw new Error("Business decision surfaces expose technical jargon");
const teamState = ClinicTest.getState();
teamState.domain = "team";
const teamHtml = ClinicTest.renderState(teamState);
if (!teamHtml.includes("Change time allocation") || !teamHtml.includes("Paid hours not worked")) throw new Error("Team page does not expose readable staffing-hour choices");
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
if (!trainingPeople.includes("Dr Amina Kone") || trainingPeople.includes("What this choice changes")) throw new Error("Training must start by choosing a person");
const trainingOptions = ClinicTest.renderUiForTest({ drawer: "training", drawerContext: "vet-founder", confirm: null });
if (!trainingOptions.includes("Ultrasound") || trainingOptions.includes("Animal care") || !trainingOptions.includes("Unlocks")) throw new Error("Per-person training shows the wrong role's skills");
const paceService = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: "consult", confirm: null });
if (!paceService.includes("Pace: time per appointment") || !paceService.includes("Who can staff this")) throw new Error("Service detail lacks pace or staffing clarity");
if (!paceService.includes("Vet time per case") || !paceService.includes("Support time per case")) throw new Error("Service detail must show the vet and support time separately");
if (/>Time per case</.test(paceService)) throw new Error("The blended time-per-case stat should be gone");
const overtimeDraft = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "vet-founder", confirm: null, allocationDrafts: { "vet-founder": [{ serviceId: "consult", share: .9 }, { serviceId: "preventive", share: .3 }] } });
// Above 100% the caption used to print two numbers of overtime hours in one breath: the hours an
// over-allocation would buy if every one were worked, and the hours the model forecasts. The larger
// was the fiction. One number, and it is the forecast.
const overtimeCaption = (overtimeDraft.match(/<div class="allocation-total[^"]*"><strong>([^<]*)<\/strong>/) || ["", ""])[1];
if (!overtimeCaption.includes("120% assigned") || !overtimeCaption.includes("maximum 130%")) throw new Error(`Above 100% the caption must give the assignment and the ceiling: "${overtimeCaption}"`);
if (!/overtime forecast: 0 h/.test(overtimeCaption)) throw new Error(`The caption must give the overtime the model forecasts: "${overtimeCaption}"`);
if ((overtimeCaption.match(/[\d][\d,. \u00a0\u202f]* h\b/g) || []).length !== 1) throw new Error(`The caption must name one number of overtime hours, not a hypothetical beside a forecast: "${overtimeCaption}"`);
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
{
  const anaes = ClinicTest.data.equipment.anesthesia;
  const upkeep = Math.round(anaes.purchase * anaes.maintenanceRate).toLocaleString("en-GB");
  const recurring = equip.match(/<th>Recurring costs<\/th><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td>/);
  if (!recurring || !recurring[1].includes(upkeep) || !recurring[2].includes(Math.round(anaes.lease).toLocaleString("en-GB"))) throw new Error(`Buying must show the annual upkeep (${upkeep}) and leasing the annual lease, side by side: ${recurring ? recurring.slice(1).join(" | ") : "no row"}`);
}
if (!/Net result/.test(equip) || /Net cash this year/.test(equip)) throw new Error("The preview outcome row must use the app-wide name Net result");

const openDrawer = ClinicTest.renderUiForTest({ drawer: "opening", drawerContext: null, confirm: null });
if (/One-time costs/.test(openDrawer)) throw new Error("A purely recurring decision must not show a one-time cost row");
if (!/Operating costs/.test(openDrawer)) throw new Error("A recurring decision must name the cost line its annual charge lands on");
if (!/€12,000/.test(openDrawer)) throw new Error("The annual charge in the preview must equal the price printed on the card");

const loc = ClinicTest.renderUiForTest({ drawer: "location", drawerContext: null, confirm: null });
if (!/once to move/.test(loc)) throw new Error("Relocation must show its one-time move cost");
if (!/Add parking[\s\S]{0,400}?once/.test(loc)) throw new Error("The parking card must show a price");

// Inspect the preview grids only: the Overview behind the drawer also names staff climate.
const previewGrids = (html) => html.split('class="consequence-grid').slice(1);
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
function hoursGridCells(share, mutate, who = "support-maya", service = "vaccination") {
  const setup = ClinicTest.initialState("balanced", "en");
  setup.services[service].active = true;
  if (mutate) mutate(setup);
  ClinicTest.renderState(setup);
  const html = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: who, confirm: null, allocationDrafts: { [who]: [{ serviceId: service, share }] } });
  const bar = html.match(/<div class="allocation-total[\s\S]*?<div class="hour-bar"[\s\S]*?<\/ul><\/div>/)?.[0];
  if (!bar) throw new Error("The allocation drawer must show where the hours go");
  const num = (t) => Number(String(t).replace(/[^\d]/g, ""));
  const legend = {};
  for (const m of bar.matchAll(/<li><b class="([^" ]+)[^"]*"><\/b>(?:<button[^>]*>)?([^<]*)(?:<\/button>)? <strong>([^<]*)<\/strong><\/li>/g)) legend[m[2].trim()] = { cls: m[1], hours: num(m[3]) };
  const sum = (cls) => Object.values(legend).filter((l) => l.cls === cls).reduce((t, l) => t + l.hours, 0);
  const available = num(bar.match(/class="hb-mark[^"]*"[^>]*><em>([^<]*)<\/em>/)[1]);
  const assigned = num(bar.match(/([\d,]+) h assigned of/)[1]);
  const meter = bar.match(/<strong>([^<]*)</)?.[1] || "";
  return { legend, available, assigned, worked: sum("hb-worked") + sum("hb-covered"), overtime: sum("hb-over"), lost: sum("hb-lost"), free: sum("hb-free"), meter };
}
const lightDraft = hoursGridCells(.2);
const heavyDraft = hoursGridCells(1);
if (lightDraft.worked === heavyDraft.worked) throw new Error("The hours bar must follow the draft, not the saved allocation");
// The bar is one ruler: what was worked, the overtime, each share not worked by its cause, and what
// was not assigned, add up to the larger of available and assigned — exactly, as a student reads it.
const petite = (s) => { s.staff.find((p) => p.id === "support-maya").capacity = 300; };
[[.2, null, "support-maya", "vaccination"], [.65, null, "support-maya", "vaccination"], [1, null, "support-maya", "vaccination"],
 [1.3, null, "support-maya", "vaccination"], [.65, petite, "support-maya", "vaccination"], [1.3, petite, "support-maya", "vaccination"],
 [.4, null, "vet-founder", "dentistry"], [1, null, "vet-founder", "dentistry"]].forEach(([share, mutate, who, service]) => {
  const c = hoursGridCells(share, mutate, who, service);
  const total = c.worked + c.overtime + c.lost + c.free;
  if (Math.abs(total - Math.max(c.available, c.assigned)) > 2) throw new Error(`${who}'s hours bar must add up at ${Math.round(share * 100)}% on ${service}: ${total} against ${Math.max(c.available, c.assigned)}`);
  if (c.worked > c.available) throw new Error(`${who}: worked hours beyond the hours available are overtime, not worked hours`);
  if (c.overtime >= 1 && c.free >= 1) throw new Error(`${who} cannot have overtime and unassigned hours at once`);
  if (c.overtime >= 1 && !c.meter.includes(`overtime forecast: ${c.overtime.toLocaleString("en-GB")} h`)) throw new Error(`The headline must name the overtime the bar shows (${c.overtime} h): "${c.meter}"`);
  if (c.overtime < 1 && /overtime forecast: [1-9]/.test(c.meter)) throw new Error(`No overtime on the bar, yet the headline announces some: "${c.meter}"`);
});
{
  const bloque = hoursGridCells(1, null, "vet-founder", "dentistry");
  if (!(bloque.legend["missing skill"]?.hours > 1)) throw new Error("Hours assigned to a service someone cannot deliver must show as lost to a missing skill");
}
// Worked overtime shows on the bar; none when none is worked.
if (!(hoursGridCells(1.3, petite).overtime > 0)) throw new Error("Overtime hours must appear on the bar when they are worked");
if (hoursGridCells(.65).overtime !== 0) throw new Error("No overtime segment when no overtime is worked");
// The case that started this (owner, 2026-10-19): assigned above 100 % behind a full room is not
// overtime. The card must not announce it, and the bar must name the room as where the hours went.
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn(); ClinicTest.resolveTurn();
  const maya = ClinicTest.getState().staff.find((p) => p.role === "support");
  ClinicTest.queueAction(`staff-allocation:${maya.id}`, { kind: "staff-allocation", targetId: maya.id, value: { allocations: maya.allocations.map((a) => ({ ...a, share: a.share * 1.17 })) } });
  const f = ClinicTest.simulatePlan();
  const row = f.operational.staffRows.find((r) => r.id === maya.id);
  if (!(row.assignedShare > 1.05) || row.overtimeHours >= 1) throw new Error("This check needs a person assigned above 100 % who works no overtime");
  const team = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "team" });
  if (/overtime/.test((team.match(/<p class="staff-zone[^"]*">[^<]*<\/p>/g) || []).join(""))) throw new Error("A card must not announce overtime the model does not pay");
  // Before the year: the hours not worked are shown, not why (that is the diagnosis, given in Résultats).
  if (/room full/.test(team) || !/not worked <strong>[\d,]+<\/strong>/.test(team)) throw new Error("Before the year, the team screen shows hours not worked without naming their cause");
  // The year's constraint is the students' to diagnose: no screen announces it before the year is passed.
  if (/class="constraint-badge"|class="forecast-row constraint"/.test(team)) throw new Error("No screen may announce the main constraint before the year is passed");
}

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
const scrub = (json) => JSON.parse(json, (key, value) => (key === "at" || key === "updatedAt" || key === "queuedAt" || key === "confirmedAt" || key === "passedAt" ? null : value));
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
  "Promise to the municipality", "Promesse à la commune", "Volume kept", "Volume gardé", "A sustainability measure", "Une mesure de durabilité", "Requests", "Demandes", "Carbon per case", "Carbone par cas", "Client households", "Foyers clients", "Requests refused", "Demandes refusées", "Households next year", "Foyers l’an prochain",
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
  "Paid hours not worked", "Heures payées non travaillées",
  "Largest source", "Source principale",
  // the carbon sources, which name where the footprint comes from rather than a quantity
  "Clinical care", "Soins cliniques", "Clinical equipment", "Équipement clinique",
  "Building and energy", "Bâtiment et énergie", "Client travel", "Déplacements des clients",
  "Materials and waste", "Matériaux et déchets"
]);

const LABEL_SLOTS = [
  /<article class="metric-card[^"]*"><span>([^<]*)<\/span>/g,
  /<div class="consequence-grid[^"]*"[^>]*>(?:<div><span>([^<]*)<\/span>)/g,
  /<div class="consequence-grid[^"]*"[^>]*>[\s\S]*?<\/div><\/div>/g,
  /<div class="forecast-row[^"]*"><strong>([^<]*)<\/strong>/g,
  /<div class="comparison-list"[^>]*>[\s\S]*?<\/div><\/div>/g,
  /<div class="summary-grid"><p><span>([^<]*)<\/span>/g
];

function extractLabels(html) {
  const labels = [];
  for (const match of html.matchAll(/<article class="metric-card[^"]*"><span>([^<]*)<\/span>/g)) labels.push(match[1]);
  for (const match of html.matchAll(/<div class="forecast-row[^"]*"><strong>([^<]*)<\/strong>/g)) labels.push(match[1]);
  for (const block of html.matchAll(/<div class="consequence-grid[^"]*"[^>]*>([\s\S]*?)<\/div>(?=<\/div>|<p|$)/g)) {
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
// On the overview the card became one flow — households → requests → cases served (owner,
// 2026-10-19). The same two facts must be read there, inside the strip itself.
const overviewCaption = ((overviewHtml.match(/<section class="flow-strip"[\s\S]*?<\/section>/) || [""])[0]).replace(/<[^>]+>/g, " ");
if (!/of open requests/.test(overviewCaption)) throw new Error("The overview's flow must say the rate is of OPEN requests");
if (!/for services you could open now/.test(overviewCaption) || /not offered/.test(overviewCaption)) throw new Error("The overview's flow must show only the requests the clinic could take on now");
const careStart = ClinicTest.clone(balancedStart); careStart.domain = "care";
const careCaption = servedCaption(ClinicTest.renderState(careStart));
if (!/of open requests/.test(careCaption) || !/for services you could open now/.test(careCaption)) throw new Error("The Care page Cases-served card must show the requests it could take on now");

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
    const previews = (html.match(/class="consequence-grid[^"]*"/g) || []).length;
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

// Moving hours the clinic already pays for is not one of the year's few decisions. A clinic with
// two vets and two support staff needs four reallocations before anything is decided; charging them
// against a three-action limit made the whole middle of the game unreachable.
{
  const limited = ClinicTest.initialState("balanced", "en");
  limited.rules.actionLimit = 3;
  limited.rules.unlimited = false;
  ClinicTest.renderState(limited);
  const realloc = (id, share) => ({ kind: "staff-allocation", targetId: id, value: { allocations: [{ serviceId: "consult", share }] } });
  ["a", "b", "c", "d", "e"].forEach((id, index) => ClinicTest.queueAction(`staff-allocation:${id}`, realloc(id, .5 + index / 20)));
  const reallocations = ClinicTest.pendingActions().filter((action) => action.payload.kind === "staff-allocation").length;
  if (reallocations !== 5) throw new Error(`Reallocating hours must never hit the action limit; only ${reallocations} of 5 were accepted`);
  ["consult", "vaccination", "lab", "surgery"].forEach((id) => ClinicTest.queueAction(`price:${id}`, { kind: "price", targetId: id, value: 51 }));
  const priced = ClinicTest.pendingActions().filter((action) => action.payload.kind === "price").length;
  if (priced !== 3) throw new Error(`The action limit must still bind for real commitments: ${priced} prices queued under a limit of 3`);
  const header = ClinicTest.renderState(ClinicTest.getState());
  if (!header.includes(">3/3<")) throw new Error("The header counter must show only the actions that count against the limit");
}

// Cases carried per person: within one role the people on a service split exactly the cases that
// service honoured — no more, no fewer. Across roles they must NOT add up, because a surgery is one
// case carried by two people, and the team panel has to say so rather than let someone sum them.
{
  const growth = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("growth", "en")));
  const report = ClinicTest.simulateYear(ClinicTest.clone(growth), growth, ClinicTest.emptyEffects(), []);
  const perRole = {};
  report.operational.staffRows.forEach((row) => row.assignments.forEach((assignment) => {
    const key = `${row.role}|${assignment.serviceId}`;
    perRole[key] = (perRole[key] || 0) + assignment.usedHours;
  }));
  let checked = 0;
  report.serviceResults.filter((result) => result.honored > 0).forEach((result) => {
    ["vet", "support"].forEach((role) => {
      const pool = perRole[`${role}|${result.id}`] || 0;
      if (pool <= 1) return;
      const split = report.operational.staffRows.filter((row) => row.role === role)
        .reduce((sum, row) => sum + (ClinicTest.casesCarried(report, row.id).lines.find((line) => line.serviceId === result.id)?.cases || 0), 0);
      checked += 1;
      if (Math.abs(split - result.honored) > .01) throw new Error(`Cases carried must split a service exactly within a role: ${result.id}/${role} gives ${split} against ${result.honored} honoured`);
    });
  });
  if (checked < 3) throw new Error(`The cases-carried split was only checked on ${checked} service/role pairs; the scenario is not exercising it`);
  const shared = ClinicData.services.filter((service) => service.vetShare > 0 && service.supportShare > 0 && growth.services[service.id].active);
  if (!shared.length) throw new Error("The growth scenario should open at least one service needing both roles");
  growth.domain = "team";
  const teamHtml = ClinicTest.renderState(growth);
  if (!teamHtml.includes("<span>Cases carried</span><strong>")) throw new Error("The team panel must show, on each person's card, how many cases their hours carried");
  if (!teamHtml.includes("do not add up across the team")) throw new Error("Showing cases per person without saying they overlap invites a total that is wrong by every shared case");
}

// The prediction loop. A student who only watches an outcome learns little; one who committed and
// was contradicted has nowhere to hide. The question must be about the year AFTER the one being
// passed — the plan panel already forecasts the coming year, so asking about that would be reading
// a row rather than reasoning. The pair must survive into the history and the export.
{
  const pred = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en")));
  ClinicTest.renderState(pred);
  const forecast = ClinicTest.simulatePlan([]);
  const options = ClinicTest.predictionOptions(ClinicTest.getState(), forecast);
  if (options.length < 3) throw new Error(`A prediction needs real alternatives; only ${options.length} offered`);
  if (new Set(options.map((option) => option.key)).size !== options.length) throw new Error("The prediction options must not repeat a constraint");
  if (options.some((option) => !option.label || option.label === option.key)) throw new Error("Every prediction option must carry the same wording the clinic uses to answer");
  // The answer the clinic will give must be expressible as one of the choices offered.
  const answerable = ClinicTest.constraintKey(forecast.operational.mainConstraint);
  if (!options.some((option) => option.key === answerable)) throw new Error(`The clinic's own answer "${answerable}" is not among the options a student can pick`);

  // Commit, resolve, adjudicate, retain.
  ClinicTest.renderUiForTest({ passCheck: true, predictionDraft: "vetHours:" });
  const modal = ClinicTest.renderUiForTest({ passCheck: true, predictionDraft: "vetHours:" });
  if (!modal.includes("data-prediction")) throw new Error("The year-end review must ask for the prediction before the year resolves");
  if (!modal.includes("Year 2")) throw new Error("The prediction must be asked about the year after the one being passed, not the one the plan panel already forecasts");
  ClinicTest.resolveTurn();
  const afterFirst = ClinicTest.getState();
  if (afterFirst.history[0].prediction) throw new Error("A prediction made while passing year 1 is about year 2; it must not be adjudicated against year 1");
  if (afterFirst.prediction?.forYear !== 2) throw new Error("The prediction must be held until the year it speaks about");
  ClinicTest.resolveTurn();
  const resolved = ClinicTest.getState().history[1].prediction;
  if (!resolved) throw new Error("The year the prediction spoke about must carry the adjudication");
  if (resolved.predicted !== "vetHours:") throw new Error("The adjudication must keep what the student actually said");
  if (resolved.actual !== ClinicTest.constraintKey(ClinicTest.getState().history[1].operational.mainConstraint)) throw new Error("The adjudication must compare against the constraint the clinic reported");
  if (resolved.match !== (resolved.predicted === resolved.actual)) throw new Error("The verdict must follow from the two values, not be set separately");
  const results = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "results" });
  if (!results.includes("You predicted")) throw new Error("The results page must show the prediction beside what happened");
  // A verdict that only announces the right answer trains deference to the model, which is the
  // habit this kind of course exists to break. It has to hand back what the clinic was counting,
  // and it has to leave "the model is wrong here" reachable.
  if (!results.includes("Why the clinic answers this")) throw new Error("The verdict must return the clinic's basis, not only its answer");
  if (!results.includes("you have found an edge of the model")) throw new Error("The verdict must make disagreeing with the model on uncounted grounds a finding rather than an error");
  const payload = ClinicTest.buildExportPayload();
  const row = payload.years?.find((year) => year.predictedConstraint);
  if (!row) throw new Error("The prediction and its outcome must leave the instrument in the export; otherwise no trace survives for the facilitator or the researcher");

  // The ranking must be checked on a clinic that actually leaves requests unserved, or the
  // assertion goes quiet exactly where it matters. `balanced` serves everything it offers.
  ClinicTest.renderState(ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("growth", "en"))));
  ClinicTest.resolveTurn();
  ClinicTest.resolveTurn();
  const strained = ClinicTest.getState().history[1];
  const ranking = ClinicTest.constraintBreakdown(strained);
  const unservedTotal = ranking.reduce((sum, row) => sum + row.unserved, 0);
  if (unservedTotal <= 0) throw new Error("This check needs a year with unserved requests; the scenario no longer provides one and the ranking assertion below would pass vacuously");
  if (ranking.length < 2) throw new Error("A ranking of one tells the student nothing about how close the answer was");
  const reported = ClinicTest.constraintKey(strained.operational.mainConstraint);
  if (ranking[0].key !== reported) throw new Error(`The breakdown must rank the same way the clinic does: it leads with ${ranking[0].key}, the clinic reported ${reported}`);
  if (ranking.some((row, index) => index > 0 && row.unserved > ranking[index - 1].unserved)) throw new Error("The breakdown must be ordered by how many requests each constraint cost");
  if (ranking.some((row) => row.services.some((service) => service.unserved <= 0))) throw new Error("The breakdown must only name services that actually lost requests");
}

// Framing is the one judgement in this software that no figure can settle. The same plan is an
// improvement or a loss depending on which quantity is chosen to look at, so the panel shows four
// and refuses to rank them. If they could never disagree the feature would be decoration.
{
  const framed = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en")));
  ClinicTest.renderState(framed);
  const flat = ClinicTest.planFrames(ClinicTest.simulatePlan([]), ClinicTest.simulatePlan([]));
  if (flat.length < 4) throw new Error(`A frame comparison needs several points of view; got ${flat.length}`);
  if (flat.some((frame) => frame.verdict !== "flat")) throw new Error("With no action planned, no point of view may report a change");
  if (new Set(flat.map((frame) => frame.id)).size !== flat.length) throw new Error("Each point of view must be distinct");
  ClinicTest.queueAction("service:vaccination", { kind: "toggle-service", targetId: "vaccination", value: true });
  ClinicTest.queueAction("service:preventive", { kind: "toggle-service", targetId: "preventive", value: true });
  const judged = ClinicTest.planFrames(ClinicTest.simulatePlan([]), ClinicTest.simulatePlan(ClinicTest.pendingActions()));
  const better = judged.filter((frame) => frame.verdict === "better");
  const worse = judged.filter((frame) => frame.verdict === "worse");
  if (!better.length || !worse.length) throw new Error(`Opening two services must improve some points of view and damage another, or framing is not testable here: ${judged.map((f) => f.id + "=" + f.verdict).join(" ")}`);
  if (judged.some((frame) => !frame.detail || !/\d/.test(frame.detail))) throw new Error("Every point of view must return the figure that decided it, so the verdict can be argued with");
  const panel = ClinicTest.renderState(ClinicTest.getState());
  if (!panel.includes("Better or worse — seen from where?")) throw new Error("The frame comparison must sit in the plan panel, beside the decision it judges");
  if (!panel.includes("choosing which one counts is the decision")) throw new Error("When the points of view disagree the software must say it will not choose between them");
}

// A clinic must be able to leave the machine it was made on: Wednesday is done at home, and a
// laptop can fail. The analytical export is not a save file — it drops nineteen state keys —
// so this is a separate file whose only job is to come back identical.
{
  const saved = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("growth", "en")));
  ClinicTest.renderState(saved);
  ClinicTest.queueAction("a", { kind: "toggle-service", targetId: "vaccination", value: true });
  ClinicTest.resolveTurn();
  ClinicTest.resolveTurn();
  const before = ClinicTest.getState();
  const file = { kind: "clinique-sauvegarde", schemaVersion: 8, savedAt: new Date().toISOString(), state: ClinicTest.clone(before) };
  ClinicTest.renderState(ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en"))));
  if (!ClinicTest.chargerClinique(JSON.stringify(file))) throw new Error("A valid save file must load");
  const after = ClinicTest.getState();
  const scrub = (o) => JSON.parse(JSON.stringify(o), (k, v) => (k === "at" || k === "updatedAt" || k === "savedAt" ? null : v));
  // A load adds two things by design: an entry in the decision log, and the replaced run in the
  // archive. Everything else must come back identical.
  const sansChargement = (o) => ({ ...o, runArchive: [], decisionLog: (o.decisionLog || []).filter((e) => e.event !== "load") });
  if (JSON.stringify(scrub(sansChargement(before))) !== JSON.stringify(scrub(sansChargement(after)))) throw new Error("A saved clinic must come back identical, or a team loses a week of play");
  if (!after.decisionLog.some((e) => e.event === "load")) throw new Error("A load must leave a trace in the decision log");
  if (after.history.length !== 2 || after.scenarioId !== "growth") throw new Error("Loading must restore the scenario and the history, not only the current year");
  // Nothing that is not a save file may replace a clinic, and a refusal must change nothing.
  const sentinel = JSON.stringify(scrub(ClinicTest.getState()));
  [JSON.stringify({ kind: "autre" }), JSON.stringify({ kind: "autre", schemaVersion: 8, state: ClinicTest.clone(before) }), JSON.stringify(ClinicTest.buildExportPayload()), JSON.stringify({ kind: "clinique-sauvegarde", schemaVersion: 3, state: {} }), "pas du json"].forEach((bad, index) => {
    if (ClinicTest.chargerClinique(bad) !== false) throw new Error(`Bad save file ${index} was accepted`);
    if (JSON.stringify(scrub(ClinicTest.getState())) !== sentinel) throw new Error(`Refusing bad save file ${index} still altered the clinic`);
  });
}

// What each service brings in. Every figure is already in the report; the table must reconcile to
// the clinic's own totals, and margin per hour must divide by one resource at a time — a cohort
// divided by the two added together and ranked ultrasound at 89 €/h instead of 138.
{
  const led = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en")));
  ClinicTest.renderState(led);
  ["vaccination", "preventive", "lab"].forEach((id, index) => ClinicTest.queueAction("s" + index, { kind: "toggle-service", targetId: id, value: true }));
  ClinicTest.resolveTurn();
  const report = ClinicTest.getState().history[0];
  const rows = report.serviceResults.filter((row) => row.active && row.honored > 0);
  if (rows.length < 3) throw new Error(`This check needs at least three services treating cases; got ${rows.length}`);
  const serviceNameFor = (id) => (ClinicData.services.find((x) => x.id === id).name.en);
  const html = ClinicTest.renderUiForTest({ drawer: "serviceLedger" });
  if (!html.includes("What each service brings in") && !/Service/.test(html)) throw new Error("The service ledger did not render");
  // Read the cells the student actually sees, not the report they were built from.
  const cells = [...html.matchAll(/<div role="row"[^>]*>([\s\S]*?)<\/div>\s*(?=<div role="row"|<\/div>)/g)]
    .map((m) => [...m[1].matchAll(/<(?:span|strong)>([^<]*)<\/(?:span|strong)>/g)].map((c) => c[1].trim()));
  const euros = (txt) => {
    const brut = String(txt).replace(/[^\d-]/g, "");
    return Number(brut) || 0;
  };

  const totalRow = cells.find((row) => /^(Total)$/.test(row[0]));
  if (!totalRow) throw new Error("The service ledger has no total row to check against the clinic");
  if (Math.abs(euros(totalRow[2]) - report.financial.revenue) > 1) throw new Error(`The table's total revenue reads ${euros(totalRow[2])} against the clinic's ${Math.round(report.financial.revenue)}`);
  if (Math.abs(euros(totalRow[3]) - report.financial.variableCosts) > 1) throw new Error(`The table's total variable costs read ${euros(totalRow[3])} against the clinic's ${Math.round(report.financial.variableCosts)}`);
  // A table a student is asked to add up has to add up. Rounding each cell on its own left the
  // services at 32 721 € against a total of 32 720 €, on every stock strategy that moves costs.
  ["basic", "coordinated", "optimized"].forEach((strategie) => {
    const essai = ClinicTest.initialState("balanced", "en");
    essai.operations.stockStrategy = strategie;
    ClinicTest.renderState(essai);
    ["vaccination", "preventive", "lab"].forEach((id, index) => ClinicTest.queueAction("s" + index, { kind: "toggle-service", targetId: id, value: true }));
    ClinicTest.resolveTurn();
    const bilan = ClinicTest.getState().history[0];
    const page = ClinicTest.renderUiForTest({ drawer: "serviceLedger" });
    const lus = [...page.matchAll(/<div role="row"[^>]*>([\s\S]*?)<\/div>\s*(?=<div role="row"|<\/div>)/g)]
      .map((m) => [...m[1].matchAll(/<(?:span|strong)>([^<]*)<\/(?:span|strong)>/g)].map((c) => c[1].trim()));
    const chiffre = (txt) => Number(String(txt).replace(/[^\d-]/g, "")) || 0;
    const entete = lus.find((row) => /^Service$/.test(row[0]));
    const bas = lus.find((row) => /^Total$/.test(row[0]));
    const corps = lus.filter((row) => row !== entete && row !== bas && row[0]);
    [[2, "revenue", bilan.financial.revenue], [3, "variable costs", bilan.financial.variableCosts]].forEach(([colonne, quoi, duModele]) => {
      const somme = corps.reduce((sum, row) => sum + chiffre(row[colonne]), 0);
      if (somme !== chiffre(bas[colonne])) throw new Error(`On ${strategie} stock the ${quoi} column adds up to ${somme} against a total of ${chiffre(bas[colonne])}`);
      if (Math.abs(chiffre(bas[colonne]) - duModele) > 1) throw new Error(`On ${strategie} stock the ${quoi} total reads ${chiffre(bas[colonne])} against the clinic's ${Math.round(duModele)}`);
    });
    // The stock line is a real difference, not a plug: it disappears when the multiplier is 1.
    const ligneStock = corps.find((row) => /Stock strategy/.test(row[0]));
    const multiplicateur = ClinicData.stockStrategies[strategie].multiplier;
    if (multiplicateur === 1 && ligneStock) throw new Error("With no stock multiplier there is nothing to adjust, and the line must not be there at 0 €");
    if (multiplicateur !== 1 && !ligneStock) throw new Error(`On ${strategie} stock the whole-clinic adjustment is missing, so the services do not explain the total`);
    if (ligneStock && Math.sign(chiffre(ligneStock[3])) !== Math.sign(multiplicateur - 1)) throw new Error(`On ${strategie} stock the adjustment runs the wrong way`);
  });
  ClinicTest.renderState(led);
  ["vaccination", "preventive", "lab"].forEach((id, index) => ClinicTest.queueAction("s" + index, { kind: "toggle-service", targetId: id, value: true }));
  ClinicTest.resolveTurn();

  rows.filter((row) => row.vetDuration > 0 && row.supportDuration > 0).forEach((row) => {
    const ligne = cells.find((cellule) => cellule[0] === serviceNameFor(row.id));
    if (!ligne) return;
    const affiche = euros(ligne[5]);
    const summed = row.contributionPerCase / (row.vetDuration + row.supportDuration);
    if (Math.abs(affiche - summed) < 1) throw new Error(`${row.id}: the table shows ${affiche} €/vet hour, which is margin over the two resources added together — they are not interchangeable`);
  });
}

// The team reflections no longer exist (owner, 2026-10-16): the students' writing lives in their
// shared document. Neither export may carry them, not even text left in an older clinic's state —
// an empty "Réflexions de l’équipe" made every team look as if it had not answered.
{
  const kept = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en")));
  ClinicTest.renderState(kept);
  ClinicTest.resolveTurn();
  const withText = ClinicTest.getState();
  withText.reflections = { 1: { rationale: "We used spare time", expected: "More care", observed: "It worked", surprise: "Travel rose", uncertainty: "Demand" } };
  ClinicTest.renderState(withText);
  const page = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "results" });
  if (/data-reflection=/.test(page)) throw new Error("The results page still asks the five reflection questions");
  const json = ClinicTest.buildExportPayload();
  if ("reflection" in json.years[0]) throw new Error("The analysis file still carries a reflection field");
  const printed = ClinicTest.buildPrintableReportHtml();
  if (/Réflexions de l’équipe|Team reflections|We used spare time|Aucune réponse|No response/.test(printed)) throw new Error("The printable report still prints team reflections");
}

// Where a number is read is where its control belongs.
{
  const routes = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en")));
  const overview = ClinicTest.renderState({ ...routes, domain: "overview" });
  if (!/data-open-drawer="relations"/.test(overview)) throw new Error("Staff climate and client trust are read on the overview; the actions that move them must be reachable from there");
  const care = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "care" });
  const roomsAt = care.indexOf('data-open-drawer="rooms"');
  const listAt = care.indexOf("Current services");
  if (roomsAt < 0 || listAt < 0 || roomsAt > listAt) throw new Error("The rooms and equipment controls must sit above the service list, which lengthens with every service opened");
  const panel = ClinicTest.renderState(ClinicTest.getState());
  const actionsAt = panel.indexOf('class="plan-actions"');
  const framesAt = panel.indexOf("plan-frames");
  if (actionsAt < 0 || (framesAt >= 0 && framesAt < actionsAt)) throw new Error("The planned actions are the panel's only control; nothing may come between them and the forecast");
}

// The hours field is the figure between the two step buttons, because hours are the only unit on a
// row: a percentage there could not add up — three rows of a third printed 33% each against a total
// of 100%. What has to be guarded is not where the field sits but whether its grid track can hold
// it. A fifth child of a four-column grid was once crushed to 34px around a 56px input, which is
// how a working control can still be unusable.
{
  const alloc = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en")));
  ClinicTest.renderState(alloc);
  const sup = ClinicTest.getState().staff.find((p) => p.role === "support");
  const html = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: sup.id });
  const steppers = [...html.matchAll(/<div class="stepper"[\s\S]*?<\/div>/g)].map((m) => m[0]);
  if (!steppers.length) throw new Error("The allocation editor rendered no stepper");
  const pistes = ((css.match(/\.stepper \{[^}]*grid-template-columns:([^;]*);/) || [])[1] || "").trim().split(/\s+(?![^(]*\))/).filter(Boolean);
  if (pistes.length !== 4) throw new Error(`The stepper declares ${pistes.length} grid tracks; its children will not land where they are sized`);
  const pisteDuChamp = pistes[1];
  const largeurFixe = Number((pisteDuChamp.match(/^(\d+)px$/) || [])[1] || 0);
  if (largeurFixe && largeurFixe < 70) throw new Error(`The hours field's grid track is ${largeurFixe}px: a four-digit number of hours does not fit`);
  steppers.forEach((st) => {
    const enfants = (st.match(/<(button|output|span)\b/g) || []).length;
    if (enfants !== 4) throw new Error(`The stepper must hold exactly as many children as it declares tracks (4); found ${enfants}`);
    if (!/<span class="pas-heures"><input[^>]*data-allocation-hours=/.test(st)) throw new Error("The figure between the step buttons must be the hours field itself, so the number a student reads is the number they can change");
  });
  if ((html.match(/<output>/g) || []).length) throw new Error("A per-row percentage cannot be shown beside hours: rounded row percentages do not sum to the rounded total");
  // The panel re-renders on every keystroke so the total, the bar and the live impact follow what is
  // being typed. That only works if the caret survives the re-render — and a type="number" input
  // does not support selection at all, so focus() dropped the caret to position zero and the next
  // digit went in at the front: 937 typed at a human pace arrived as 739.
  const champHeures = (html.match(/<input[^>]*data-allocation-hours="0"[^>]*>/) || [])[0] || "";
  if (!champHeures) throw new Error("The allocation row has no hours field");
  if (/type="number"/.test(champHeures)) throw new Error("A number input cannot carry a caret through a re-render, so digits typed into it land at the front");
  if (!/inputmode="numeric"/.test(champHeures)) throw new Error("The hours field must still raise a numeric keypad on a phone");
  if (!/data-allocation-hours/.test(html)) throw new Error("The hours field disappeared: percentages alone cannot hit a chosen number of hours");

  // --- The two ways to set a share must agree, to the hour ------------------------------------
  // A step used to re-round the whole share onto the 5% grid, so a typed 90 h became 142 h on one
  // press of + — a 52 h jump where the button promises 5% of 1 421, which is 71 h.
  const vetAlloc = ClinicTest.getState().staff.find((person) => person.role === "vet");
  const DISPO = ClinicTest.availableHoursFor(vetAlloc.id);
  if (!(DISPO > 1000)) throw new Error(`The founding vet should have her contracted hours; got ${DISPO}`);
  const heures = (share) => Math.round(share * DISPO);
  const pas = Math.round(DISPO * .05);
  const tape90 = ClinicTest.shareFromHours(90, 0, DISPO);
  if (heures(tape90) !== 90) throw new Error(`Typing 90 hours must set 90 hours; set ${heures(tape90)}`);
  if (heures(ClinicTest.stepShare(tape90, 5, 0, DISPO)) !== 90 + pas) throw new Error(`A +5% step on a typed 90 h must add ${pas} h and reach ${90 + pas} h; reached ${heures(ClinicTest.stepShare(tape90, 5, 0, DISPO))} h`);
  if (heures(ClinicTest.stepShare(tape90, -5, 0, DISPO)) !== Math.max(0, 90 - pas)) throw new Error("A −5% step must subtract the same hours a +5% step adds");

  // One ceiling for both controls. The buttons floored theirs onto the 5% grid, so a row holding a
  // typed share lowered the reachable maximum from 130% to 120% while typing still reached 123.67%.
  const autresTape = ClinicTest.shareFromHours(90, 0, DISPO);
  const parBouton = ClinicTest.stepShare(1.2, 5, autresTape, DISPO);
  const parFrappe = ClinicTest.shareFromHours(DISPO * 2, autresTape, DISPO);
  if (heures(parBouton) !== heures(parFrappe)) throw new Error(`The step button reaches ${heures(parBouton)} h where typing reaches ${heures(parFrappe)} h: one ceiling, or the two controls disagree`);
  if (Math.abs(parBouton + autresTape - 1.3) * DISPO > 1) throw new Error(`Both controls must reach the 130% ceiling; reached ${Math.round((parBouton + autresTape) * 100)}%`);

  // Every share either control produces stands for a whole number of hours, which is what makes
  // the hours on the rows add up to the hours on the total line.
  for (let h = 0; h <= Math.round(DISPO * 1.3); h += 11) {
    [0, 90 / DISPO, 1 / 3, .5].forEach((autres) => {
      [ClinicTest.shareFromHours(h, autres, DISPO), ClinicTest.stepShare(h / DISPO, 5, autres, DISPO), ClinicTest.stepShare(h / DISPO, -5, autres, DISPO)].forEach((part) => {
        if (Math.abs(part * DISPO - Math.round(part * DISPO)) > 1e-6) throw new Error(`A share of ${part} is ${part * DISPO} hours, which is not a whole hour`);
      });
    });
  }

  // --- The rows add up to the total, on screen -------------------------------------------------
  {
    const trois = ClinicTest.initialState("balanced", "en");
    ["vaccination", "dentistry"].forEach((id) => { trois.services[id].active = true; });
    ClinicTest.renderState(trois);
    const tiers = ClinicTest.shareFromHours(Math.round(DISPO / 3), 0, DISPO);
    const page = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: vetAlloc.id, confirm: null,
      allocationDrafts: { [vetAlloc.id]: ["consult", "vaccination", "dentistry"].map((serviceId) => ({ serviceId, share: tiers })) } });
    const lignes = [...page.matchAll(/value="(\d+)" data-allocation-hours="\d+"/g)].map((m) => Number(m[1]));
    if (lignes.length !== 3) throw new Error(`Expected three allocation rows; found ${lignes.length}`);
    const ligneTotal = (page.match(/<span class="total-heures">([^<]*)<\/span>/) || ["", ""])[1];
    const affiche = Number((ligneTotal.match(/^([\d,.\u00a0\u202f ]+) h/) || ["", "0"])[1].replace(/[^\d]/g, ""));
    const somme = lignes.reduce((a, b) => a + b, 0);
    if (somme !== affiche) throw new Error(`The rows show ${lignes.join(" + ")} = ${somme} h and the total shows ${affiche} h: the column does not close ("${ligneTotal}")`);
    // The total line is the sum of the rows by construction, so that alone proves nothing. This is
    // the check with teeth: the hours on the rows must also be the hours the model is holding. Three
    // unsnapped thirds give 474 + 474 + 474 = 1 422 against a share worth 1 421.
    const duModele = Math.round(tiers * 3 * DISPO);
    if (somme !== duModele) throw new Error(`The rows add up to ${somme} h while the shares behind them are worth ${duModele} h`);
    ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
  }

  // --- One tone vocabulary, and nothing idle painted green ------------------------------------
  if (ClinicTest.workloadTone(0) === "good") throw new Error("A person who worked none of their paid hours must not read as healthy");
  if (ClinicTest.workloadTone(1.3) !== "bad" || ClinicTest.workloadTone(1) !== "good") throw new Error("Overtime is a problem and full use is not");
  if (ClinicTest.assignedTone(1) !== "good" || ClinicTest.assignedTone(1.3) !== "bad" || ClinicTest.assignedTone(.5) !== "warn") throw new Error("The assignment tone must read 100% as settled, over as overtime and under as unfinished");
  // The two bars draw different quantities, so they must not both claim a state the other denies.
  {
    const equipe = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "team" });
    const maya = ClinicTest.getState().staff.find((person) => person.role === "support");
    const ligne = ClinicTest.simulatePlan([]).operational.staffRows.find((row) => row.id === maya.id);
    if (!(ligne.workload < .01)) throw new Error("This guard assumes the support worker starts on closed services");
    const cartes = equipe.match(/<article class="staff-card">[\s\S]*?<\/article>/g) || [];
    const carteMaya = cartes.find((c) => c.includes(maya.name)) || "";
    if (!/class="hour-bar"/.test(carteMaya)) throw new Error("The team page drew no hours bar");
    // Nothing worked is never drawn as worked: the bar shows the hours lost to the closed services.
    if (/class="hb-seg hb-worked"/.test(carteMaya) || !/service closed/.test(carteMaya)) throw new Error("A person who works none of their paid hours must show them lost, to closed services");
  }

  // A field you can type into and then cannot validate is worse than no field. validAllocations
  // only accepted multiples of 5% — an interface assumption from when buttons were the only way
  // to make a share — so 400 h of 1 421 was refused and the review button stayed disabled with
  // nothing saying why. The cases below are already rejected by the running total; they are
  // asserted so a future rewrite of this function cannot quietly start accepting them.
  const vet = ClinicTest.getState().staff.find((p) => p.role === "vet");
  const horaire = [{ serviceId: "consult", share: 400 / 1421 }];
  if (!ClinicTest.validAllocations(vet, horaire)) throw new Error("An allocation typed in hours must be valid, or the student can change it and never confirm it");
  [[NaN, "NaN"], [Infinity, "Infinity"], [0, "zero"], [-0.2, "negative"], [1.35, "135%"]].forEach(([share, quoi]) => {
    if (ClinicTest.validAllocations(vet, [{ serviceId: "consult", share }])) throw new Error(`validAllocations accepted ${quoi}`);
  });
  if (!ClinicTest.validAllocations(vet, [{ serviceId: "consult", share: 1.3 }])) throw new Error("130% is paid overtime and must stay allowed");
  // and the whole way through: type, review, confirm, and find it in the plan
  ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: vet.id });
  const apres = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: vet.id });
  if (/data-review-allocation="[^"]*"\s+disabled/.test(apres)) throw new Error("The review button is disabled on a freshly opened allocation");

  // Anything that collapses must stay open across a re-render. The frames only exist once a plan
  // has something in it, so give it one before asking.
  ClinicTest.queueAction("pli", { kind: "toggle-service", targetId: "vaccination", value: true });
  ["framesOpen", "noteOpen", "regleOpen"].forEach((cle) => {
    const ouvert = ClinicTest.renderUiForTest({ drawer: cle === "regleOpen" ? "staffAllocation" : null, drawerContext: cle === "regleOpen" ? sup.id : null, [cle]: true });
    const ferme = ClinicTest.renderUiForTest({ drawer: cle === "regleOpen" ? "staffAllocation" : null, drawerContext: cle === "regleOpen" ? sup.id : null, [cle]: false });
    if (ouvert === ferme) throw new Error(`ui.${cle} changes nothing: the panel will snap shut on the next re-render`);
    if (!new RegExp(`data-pli="${cle}"[^>]*\\bopen\\b`).test(ouvert)) throw new Error(`ui.${cle} does not re-render the block open`);
  });
}

// Unused hours are what the clinic pays for and nobody works: available minus used, and nothing
// else. Two wrong readings have shipped. The first counted them against the larger of available and
// assigned, so allocating someone to 130% made the clinic's idle hours GO UP — 1 945 h reported
// where 1 518 were real. The second subtracted blocked hours a second time, so a vet with 569 h on
// a service she is not trained for reported 0 unused hours while the clinic paid for all 569.
// Both were once "checked" by an assertion that compared the formula to itself. This one states
// what the figure means and leaves the arithmetic to the model.
{
  const over = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "en")));
  ClinicTest.renderState(over);
  ClinicTest.queueAction("s", { kind: "toggle-service", targetId: "vaccination", value: true });
  const sup = ClinicTest.getState().staff.find((p) => p.role === "support");
  const vetBloque = ClinicTest.getState().staff.find((p) => p.role === "vet");
  let teste = 0;
  let vuBloque = 0;
  const cas = [
    ...[0.5, 1, 1.15, 1.3].map((share) => ({ who: sup.id, allocations: [{ serviceId: "vaccination", share }], nom: `${sup.id} at ${share * 100}%` })),
    // and a case with blocked hours, which none of the shares above produce
    { who: vetBloque.id, allocations: [{ serviceId: "consult", share: .6 }, { serviceId: "dentistry", share: .4 }], nom: "a vet assigned to a service she cannot deliver" }
  ];
  cas.forEach(({ who, allocations, nom }) => {
    ClinicTest.queueAction("a", { kind: "staff-allocation", targetId: who, value: { allocations } });
    const forecast = ClinicTest.simulatePlan(ClinicTest.pendingActions());
    forecast.operational.staffRows.forEach((row) => {
      teste += 1;
      if (row.blockedHours > 1) vuBloque += 1;
      if (row.unusedHours > row.availableHours + 1) throw new Error(`With ${nom}, ${row.id} reports ${Math.round(row.unusedHours)} unused hours out of ${Math.round(row.availableHours)} available — an hour the clinic does not have cannot be idle`);
      // Every paid hour is either worked or not worked. Nothing else may be taken off.
      const gauche = row.availableHours + row.overtimeHours;
      const droite = row.usedHours + row.unusedHours;
      if (Math.abs(gauche - droite) > 1) throw new Error(`With ${nom}, ${row.id}'s hours do not account for themselves: available+overtime ${Math.round(gauche)} against used+unused ${Math.round(droite)}`);
      if (row.overtimeHours > 1 && row.unusedHours > 1) throw new Error(`With ${nom}, ${row.id} is paid for ${Math.round(row.unusedHours)} idle hours and ${Math.round(row.overtimeHours)} of overtime at the same time`);
      // Hours blocked by a missing skill are paid and produce nothing, so they are unused hours.
      if (row.overtimeHours < 1 && row.unusedHours < row.blockedHours - 1) throw new Error(`With ${nom}, ${row.id} has ${Math.round(row.blockedHours)} h blocked and paid but only ${Math.round(row.unusedHours)} h reported unused`);
    });
  });
  if (teste < 10) throw new Error(`Only ${teste} staff rows were checked; the loop is not exercising the cases`);
  if (!vuBloque) throw new Error("No case produced blocked hours, so the double-deduction defect would go unseen");

  // One number on three surfaces. The model, the team page card and the allocation grid each used
  // to work it out for themselves, and printed different figures for the same person.
  // Blocked hours have to be in play, or a card that deducts them twice agrees with the model by
  // accident: the two readings only differ when something is blocked.
  ClinicTest.queueAction("d", { kind: "toggle-service", targetId: "dentistry", value: true });
  ClinicTest.queueAction("a", { kind: "staff-allocation", targetId: vetBloque.id, value: { allocations: [{ serviceId: "consult", share: .6 }, { serviceId: "dentistry", share: .4 }] } });
  const forecast = ClinicTest.simulatePlan(ClinicTest.pendingActions());
  if (!(forecast.operational.staffRows.some((row) => row.blockedHours > 1))) throw new Error("This check needs blocked hours to tell the two readings apart");
  const page = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "team" });
  const carte = page.match(/Paid hours not worked<\/span><strong>([^<]*)</);
  if (!carte) throw new Error("The team page no longer shows unused team hours");
  const affiche = Number(carte[1].replace(/[^\d-]/g, ""));
  const somme = Math.round(forecast.operational.staffRows.reduce((sum, row) => sum + row.unusedHours, 0));
  if (Math.abs(affiche - somme) > 1) throw new Error(`The team card shows ${affiche} unused hours against the model's ${somme}`);
  // The grid draws the draft, so the figure to compare it against is the model run on that same
  // draft — not on the saved allocation, which would agree by luck whenever hours are not the
  // binding constraint. 30% differs from the saved 100%, so this exercises the draft path.
  [.3, 1, 1.3].forEach((share) => {
    const cellule = hoursGridCells(share, null, sup.id, "vaccination");
    const applique = ClinicTest.initialState("balanced", "en");
    applique.services.vaccination.active = true;
    applique.staff.find((person) => person.id === sup.id).allocations = [{ serviceId: "vaccination", share }];
    const ligne = ClinicTest.simulateYear(ClinicTest.clone(applique), applique, ClinicTest.emptyEffects(), []).operational.staffRows.find((row) => row.id === sup.id);
    if (Math.abs(cellule["Unused hours"] - Math.round(ligne.unusedHours)) > 1) throw new Error(`At ${Math.round(share * 100)}% the allocation grid shows ${cellule["Unused hours"]} unused hours against the model's ${Math.round(ligne.unusedHours)}`);
    if (Math.abs(cellule["Hours used"] - Math.round(ligne.usedHours)) > 1) throw new Error(`At ${Math.round(share * 100)}% the allocation grid shows ${cellule["Hours used"]} hours used against the model's ${Math.round(ligne.usedHours)}`);
  });
}

// One quantity, one value, on every page that shows it. Four pairs disagreed: the overview banded
// the net result to the game's forecast precision while Business printed it exact, the team page
// printed the workload exact against the overview's band, and the same for cases served on Care and
// the carbon footprint on Sustainability. Under ranges precision a student reading two pages read
// two different clinics. Checked on the rendered strings, because that is what they read.
{
  const paires = [
    ["Net result", ["overview", "business"]],
    ["Team workload", ["overview", "team"]],
    ["Cases served", ["overview", "care"]]
  ];
  const valeur = (html, label) => {
    const m = html.match(new RegExp("<span>" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "<\\/span><strong>([^<]*)<"));
    return m ? m[1] : null;
  };
  ["exact", "ranges"].forEach((precision) => {
    const base = ClinicTest.initialState("balanced", "en");
    base.setup.forecastPrecision = precision;
    const pages = {};
    ["overview", "care", "team", "business", "sustainability"].forEach((domain) => { pages[domain] = ClinicTest.renderState({ ...base, domain }); });
    paires.forEach(([label, domaines]) => {
      const lus = domaines.map((domain) => valeur(pages[domain], label));
      if (lus.some((item) => item === null)) throw new Error(`"${label}" is missing from ${domaines[lus.findIndex((item) => item === null)]} under ${precision} precision`);
      // The overview prints cases served over the requests; compare the figure, not the ratio.
      const figures = lus.map((item) => item.split(" / ")[0]);
      if (new Set(figures).size !== 1) throw new Error(`Under ${precision} precision "${label}" reads ${domaines.map((domain, i) => `${domain} ${figures[i]}`).join(" and ")}: one quantity cannot have two values`);
    });
    // and every grid of forecast cards says which year it belongs to and that it is a forecast
    ["overview", "care", "team", "business", "sustainability"].forEach((domain) => {
      const note = (pages[domain].match(/<p class="grille-note">([^<]*)</) || [])[1] || "";
      if (!/Forecast for Year \d/.test(note)) throw new Error(`The ${domain} cards do not say they are a forecast for a named year: "${note}"`);
    });
  });
  // The same label on the results page belongs to the year already played, and must say so.
  {
    const joue = ClinicTest.initialState("balanced", "en");
    ClinicTest.renderState(joue);
    ClinicTest.resolveTurn();
    const resultats = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "results" });
    const note = (resultats.match(/<p class="grille-note">([^<]*)</) || [])[1] || "";
    if (!/Year \d, as played/.test(note)) throw new Error(`The results cards must name the year they report and say it is played, not forecast: "${note}"`);
    if (/Forecast for Year/.test(note)) throw new Error("The results page is reporting a forecast");
  }
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// "Other duties" took hours out of a support worker's day and nothing said what took them. The note
// that names them had no guard and was wrong: it listed the clinic's reservations against one
// person's share, so with two support workers it announced 30 h of other duties and then named a
// single 60 h cause, and it left out the hours reserved by decisions already in the plan. The
// breakdown now comes from the model, where the reservation is made.
{
  const combinaisons = [
    ["coordinated stock", (clinic) => { clinic.operations.stockStrategy = "coordinated"; }],
    ["optimized stock and internal monitoring", (clinic) => { clinic.operations.stockStrategy = "optimized"; clinic.marketing.geomarketing = "internal"; }],
    ["two support workers", (clinic) => { clinic.operations.stockStrategy = "coordinated"; const un = clinic.staff.find((p) => p.role === "support"); clinic.staff.push({ ...ClinicTest.clone(un), id: "support-two", name: "Second", hiredYear: 0 }); }],
    ["two support workers, four reservations", (clinic) => { clinic.operations.stockStrategy = "optimized"; clinic.marketing.geomarketing = "internal"; clinic.sustainability.accessPlan = true; const un = clinic.staff.find((p) => p.role === "support"); clinic.staff.push({ ...ClinicTest.clone(un), id: "support-two", name: "Second", hiredYear: 0 }); }]
  ];
  combinaisons.forEach(([nom, mutate]) => {
    const clinic = ClinicTest.initialState("balanced", "en");
    mutate(clinic);
    ClinicTest.renderState(clinic);
    const sup = ClinicTest.getState().staff.find((person) => person.role === "support");
    const ligne = ClinicTest.simulatePlan([]).operational.staffRows.find((row) => row.id === sup.id);
    const parts = ligne.nonClinicalParts || [];
    const sommeParts = parts.reduce((sum, part) => sum + part.hours, 0);
    if (Math.abs(sommeParts - ligne.nonClinicalHours) > .01) throw new Error(`With ${nom}, the named reservations come to ${Math.round(sommeParts)} h against ${Math.round(ligne.nonClinicalHours)} h of other duties`);
    const html = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: sup.id, confirm: null });
    const note = (html.match(/<p class="reservation-note">([\s\S]*?)<\/p>/) || [])[1];
    if (!note) throw new Error(`With ${nom}, the hours taken by other duties are not named anywhere`);
    const annonce = Number((note.match(/The ([\d,.\u00a0\u202f ]+) h of other duties/) || ["", "0"])[1].replace(/[^\d]/g, ""));
    const items = [...note.matchAll(/>([^<·]+) · ([\d,.\u00a0\u202f ]+) h ›</g)].map((m) => Number(m[2].replace(/[^\d]/g, "")));
    if (!items.length) throw new Error(`With ${nom}, the note names no cause`);
    const somme = items.reduce((sum, value) => sum + value, 0);
    if (Math.abs(annonce - somme) > 1) throw new Error(`With ${nom}, the note announces ${annonce} h of other duties and names causes adding up to ${somme} h`);
  });
  // Hours reserved by a decision already in the plan belong in the breakdown, and used not to be.
  {
    const clinic = ClinicTest.initialState("balanced", "en");
    ClinicTest.renderState(clinic);
    const avant = ClinicTest.simulatePlan([]).operational.staffRows.find((row) => row.role === "support");
    const effets = ClinicTest.emptyEffects();
    effets.supportReserved = 150;
    const apres = ClinicTest.simulateYear(ClinicTest.clone(clinic), clinic, effets, []).operational.staffRows.find((row) => row.role === "support");
    if (!(apres.nonClinicalHours > avant.nonClinicalHours + 100)) throw new Error("A plan that reserves support hours must show up in that person's other duties");
    const somme = (apres.nonClinicalParts || []).reduce((sum, part) => sum + part.hours, 0);
    if (Math.abs(somme - apres.nonClinicalHours) > .01) throw new Error(`Hours reserved by the plan are missing from the breakdown: ${Math.round(somme)} named against ${Math.round(apres.nonClinicalHours)} taken`);
  }
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Friday is played twice from one saved clinic: three years without the project, reload, three
// years with it. Without an archive the load erased the first run, and with it the comparison the
// whole week builds towards.
{
  const depart = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "fr")));
  ClinicTest.renderState(depart);
  ClinicTest.resolveTurn();
  const sauvegarde = { kind: "clinique-sauvegarde", schemaVersion: 8, savedAt: new Date().toISOString(), state: ClinicTest.clone(ClinicTest.getState()) };
  ClinicTest.resolveTurn(); ClinicTest.resolveTurn(); ClinicTest.resolveTurn();
  const sansProjet = ClinicTest.getState().history.map((r) => Math.round(r.financial.netResult));
  if (!ClinicTest.chargerClinique(JSON.stringify(sauvegarde))) throw new Error("The saved clinic must load");
  const charge = ClinicTest.getState();
  if (charge.year !== 2) throw new Error("Loading must return to the saved year");
  if (charge.runArchive.length !== 1) throw new Error(`The replaced run must be archived once, found ${charge.runArchive.length}`);
  const essai = charge.runArchive[0];
  if (JSON.stringify(essai.years.map((r) => Math.round(r.netResult))) !== JSON.stringify(sansProjet)) throw new Error("The archived run must keep every year it played");
  const payload = ClinicTest.buildExportPayload();
  if (!payload.runArchive || payload.runArchive.length !== 1) throw new Error("The analysis file must carry the archived run");
  if (!payload.decisionLog.some((e) => e.event === "load")) throw new Error("The analysis file must show that a clinic was loaded");
  if (!ClinicTest.buildPrintableReportHtml().includes("Essais rechargés")) throw new Error("The printable report must show the archived run");
  // A team that saves again after a reload carries the archive inside its file. Loading that file
  // brings the same run from both sides: it must be kept once.
  const sauvegarde2 = { kind: "clinique-sauvegarde", schemaVersion: 8, savedAt: new Date().toISOString(), state: ClinicTest.clone(ClinicTest.getState()) };
  ClinicTest.resolveTurn();
  ClinicTest.chargerClinique(JSON.stringify(sauvegarde2));
  const ids = ClinicTest.getState().runArchive.map((e) => e.id);
  if (ids.length !== 2 || new Set(ids).size !== 2) throw new Error(`Two replaced runs must give two archive entries, found ${ids.length}`);
}

// The viewpoints panel ("Mieux ou moins bien — vu d’où ?") carries Tuesday and Thursday. Its
// verdicts are frozen with the year, and the requests the clinic does not offer with them, so the
// access-to-care view can be read back from the export.
{
  const c = ClinicTest.hydrate(ClinicTest.clone(ClinicTest.initialState("balanced", "fr")));
  ClinicTest.renderState(c);
  ClinicTest.queueAction("price:consult", { kind: "price", targetId: "consult", value: 58 });
  ClinicTest.resolveTurn();
  const shown = ClinicTest.getState().history[0].forecastShown;
  if (!Array.isArray(shown.frames) || shown.frames.length !== 4) throw new Error("A passed year must freeze the four viewpoints");
  const parId = Object.fromEntries(shown.frames.map((f) => [f.id, f.verdict]));
  if (parId.money !== "better" || parId.access !== "worse") throw new Error(`A 20 % price rise must read better for the accounts and worse for access, got ${JSON.stringify(parId)}`);
  if (!(shown.shown.opportunity > 0)) throw new Error("The forecast snapshot must keep the requests the clinic does not offer");
}


// What a team reads when it passes a year must be what the export says, figure for figure: the
// results page, the Référence / Planifié pair shown before passing, and the printable report. With
// exact forecasts the realised year equals the plan; with demand variation it does not, and the
// screen and the export must still agree.
{
  const norm = (t) => String(t).replace(/\s+/g, " ");
  const texte = (h) => norm(h.replace(/<[^>]+>/g, " "));
  ["exact", "ranges"].forEach((precision) => {
    const c = ClinicTest.initialState("balanced", "en", { classCode: "CONCORDANCE", forecastPrecision: precision });
    c.rules.actionLimit = 4;
    ClinicTest.renderState(c);
    const eur = (v) => norm(new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Math.round(v)));
    const nb = (v) => norm(new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.round(v)));
    const plans = [
      [["price:consult", { kind: "price", targetId: "consult", value: 58 }]],
      [["service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }], ["service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }]],
      [],
      [["service:lab:active", { kind: "toggle-service", targetId: "lab", value: true }]]
    ];
    plans.forEach((plan) => {
      plan.forEach(([key, payload]) => ClinicTest.queueAction(key, payload));
      const avant = texte(ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" }));
      ClinicTest.resolveTurn();
      const year = ClinicTest.buildExportPayload().years.at(-1);
      const page = texte(ClinicTest.renderState({ ...ClinicTest.getState(), domain: "results" }));
      const rapport = texte(ClinicTest.buildPrintableReportHtml());
      const attendus = [[eur(year.netResult), page, "the net result on the results page"], [nb(year.served), page, "the cases served on the results page"], [eur(year.treasury), page, "the treasury on the results page"], [eur(year.netResult), rapport, "the net result in the printable report"]];
      if (precision === "exact") {
        // The plan panel row reads "Net result <Référence> <Planifié> <gap>": all three, in order, and
        // the gap must be the difference of the two printed figures.
        const base = Math.round(year.forecastShown.noActionBaseline.netResult), plan = Math.round(year.forecastShown.shown.netResult);
        const ecart = norm(new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(plan - base));
        const ligne = `Net result ${eur(base)} ${eur(plan)} ${plan === base ? "" : ecart}`.trim();
        attendus.push([ligne, avant, "the Référence / Planifié / gap row before passing"]);
      }
      attendus.forEach(([valeur, ecran, quoi]) => { if (!ecran.includes(valeur)) throw new Error(`Year ${year.year} (${precision}): the export says ${valeur} for ${quoi}, the screen does not`); });
      if (Math.round(year.forecastShown.realised.netResult) !== Math.round(year.netResult)) throw new Error(`Year ${year.year}: the frozen realised result differs from the year's result`);
    });
  });
}

// How a team decided must be readable, not only what it decided: every planned, changed and removed
// decision with its time, and the moment the year was passed — in the analysis file and in the PDF.
{
  ClinicTest.renderState(ClinicTest.initialState("balanced", "fr"));
  ClinicTest.queueAction("price:consult", { kind: "price", targetId: "consult", value: 55 });
  ClinicTest.queueAction("price:consult", { kind: "price", targetId: "consult", value: 58 });
  ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true });
  ClinicTest.removeAction("service:vaccination:active");
  ClinicTest.resolveTurn();
  const json = ClinicTest.buildExportPayload();
  const events = json.decisionLog.filter((e) => e.year === 1).map((e) => e.event);
  ["add", "revise", "remove", "pass"].forEach((ev) => { if (!events.includes(ev)) throw new Error(`The decision log must record "${ev}"`); });
  const retiree = json.decisionLog.find((e) => e.event === "remove");
  if (!retiree.label || !/Vaccination/.test(retiree.label)) throw new Error("A removed decision must keep the label the team read on screen");
  if (!json.years[0].passedAt || Number.isNaN(Date.parse(json.years[0].passedAt))) throw new Error("Each year must record when it was passed");
  if (json.years[0].actionRecords[0].revisions !== 1) throw new Error("The price decision was changed once");
  const pdf = ClinicTest.buildPrintableReportHtml();
  ["Comment l’année a été décidée", "Année passée", "Retirée", "Modifiée", "Première planification", "Dernière modification"].forEach((mot) => {
    if (!pdf.includes(mot)) throw new Error(`The PDF must show « ${mot} »`);
  });
  if (!/Retirée<\/td><td>[^<]*Vaccination/.test(pdf)) throw new Error("The PDF timeline must name the removed decision");
}

// Wednesday ranks the services that share a full room by margin per hour of room. That hour is
// the case's own duration times its pace — not vet time plus support time, which overlap — and it
// must be readable on the service sheet, or the ranking cannot be done from the screen.
{
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
  const fiche = (id) => ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: id, confirm: null }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const consult = fiche("consult");
  if (!/Room time per case 0\.55 h · Consult room/.test(consult)) throw new Error("The consultation sheet must show 0.55 h of consult room per case");
  if (!/Room time per case 0\.72 h/.test(fiche("preventive"))) throw new Error("Preventive care occupies the room 0.72 h per case: its full duration, not vet + support");
  ClinicTest.queueAction("service-pace:consult", { kind: "service-pace", targetId: "consult", value: "fast" });
  if (!/Room time per case 0\.44 h/.test(fiche("consult"))) throw new Error("A fast pace must shorten the room time shown on the sheet");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Trust, rushed visits and price must be things a team can watch over the years and act on
// (owner, 2026-10-19). Each mechanism below is something the screen shows before and after a year.
{
  const lundi = () => {
    ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
    ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
    ClinicTest.queueAction("service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn();
    return ClinicTest.getState();
  };
  const base = lundi();
  const passe = (f) => { ClinicTest.renderState(ClinicTest.clone(base)); f(); ClinicTest.resolveTurn(); return ClinicTest.getState().history.at(-1); };
  const ref = passe(() => {});
  const rapide = passe(() => ClinicTest.queueAction("service-pace:consult", { kind: "service-pace", targetId: "consult", value: "fast" }));
  const consultR = rapide.serviceResults.find((r) => r.id === "consult");
  // Rushed care comes back: return visits use time and supplies and earn nothing.
  if (!(consultR.returnVisits > 0)) throw new Error("A rushed consultation must produce return visits");
  if (Math.abs(consultR.revenue - consultR.honored * consultR.price) > 1) throw new Error("Return visits must earn nothing");
  if (!(consultR.variableCosts > consultR.revenue * ClinicTest.data.services.find((s) => s.id === "consult").variableCost + 1)) throw new Error("Return visits must use supplies");
  // Its trust line stands on its own, and the team pays for rushing.
  if (!(rapide.social.trustParts.pace <= -2)) throw new Error(`Rushing must cost trust on its own line, got ${rapide.social.trustParts.pace}`);
  if (!(rapide.social.after.clientTrust < ref.social.after.clientTrust)) throw new Error("Rushing must leave trust lower than not rushing, even while serving more");
  if (rapide.social.climateParts.pace !== -1) throw new Error("A rushed service must cost the team one point of climate a year");
  // The accepted price is the client type's, moved by trust, and the price screen shows exactly it.
  // The accepted price is the client type's, moved by trust: read on the price screen at trust 50 and
  // 60, it must rise — and at 50 it must be the client type's own figure.
  const euros = (v) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Math.round(v)).replace(/\s+/g, " ");
  const prixLu = (trust) => {
    const c = ClinicTest.clone(base); c.social.clientTrust = trust; c.marketing.geomarketing = "external"; ClinicTest.renderState(c);
    const texte = ClinicTest.renderUiForTest({ drawer: "pricing", drawerContext: null, confirm: null }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m = texte.match(/consultation[^€]*?Price your clients accept: €([\d,.]+)/i);
    return { texte, valeur: m ? Number(m[1].replace(/,/g, "")) : NaN };
  };
  const a50 = prixLu(50), a60 = prixLu(60);
  const ecran = a60.texte;
  if (a50.valeur !== Math.round(ClinicTest.data.segments.community.willingness.consult)) throw new Error(`At trust 50 the screen must show the client type's own accepted price, got ${a50.valeur}`);
  if (!(a60.valeur > a50.valeur)) throw new Error(`Trust must raise the accepted price: ${a50.valeur} at 50, ${a60.valeur} at 60`);
  if (!/Your clients: Community mix/.test(ecran)) throw new Error("The price screen must name the client type");
  // Without a market study the same price is known only as a range around it, not centred on it;
  // the team's study narrows the range, a consultancy's gives the figure (owner, 2026-10-19).
  [["none", true], ["internal", true], ["external", false]].forEach(([level, isRange]) => {
    const c = ClinicTest.clone(base); c.marketing.geomarketing = level; ClinicTest.renderState(c);
    const t = ClinicTest.renderUiForTest({ drawer: "pricing", drawerContext: null, confirm: null }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m = t.match(/consultation[^€]*?Price your clients accept: €([\d,]+)(?:–€([\d,]+))?/i);
    const truth = Math.round(ClinicTest.data.segments.community.willingness.consult);
    if (!m || Boolean(m[2]) !== isRange) throw new Error(`With study « ${level} » the accepted price must be ${isRange ? "a range" : "exact"}: ${m ? m[0] : "not found"}`);
    if (isRange) { const lo = Number(m[1].replace(/,/g, "")), hi = Number(m[2].replace(/,/g, "")); if (!(lo <= truth && truth <= hi) || (lo + hi) / 2 === truth) throw new Error(`The range ${lo}–${hi} must contain ${truth} without being centred on it`); }
  });
  // A price above what clients accept costs trust — more for price-sensitive families.
  const prixAvec = (seg) => { const c = ClinicTest.clone(base); c.marketFocus = seg; ClinicTest.renderState(c); ClinicTest.queueAction("price:consult", { kind: "price", targetId: "consult", value: 58 }); ClinicTest.resolveTurn(); return ClinicTest.getState().history.at(-1).social.trustParts.price || 0; };
  const pCommunity = prixAvec("community"), pBudget = prixAvec("budget");
  if (!(pCommunity < 0)) throw new Error("A 58 € consultation must cost the local mix some trust");
  if (!(pBudget < pCommunity)) throw new Error("Price-sensitive families must lose more trust than the local mix at the same price");
  // The price screen points: the price sits in the marked zone above the accepted price.
  if (!/<b class="ps-price over"/.test(ClinicTest.renderUiForTest({ drawer: "pricing", drawerContext: null, confirm: null }))) throw new Error("A price above the accepted one must sit, marked, in the zone above it on the price screen");
  // Past a line, trust moves clients.
  const clientsApres = (trust) => { const c = ClinicTest.clone(base); c.social.clientTrust = trust; ClinicTest.renderState(c); ClinicTest.resolveTurn(); const r = ClinicTest.getState(); return r.clients / c.clients; };
  const g50 = clientsApres(50), g40 = clientsApres(40), g30 = clientsApres(30);
  if (!(g40 < g50 - .02)) throw new Error("Below 45, clients must leave");
  if (!(g30 < g40 - .03)) throw new Error("Below 35, clients must leave faster");
  // The plan panel shows trust and climate before the year is passed.
  ClinicTest.renderState(ClinicTest.clone(base));
  const panneau = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" });
  if (!/class="forecast-row"><strong>Client trust</.test(panneau) || !/class="forecast-row"><strong>Staff climate</.test(panneau)) throw new Error("Trust and climate must be rows of the plan panel, read before passing a year");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Every relation shown on screen has a role, and both exports carry it (owner, 2026-10-19).
{
  const base = (() => { const c = ClinicTest.initialState("balanced", "en"); c.rules.actionLimit = 4; ClinicTest.renderState(c);
    ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
    ClinicTest.queueAction("service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn();
    return ClinicTest.getState(); })();
  const plan = (f) => { const c = ClinicTest.clone(base); f(c); ClinicTest.renderState(c); return ClinicTest.simulatePlan(); };
  // Referring vets move advanced requests, and only those.
  const avecEcho = (c) => { c.services.ultrasound.active = true; };
  const echo = (ref) => plan((c) => { avecEcho(c); c.social.referralSupport = ref; }).serviceResults.find((r) => r.id === "ultrasound").demand;
  const consult = (ref) => plan((c) => { c.social.referralSupport = ref; }).serviceResults.find((r) => r.id === "consult").demand;
  if (!(echo(70) > echo(50) * 1.15)) throw new Error("Referral support at 70 must bring clearly more ultrasound requests than at 50");
  if (consult(70) !== consult(50)) throw new Error("Referral support must not move routine requests");
  // Refused clients pile up and cost trust; they no longer create requests.
  const refus = (p) => plan((c) => { c.social.communityPressure = p; });
  if (!((refus(80).social.trustParts.refused || 0) < -2)) throw new Error("Access pressure at 80 must cost trust");
  if (refus(80).operational.totalDemand !== refus(50).operational.totalDemand) throw new Error("Access pressure must no longer create requests");
  // Reputation no longer grows clients on its own.
  const clientsRep = (rep) => { const c = ClinicTest.clone(base); c.reputation = rep; ClinicTest.renderState(c); ClinicTest.resolveTurn(); return ClinicTest.getState().clients; };
  if (clientsRep(40) !== clientsRep(80)) throw new Error("Reputation is folded into trust: it must not move clients by itself");
  // Screens: the clients card and the relations guide.
  ClinicTest.renderState(ClinicTest.clone(base));
  const vue = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/Client households [\d,]+ /.test(vue) || !/Next year .*?Client households [\d,]+ → [\d,]+/.test(vue)) throw new Error("The overview must show client households now, and under « Next year » the count they become");
  // Exports: the JSON carries the accepted price and the client movement; the PDF explains each year.
  ClinicTest.resolveTurn();
  const json = ClinicTest.buildExportPayload();
  const y = json.years.at(-1);
  if (!(y.serviceResults.find((r) => r.id === "consult").acceptedPrice > 0)) throw new Error("The analysis file must carry each service's accepted price");
  if (!("clientMovement" in y.social)) throw new Error("The analysis file must carry the client movement");
  const pdf = ClinicTest.buildPrintableReportHtml();
  ["Relations around the clinic", "Why it moved", "Accepted price", "Return visits", "Client type"].forEach((m) => { if (!pdf.includes(m)) throw new Error(`The PDF must show « ${m} »`); });
  if (/<td>Reputation<\/td>/.test(pdf)) throw new Error("Reputation no longer acts on anything: it must leave the PDF");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Goals are promises to someone who reacts the following year; relations are read at a glance; and
// the game does not settle — its promises trade against each other over time (owner, 2026-10-19).
{
  const debut = () => { const c = ClinicTest.initialState("balanced", "en"); c.rules.actionLimit = 12; c.rules.targetYear = 12; ClinicTest.renderState(c);
    ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
    ClinicTest.queueAction("service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn(); };
  // The bank: year 1 loses money, so a loan asked in year 2 costs 9 %; after two broken years, none.
  debut();
  const premier = ClinicTest.getState().history[0].commitments.find((c) => c.id === "bank");
  if (!premier || premier.ok) throw new Error("Year 1 loses money: the bank promise must be broken");
  const s1 = ClinicTest.clone(ClinicTest.getState()); s1.history = s1.history.slice(0, 1); s1.year = 2; ClinicTest.renderState(s1);
  ClinicTest.queueAction("loan:x", { kind: "loan", value: 30000 });
  if (ClinicTest.simulatePlan().next.loan?.rate !== .09) throw new Error("One broken bank promise must make the next loan 9 %");
  const s2 = ClinicTest.clone(s1); s2.history = [s1.history[0], { ...s1.history[0], turn: 2 }]; s2.year = 3; ClinicTest.renderState(s2);
  ClinicTest.queueAction("loan:x", { kind: "loan", value: 30000 });
  if (ClinicTest.simulatePlan().next.loan) throw new Error("Two broken bank promises in a row must refuse the loan");
  if (!/no new loan/.test(ClinicTest.renderUiForTest({ drawer: "finance", drawerContext: null, confirm: null }))) throw new Error("Financement must say the bank refuses");
  // Referring vets react to the services promise; the municipality pays only a clinic that invests.
  debut(); ClinicTest.resolveTurn();
  const avecPairs = ClinicTest.getState().history.at(-1);
  if (!(avecPairs.social.after.referralSupport - avecPairs.social.before.referralSupport > 1)) throw new Error("A kept services promise must raise referral support the next year");
  if ((avecPairs.financial.grant || 0) !== 0) throw new Error("No sustainability measure: no grant");
  ClinicTest.queueAction("sustainability:accessPlan", { kind: "sustainability", targetId: "accessPlan", value: true }); ClinicTest.resolveTurn(); ClinicTest.resolveTurn();
  const prime = ClinicTest.getState().history.at(-1).financial.grant;
  if (!(prime > 0) || prime !== ClinicTest.data.commitmentModel.grant) throw new Error("Investing and cutting carbon per case must earn the grant the year after");
  // Screens: the flow and the promises, as plain rows; no gauges, no two-year forecast (owner, 2026-10-19:
  // they added things to decode without helping anyone understand).
  const vue = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" });
  if (!/class="flow-strip"/.test(vue) || !/per household a year/.test(vue)) throw new Error("The overview must show households → requests → cases with the ratio");
  if (/class="gauge|chip-cause|gauge-info|in 2 years/.test(vue)) throw new Error("The overview must not carry gauges, cause chips or two-year rows");
  if (!/Staff climate/.test(vue) || !/Client trust/.test(vue)) throw new Error("The overview must show climate and trust as plain cards");
  if (!/Next year<\/h2>[\s\S]*class="card-section engagements"/.test(vue) || !/class="engagement-next">→ /.test(vue)) throw new Error("The overview must show the promises, under « Next year », with what follows");
  // Exports.
  const json = ClinicTest.buildExportPayload();
  if (!Array.isArray(json.years.at(-1).commitments) || !json.years.at(-1).commitments.length) throw new Error("The analysis file must carry each year's promises");
  if (!/Promises<\/h3>/.test(ClinicTest.buildPrintableReportHtml())) throw new Error("The PDF must show each year's promises");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// The game must not settle: the loop measurement's three properties hold (reduced to the policies
// that show them), so a later change that makes every promise easy fails here.
{
  const out = require("child_process").spawnSync(process.execPath, [require("path").join(__dirname, "outils", "boucles.js")], { encoding: "utf8" });
  if (out.status !== 0) throw new Error("The loops have settled: " + (out.stderr || out.stdout).split("\n").filter((l) => /ÉCHEC/.test(l)).join(" "));
}

// Signals carry the lesson: a refused family goes elsewhere, a tired team works slower, and the results
// say so in plain lines that point to where to act. And a worse state is never rewarded.
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn();
  const base = ClinicTest.clone(ClinicTest.getState());
  const plan = (f) => { const c = ClinicTest.clone(base); f(c); ClinicTest.renderState(c); return ClinicTest.simulatePlan([]); };
  const ref = plan(() => {});
  const refused = ref.operational.totalDemand - ref.operational.totalHonored;
  if (!(refused > 0) || ref.social.refusedLeft !== Math.round(refused * ClinicTest.data.socialModel.refusedLeave) || !(ref.social.refusedLeft > 0)) throw new Error("Refused requests must cost households, counted on their own");
  // A clinic that refuses more than the promised share must lose households, not gain them.
  ClinicTest.renderState(ClinicTest.clone(base)); for (let i = 0; i < 6; i++) ClinicTest.resolveTurn();
  const h = ClinicTest.getState().history;
  h.forEach((r, i) => { if (i && r.operational.honoredRate < .8 && r.next.clients > ClinicTest.getState().history[i - 1].next.clients) throw new Error(`Year ${r.turn}: ${Math.round(r.operational.honoredRate * 100)} % served, yet households grew`); });
  const tired = plan((c) => { c.social.staffClimate = 35; });
  if (!(tired.operational.totalHonored < ref.operational.totalHonored)) throw new Error("A tired team must serve fewer cases even when the room is the constraint");
  // No worse state pays: lower trust, lower climate, more pressure, fewer households.
  [["trust −15", (c) => { c.social.clientTrust -= 15; }], ["climate −15", (c) => { c.social.staffClimate -= 15; }], ["climate −25", (c) => { c.social.staffClimate -= 25; }], ["households −10 %", (c) => { c.clients = Math.round(c.clients * .9); }]].forEach(([name, f]) => {
    const r = plan(f);
    if (r.financial.netResult > ref.financial.netResult + .5 || r.operational.totalHonored > ref.operational.totalHonored) throw new Error(`${name} must not improve the year (net ${Math.round(ref.financial.netResult)} → ${Math.round(r.financial.netResult)}, cases ${ref.operational.totalHonored} → ${r.operational.totalHonored})`);
  });
  // The results: plain cause → effect lines, each with where to act.
  const c = ClinicTest.clone(base); c.social.staffClimate = 40; ClinicTest.renderState(c); ClinicTest.resolveTurn();
  const res = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "results" });
  const sig = (res.match(/<section class="card-section signals">[\s\S]*?<\/section>/) || [""])[0];
  if (!sig) throw new Error("The results must show the year's signals");
  if (!/requests refused[\s\S]*households went elsewhere/.test(sig)) throw new Error("The signals must say how many households the refusals cost");
  if (!/Staff climate[\s\S]*every case takes/.test(sig)) throw new Error("The signals must say what a low climate does next year");
  if (!/data-open-drawer="rooms"/.test(sig)) throw new Error("A refusal signal must open the rooms");
  // The same lines, figure for figure, in the PDF and the analysis file.
  const shown = [...sig.matchAll(/<span class="signal-effect">([^<]*)<\/span>/g)].map((m) => m[1]);
  const pdf = ClinicTest.buildPrintableReportHtml();
  shown.forEach((t) => { if (!pdf.includes(t)) throw new Error(`The PDF must carry the signal « ${t} »`); });
  const js = ClinicTest.buildExportPayload().years.at(-1).signals || [];
  if (js.map((l) => l.effect).join("|") !== shown.map((t) => t.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')).join("|")) throw new Error("The analysis file must carry the same signals as the screen");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Refused requests have one count, split by cause, and the parts add up — per service and in
// total — on every path (owner, 2026-10-19: 727, 415 and "full at 97 %" on three screens).
{
  const paths = [() => {}, (c) => { c.operations.stockStrategy = "basic"; }, (c) => { c.services.vaccination.active = true; c.services.preventive.active = true; }, (c) => { c.services.dentistry.active = true; }];
  paths.forEach((f, k) => {
    const c = ClinicTest.initialState(k === 3 ? "growth" : "balanced", "en"); f(c); ClinicTest.renderState(c);
    for (let y = 0; y < 4; y++) {
      const r = ClinicTest.simulatePlan();
      r.serviceResults.filter((x) => x.active).forEach((x) => {
        const sum = (x.lostBy || []).reduce((t, l) => t + l.count, 0);
        if (sum !== Math.max(0, x.demand - x.honored)) throw new Error(`Path ${k}, year ${y + 1}, ${x.id}: refusals by cause add to ${sum}, demand − honored is ${x.demand - x.honored}`);
      });
      const total = ClinicTest.refusalSplit(r).reduce((t, p) => t + p.count, 0);
      if (total !== r.operational.totalDemand - r.operational.totalHonored) throw new Error(`Path ${k}: the refusal split adds to ${total}, not ${r.operational.totalDemand - r.operational.totalHonored}`);
      ClinicTest.resolveTurn();
    }
  });
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Refusals before and after the year (owner, 2026-10-19): before, the screens give the count and the
// measurements (room hours, stock-outs by name); the split by cause — the diagnosis — is in Résultats,
// once the year is passed, and adds up to the year's refusals.
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn();
  const num = (t) => Number(String(t).replace(/[^\d]/g, ""));
  const f = ClinicTest.simulatePlan();
  const vue = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" });
  const total = num(vue.match(/<em>([\d,]+) refused/)[1]);
  if (total !== f.operational.totalDemand - f.operational.totalHonored) throw new Error("The overview must give the year's refusals");
  const attention = (vue.match(/<div class="priority-list">[\s\S]*?<\/section>/) || [""])[0];
  if (/refusal-bar/.test(vue) || /room full|Support hours|Vet hours/.test(attention + (vue.match(/<section class="flow-strip"[\s\S]*?<\/section>/) || [""])[0])) throw new Error("Before the year, the overview must not split refusals by cause");
  const stock = ClinicTest.refusalSplit(f).find((p) => p.key === "stock");
  if (stock && !new RegExp(`incl\\. ${stock.count.toLocaleString("en-GB")} stock-outs`).test(vue)) throw new Error("Stock-outs are named before the year: they belong to the stock strategy");
  const room = f.operational.facilityRows.find((r) => r.id === "consult");
  if (!new RegExp(`Consult room</span><strong>${Math.round(room.used).toLocaleString("en-GB")} / ${Math.round(room.capacity).toLocaleString("en-GB")} h`).test(vue)) throw new Error("« Points d'attention » must measure the busiest room");
  const care = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "care" });
  if (/refused here|constraint-badge/.test(care)) throw new Error("Before the year, the care page measures; it does not attribute");
  ClinicTest.resolveTurn();
  const latest = ClinicTest.getState().history.at(-1);
  const res = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "results" });
  const bar = res.match(/<div class="hour-bar refusal-bar"[\s\S]*?<\/ul><\/div>/)?.[0] || "";
  const parts = [...bar.matchAll(/<strong>([^<]*)<\/strong>/g)].map((m) => num(m[1]));
  if (!parts.length || parts.reduce((a, b) => a + b, 0) !== latest.operational.totalDemand - latest.operational.totalHonored) throw new Error("After the year, Résultats must split the refusals by cause, adding up");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Durabilité says where the clinic stands against the municipality's promise: a title that states
// it, and one line per condition with its figure — never a lone ✗ (owner, 2026-10-19).
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("service:vaccination:active", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("service:preventive:active", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn();
  const page = () => (ClinicTest.renderState({ ...ClinicTest.getState(), domain: "sustainability" }).match(/<section class="card-section promise-check">[\s\S]*?<\/section>/) || [""])[0];
  const before = page();
  const text = before.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/Promise to the municipality: not kept/.test(text)) throw new Error("The promise must be stated in words: " + text.slice(0, 120));
  if (!/Carbon per case [\d.]+ ?kgCO₂e · [−+]\d+% vs start · target −15%/.test(text) || !/Volume kept [\d,]+ cases · minimum [\d,]+ \(80% of the start\)/.test(text)) throw new Error("Each condition must carry its own figure and what it is measured against: " + text);
  if (!/<li class="ko"><span aria-hidden="true">✗<\/span><strong>A sustainability measure<\/strong><span>none · <a href="#sources-empreinte">/.test(before)) throw new Error("A missing measure must say so and point to the sources below");
  const vue = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" });
  if (!/engagement-row ko"><span class="engagement-mark"[^>]*>✗<\/span><strong>The municipality/.test(vue)) throw new Error("The overview must show the same broken promise");
  ClinicTest.queueAction("sustainability:accessPlan", { kind: "sustainability", targetId: "accessPlan", value: true });
  if (!/<li class="ok"><span aria-hidden="true">✓<\/span><strong>A sustainability measure<\/strong><span>in the plan/.test(page())) throw new Error("With a measure planned, that condition must turn ✓");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// One word per idea, and the phone bar names the treasury, not a difference (owner, 2026-10-19).
{
  const c0 = ClinicTest.initialState("balanced", "en"); ClinicTest.renderState(c0);
  const html = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "team" });
  const f = ClinicTest.simulatePlan();
  const bar = (html.match(/<button class="mobile-plan-toggle"[\s\S]*?<\/button>/) || [""])[0].replace(/<[^>]+>/g, "");
  if (!bar.replace(/[^\d]/g, "").includes(String(Math.round(f.financial.treasury)))) throw new Error("The phone plan bar must show the treasury itself: " + bar);
  if (!/<small>workload<\/small>/.test(html)) throw new Error("A person's percentage must say it is their workload");
  if (/staff use/i.test(html + ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" }))) throw new Error("« Staff use » is the team workload: one name for one quantity");
  const care = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "care" });
  if (/<span>Rooms<\/span><strong>|<span>Clinical equipment<\/span>/.test(care)) throw new Error("The care page no longer counts rooms and equipment in cards");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Trust and climate cannot be bought back every year at full strength: the same action taken in
// consecutive years works half as well each time, and recovers after a year off (owner, 2026-10-19).
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  const gain = () => { const base = ClinicTest.simulatePlan([]); ClinicTest.queueAction("social:staffMeeting", { kind: "social-action", targetId: "staffMeeting" }); const f = ClinicTest.simulatePlan(); return f.social.after.staffClimate - base.social.after.staffClimate; };
  const full = gain(); ClinicTest.resolveTurn();
  const second = gain(); ClinicTest.resolveTurn();
  const third = gain(); ClinicTest.resolveTurn();
  ClinicTest.resolveTurn();
  const rested = gain();
  const d = ClinicTest.data.socialModel.repeatDecay;
  if (!(d < 1)) throw new Error("A repeated trust or climate action must wear out");
  if (Math.abs(second - full * d) > .3 || Math.abs(third - full * d * d) > .3) throw new Error(`A repeated staff meeting must give ${full.toFixed(1)}, then ×${d}, then ×${d * d}: got ${full.toFixed(1)}, ${second.toFixed(1)}, ${third.toFixed(1)}`);
  if (Math.abs(rested - full) > .3) throw new Error(`After a year off it must work in full again: ${rested.toFixed(1)} against ${full.toFixed(1)}`);
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// The choice already in force is shown as current, without a button; and "moving" to where the
// clinic already is costs nothing (it cost 20 000 € and 5 % of demand — owner, 2026-10-19).
{
  const c0 = ClinicTest.initialState("balanced", "en"); ClinicTest.renderState(c0);
  const st = ClinicTest.getState();
  [["location", st.location.sectorId, "location:sector"], ["market", st.marketFocus, "market:focus"], ["stock", st.operations.stockStrategy, null], ["hr", st.hr.strategy, null]].forEach(([drawer]) => {
    const html = ClinicTest.renderUiForTest({ drawer, drawerContext: null, confirm: null });
    const current = html.match(/<article class="choice-card current">[\s\S]*?<\/article>/g) || [];
    if (current.length !== 1) throw new Error(`The ${drawer} drawer must show exactly one current choice, found ${current.length}`);
    if (/data-add-key/.test(current[0])) throw new Error(`The current ${drawer} choice must not be addable to the plan`);
  });
  const base = ClinicTest.simulatePlan([]);
  const same = ClinicTest.simulatePlan([{ key: "location:sector", payload: { kind: "location", targetId: st.location.sectorId } }]);
  if (Math.round(same.financial.netResult) !== Math.round(base.financial.netResult)) throw new Error("Choosing the current neighbourhood must cost nothing");
  const rooms = ClinicTest.renderUiForTest({ drawer: "rooms", drawerContext: null, confirm: null });
  if (/<h3>[^<]*· \d/.test(rooms)) throw new Error("A room's count must not run into its price");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Gestion's money bar adds up to the revenue, profit or loss; equipment and loans compare their
// versions on one table each; the price screen marks the price against what clients accept.
{
  const num = (t) => { const n = Number(String(t).replace(/[^\d]/g, "")); return /[−-]/.test(t) ? -n : n; };
  [["balanced", () => {}], ["balanced", (c) => { c.services.vaccination.active = true; c.services.preventive.active = true; }]].forEach(([sc, f], k) => {
    const c = ClinicTest.initialState(sc, "en"); f(c); ClinicTest.renderState(c);
    const r = ClinicTest.simulatePlan();
    const html = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "business" });
    const bar = html.match(/<section class="card-section money-bar" role="img" aria-label="([^"]*)"/)?.[1];
    if (!bar) throw new Error("The Business page must show where the money goes");
    const item = (label) => num((bar.match(new RegExp(`${label} ([−-]?€[\\d,]+)`)) || [, "0"])[1]);
    const result = r.financial.netResult >= 0 ? item("Net result") : item("Loss");
    const tax = item("Tax");
    const sum = item("Variable costs") + item("Fixed costs") + tax + result;
    if (Math.abs(sum - Math.round(r.financial.revenue + (r.financial.grant || 0))) > 3) throw new Error(`Path ${k}: the money bar must add up to the revenue: ${sum} against ${Math.round(r.financial.revenue)}`);
    if (Math.abs(item("Contribution margin") - Math.round(r.financial.revenue + (r.financial.grant || 0) - r.financial.variableCosts)) > 1) throw new Error("The contribution margin must be revenue minus variable costs");
    if (!/class="mb-seg mb-rev/.test(html) || !/class="mb-bracket"/.test(html)) throw new Error("The money bar must set revenue above where it goes, with the margin marked");
    if ((r.financial.netResult < 0) !== /class="mb-loss"/.test(html)) throw new Error("A loss must show as costs running past revenue, and only a loss");
  });
  const loans = ClinicTest.renderUiForTest({ drawer: "finance", drawerContext: null, confirm: null });
  const table = loans.match(/<table class="compare-options">[\s\S]*?<\/table>/g) || [];
  if (table.length !== 1 || (table[0].match(/data-add-key="finance:loan"/g) || []).length !== 3) throw new Error("The three loan amounts must be compared on one table, one button each");
  const eq = ClinicTest.renderUiForTest({ drawer: "equipment", drawerContext: null, confirm: null });
  const items = Object.keys(ClinicTest.data.equipment).length;
  if ((eq.match(/<table class="compare-options">/g) || []).length !== items || (eq.match(/consequence-grid/g) || []).length) throw new Error(`Each of the ${items} equipment items must compare buying and leasing on one table, with no separate preview blocks`);
  [["hr", "Staff climate changes absence"], ["capabilities", "Each service needs work from"]].forEach(([d, text]) => { const h = ClinicTest.renderUiForTest({ drawer: d, drawerContext: null, confirm: null }); if (!new RegExp(`<details class="note-repliee"><summary>[^<]*</summary><p>${text}`).test(h)) throw new Error(`The ${d} drawer's explanation must start collapsed`); });
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Marketing (owner, 2026-10-19): one communication ladder whose trust gain wears in like any repeated
// fix; no competitor monitoring; the market study buys information, not demand; a decision that
// raises demand shows the refusals and households it costs before it is planned.
{
  if (ClinicTest.data.marketingStrategies.monitoring) throw new Error("Competitor monitoring acted on nothing a student can see; it is removed");
  if (ClinicTest.data.socialActions.communication) throw new Error("Communication exists once, in the marketing ladder");
  Object.values(ClinicTest.data.marketingStrategies.geomarketing).forEach((l) => { if (l.demand) throw new Error("A market study must not raise demand"); });
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("marketing:communication", { kind: "marketing-strategy", strategy: "communication", targetId: "targeted" }); ClinicTest.resolveTurn();
  const parts = [ClinicTest.getState().history.at(-1).social.trustParts.communication];
  ClinicTest.resolveTurn(); parts.push(ClinicTest.getState().history.at(-1).social.trustParts.communication);
  ClinicTest.resolveTurn(); parts.push(ClinicTest.getState().history.at(-1).social.trustParts.communication);
  const d = ClinicTest.data.socialModel.repeatDecay, t = ClinicTest.data.marketingStrategies.communication.targeted.trust;
  if (Math.abs(parts[0] - t) > .01 || Math.abs(parts[1] - t * d) > .01 || Math.abs(parts[2] - t * d * d) > .01) throw new Error(`A kept communication programme must wear in: ${parts.join(", ")}`);
  // Demand raised on a full room: the preview shows the refusals and households it costs.
  const s0 = ClinicTest.initialState("balanced", "en"); s0.rules.actionLimit = 12; ClinicTest.renderState(s0);
  ClinicTest.queueAction("a", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("b", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn(); ClinicTest.resolveTurn();
  const html = ClinicTest.renderUiForTest({ drawer: "marketing", drawerContext: null, confirm: null });
  const card = (html.match(/<article class="choice-card"><h3>Targeted communication[\s\S]*?<\/article>/) || [""])[0];
  if (!/<span>Requests refused<\/span><strong>\+[\d,]+<\/strong>/.test(card) || /<span>Requests refused<\/span><strong>[^<]*<\/strong><em>(?!Stock-outs)/.test(card)) throw new Error("Raising demand on a full room must show the refusals it adds — without naming the constraint — in the preview");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// What the clinic knew of accepted prices is what the exports say: the same range on the price
// screen, in the PDF and in the analysis file, for the year it was known.
{
  const c0 = ClinicTest.initialState("balanced", "en"); ClinicTest.renderState(c0);
  const screen = ClinicTest.renderUiForTest({ drawer: "pricing", drawerContext: null, confirm: null }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const shown = screen.match(/General consultation[^€]*?Price your clients accept: (€[\d,]+–€[\d,]+)/i)?.[1];
  if (!shown) throw new Error("Without a study the price screen must show a range");
  ClinicTest.resolveTurn();
  const pdf = ClinicTest.buildPrintableReportHtml();
  if (!pdf.includes(shown)) throw new Error(`The PDF must show the range the clinic knew (${shown})`);
  const row = ClinicTest.buildExportPayload().years.at(-1).serviceResults.find((r) => r.id === "consult");
  if (row.acceptedPriceShown !== shown) throw new Error(`The analysis file must carry the shown range (${shown}), got ${row.acceptedPriceShown}`);
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// A decision's preview lists only what it moves, signed — no unchanged rows, no before → after list
// (the plan panel has the whole picture). Refusals it adds carry their cause: opening vaccination on
// the starting clinic adds refusals from stock-outs, not from capacity (owner, 2026-10-19).
{
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
  const html = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: "vaccination", confirm: null });
  const grid = (html.match(/<div class="consequence-grid delta-list"[\s\S]*?<\/div><\/div>/) || [""])[0];
  if (!grid) throw new Error("Opening vaccination must preview what it changes");
  if (/<strong>[+−-]?(€0|0 €|0|\+0 pts)<\/strong>/.test(grid)) throw new Error("A preview must not list what it does not change");
  if (!/<span>Requests refused<\/span><strong>\+[\d,]+<\/strong><em>Stock-outs<\/em>/.test(grid)) throw new Error("Opening vaccination must show its added refusals with their cause, stock-outs: " + grid.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  if (/Without this decision|What this decision costs/.test(html)) throw new Error("The old before → after preview is gone");
}

// The overview tells the truth about next year: a kept clients promise does not mean refusals stop
// costing trust — the access pressure says what they cost. No filler signal, no instructions.
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("a", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("b", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn();
  const f = ClinicTest.simulatePlan();
  const vue = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "overview" }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const p = f.social.after.communityPressure;
  if (!(p > 50) || !(f.operational.honoredRate >= .82)) throw new Error("This check needs a kept clients promise with pressure above 50");
  if (/refusals settle/.test(vue) || !new RegExp(`access pressure ${Math.round(p)}: −[\\d.]+ trust`).test(vue)) throw new Error("The clients promise must say what the remaining pressure costs");
  if (/carbon opportunity is visible|check the consequences before acting|explains what is happening/.test(vue)) throw new Error("The overview carries no filler signal and no instructions");
  if (!/Next year/.test(vue)) throw new Error("Next year's consequences must be grouped under « Next year »");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// A choice's card shows what that choice changes directly: its costs, line by line, and what it does
// to activity. Totals (net result, treasury), workload and indicators it does not act on directly
// are in « Impact du plan » — not repeated on every card (owner, 2026-10-19).
{
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
  const grids = (html) => (html.match(/<div class="consequence-grid delta-list"[\s\S]*?<\/div><\/div>/g) || []).join(" ");
  const market = grids(ClinicTest.renderUiForTest({ drawer: "market", drawerContext: null, confirm: null }));
  if (!market) throw new Error("Market focus must preview its effects");
  ["Net result", "End treasury", "Team workload", "Staff climate", "Client trust", "Carbon footprint"].forEach((l) => { if (market.includes(`<span>${l}</span>`)) throw new Error(`A market focus card must not repeat « ${l} »: it is in the plan panel`); });
  if (!/<span>Cases served<\/span>/.test(market)) throw new Error("A market focus card must show what it does to cases");
  const meeting = grids(ClinicTest.renderUiForTest({ drawer: "relations", drawerContext: null, confirm: null }));
  if (!/<span>Staff climate<\/span>/.test(meeting)) throw new Error("A staff meeting acts on climate directly: its card must show it");
  const opening = grids(ClinicTest.renderUiForTest({ drawer: "opening", drawerContext: null, confirm: null }));
  if (/<span>(Net result|End treasury)<\/span>/.test(opening)) throw new Error("No option card repeats the net result or the treasury");
}

// Where a person's hours go, by real cause (owner, 2026-10-19): Maya assigned 65 % to vaccination
// works 592 h because the requests need no more — « not enough demand », not « stock-outs ». The
// « short of » warning counts only hours that would add cases. A vet's hours spent on support work
// show as « support tasks covered », and a service sheet shows one case split by role.
{
  const c0 = ClinicTest.initialState("balanced", "en"); ClinicTest.renderState(c0);
  ClinicTest.queueAction("a", { kind: "toggle-service", targetId: "vaccination", value: true });
  ClinicTest.queueAction("b", { kind: "toggle-service", targetId: "preventive", value: true });
  const team = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "team" });
  const maya = (team.match(/<h3>Maya Chen<\/h3>[\s\S]*?<ul class="hb-legend">([\s\S]*?)<\/ul>/) || [, ""])[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const demand = Number((maya.match(/not enough demand ([\d,]+)/) || [, "0"])[1].replace(/,/g, ""));
  const stock = Number((maya.match(/Stock-outs ([\d,]+)/) || [, "0"])[1].replace(/,/g, ""));
  if (!(demand > 500) || !(stock < 50)) throw new Error(`Maya's idle hours are mostly a lack of demand, not stock-outs: ${maya}`);
  if (/is short of/.test(team)) throw new Error("No service here loses requests for lack of hours: no « short of » warning");
  // Moving the vet's hours to preventive care: preventive is not short of vet hours, so the move only
  // takes cases from the consultation — the warning must not have invited it.
  const f = ClinicTest.simulatePlan();
  f.operational.serviceHourRows.forEach((r) => { if (r.shortageHours > .5) { const res = f.serviceResults.find((x) => x.id === r.serviceId); if (!(res.lostBy || []).some((l) => l.reason.type === (r.role === "vet" ? "vetHours" : "supportHours"))) throw new Error(`${r.serviceId}: ${Math.round(r.shortageHours)} h « short » although no request was lost for that role's hours`); } });
  // Support work done by the vet: Maya off preventive care, the vet does those cases alone.
  const m = ClinicTest.getState().staff.find((p) => p.role === "support");
  ClinicTest.queueAction(`staff-allocation:${m.id}`, { kind: "staff-allocation", targetId: m.id, value: { allocations: [{ serviceId: "vaccination", share: 1 }] } });
  const team2 = ClinicTest.renderState({ ...ClinicTest.getState(), domain: "team" });
  const amina = (team2.match(/<h3>Dr Amina Kone<\/h3>[\s\S]*?<ul class="hb-legend">([\s\S]*?)<\/ul>/) || [, ""])[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/support tasks covered [\d,]+/.test(amina)) throw new Error("A vet doing support work must show it on their hours bar: " + amina);
  const sheet = ClinicTest.renderUiForTest({ drawer: "services", drawerContext: "core", selectedServiceId: "preventive", confirm: null });
  if (!/<div class="case-split">/.test(sheet) || !/a vet can do the whole case: 0\.72 h/.test(sheet)) throw new Error("The preventive sheet must show one case split by role, and that a vet can do it all");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// A « short of » warning must be one the student can act on: on a clinic whose shared room is full,
// adding the « missing » support hours to preventive care lowers the year — so no warning is shown.
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("a", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("b", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn(); ClinicTest.resolveTurn(); ClinicTest.resolveTurn();
  const f = ClinicTest.simulatePlan();
  f.operational.serviceHourRows.filter((r) => r.shortageHours > 5).forEach((r) => {
    const st = ClinicTest.getState();
    const who = st.staff.filter((p) => p.role === r.role);
    // Give that role's first person the missing hours on that service, taken from their other work.
    const p0 = who[0]; const extra = Math.min(.3, r.shortageHours / Math.max(1, f.operational.staffRows.find((x) => x.id === p0.id).availableHours));
    const allocations = p0.allocations.map((a) => ({ ...a, share: a.serviceId === r.serviceId ? a.share + extra : Math.max(0, a.share - extra / Math.max(1, p0.allocations.length - 1)) }));
    const g = ClinicTest.simulatePlan([{ key: "x", payload: { kind: "staff-allocation", targetId: p0.id, value: { allocations } } }]);
    if (g.operational.totalHonored < f.operational.totalHonored) throw new Error(`${r.serviceId} is announced short of ${Math.round(r.shortageHours)} h, but giving them lowers the cases served (${f.operational.totalHonored} → ${g.operational.totalHonored})`);
  });
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// Requests = cases + refusals: a card shows cases, and refusals only when demand itself moves.
{
  const c0 = ClinicTest.initialState("balanced", "en"); c0.rules.actionLimit = 12; c0.rules.targetYear = 12; ClinicTest.renderState(c0);
  ClinicTest.queueAction("a", { kind: "toggle-service", targetId: "vaccination", value: true }); ClinicTest.resolveTurn();
  ClinicTest.queueAction("b", { kind: "toggle-service", targetId: "preventive", value: true }); ClinicTest.resolveTurn(); ClinicTest.resolveTurn();
  const grids = (html) => html.match(/<article[^>]*>[\s\S]*?<\/article>/g).filter((a) => /delta-list/.test(a));
  grids(ClinicTest.renderUiForTest({ drawer: "opening", drawerContext: null, confirm: null })).forEach((card) => {
    if (/<span>Requests<\/span>/.test(card)) throw new Error("The requests line is the sum of the other two: not shown");
    if (/<span>Cases served<\/span>/.test(card) && /<span>Requests refused<\/span>/.test(card) && !/opening-period/.test("")) {
      const cases = Number(card.match(/<span>Cases served<\/span><strong>([^<]*)/)[1].replace(/[^\d-−]/g, "").replace("−", "-"));
      const refused = Number(card.match(/<span>Requests refused<\/span><strong>([^<]*)/)[1].replace(/[^\d-−]/g, "").replace("−", "-"));
      if (cases === -refused) throw new Error("When demand does not move, refusals only mirror the cases: they must not be shown");
    }
  });
  const mkt = grids(ClinicTest.renderUiForTest({ drawer: "marketing", drawerContext: null, confirm: null })).find((a) => /Targeted communication/.test(a)) || "";
  if (!/<span>Cases served<\/span>/.test(mkt) || !/<span>Requests refused<\/span>/.test(mkt)) throw new Error("When demand moves on a full clinic, the card must show both the cases and the refusals");
  ClinicTest.renderState(ClinicTest.initialState("balanced", "en"));
}

// The model map (carte-du-modele.html) is built from the code: if the code changed and the map was not
// rebuilt, the guide would lie to whoever follows it (owner, 2026-10-21).
{
  const out = require("child_process").spawnSync(process.execPath, [require("path").join(__dirname, "outils", "carte-modele.js"), "--verifier"], { encoding: "utf8" });
  if (out.status !== 0) throw new Error("The model map is out of date or no longer matches the code: " + ((out.stderr || "") + (out.stdout || "")).trim().split("\n").slice(0, 3).join(" "));
}

// The teacher's workshop (owner, 2026-10-21): a code opens a full-screen editor for the whole game —
// rules, prices and accepted prices, salaries, rooms and equipment, operations, the starting clinic,
// the currency and the names, in French and English. A teacher sees what a change does, applies it or
// downloads it; students load the file before Year 1; every export says which rules were used.
{
  const T = ClinicTest, D = T.data;
  const read = (chemin) => chemin.split(".").reduce((v, k) => (v == null ? undefined : Array.isArray(v) ? (v.find((x) => x && x.id === k) ?? v[Number(k)]) : v[k]), D);
  // Every offered rule exists and starts inside its bounds; the catalogue reaches every table.
  D.atelierSettings.forEach((def) => {
    const v = read(def.chemin);
    if (typeof v !== "number" || v < def.min || v > def.max) throw new Error(`Workshop setting ${def.chemin}: ${v} is missing or outside ${def.min}–${def.max}`);
    if (!def.nomEn || !def.texteEn) throw new Error(`Workshop setting ${def.chemin} needs an English name`);
  });
  const paths = T.atelierPaths();
  ["services.consult.price", "segments.community.willingness.consult", "scenarios.balanced.staff.vet-founder.salary", "rooms.consult.annualRent", "equipment.ultrasound.purchase", "openingPeriods.extended.cost", "scenarios.balanced.treasury", "scenarios.balanced.clients"].forEach((c) => {
    if (!paths.valeurs.includes(c)) throw new Error(`The workshop must offer ${c}`);
    if (typeof read(c) !== "number") throw new Error(`${c} does not exist in data.js`);
  });
  if (!paths.noms.includes("services.consult.name") || !paths.noms.includes("scenarios.balanced.description")) throw new Error("The workshop must offer the names of services and scenarios");
  // The code is checked by its fingerprint; the default code opens it, others do not.
  if (T.atelierFingerprint("atelier-clinique ") !== D.atelierCodeHash || T.atelierFingerprint("autre") === D.atelierCodeHash) throw new Error("The workshop code must open it, and only it");
  // Rules are cleaned: unknown paths dropped, values bounded, unchanged values dropped.
  const clean = T.cleanRules({ nom: "Test", valeurs: { "socialModel.refusedLeave": 5, "socialModel.inexistant": 3, "financeModel.taxRate": D.financeModel.taxRate }, monnaie: { code: "ZZZ", facteur: 99 } });
  if (!clean || clean.valeurs["socialModel.refusedLeave"] !== .2 || "socialModel.inexistant" in clean.valeurs || "financeModel.taxRate" in clean.valeurs || clean.monnaie.code !== "EUR" || clean.monnaie.facteur !== 5) throw new Error("Rules must be cleaned: bounded, known, and only what changes: " + JSON.stringify(clean));
  // A game carrying rules plays by them; a game without plays the original rules, even right after.
  const base = T.initialState("balanced", "en"); base.rules.actionLimit = 12; T.renderState(base);
  T.queueAction("a", { kind: "toggle-service", targetId: "vaccination", value: true }); T.resolveTurn();
  T.queueAction("b", { kind: "toggle-service", targetId: "preventive", value: true }); T.resolveTurn();
  const clinique = T.clone(T.getState());
  const original = T.simulatePlan([]);
  T.renderState({ ...T.clone(clinique), modelRules: { nom: "Plus dur", valeurs: { "socialModel.refusedLeave": .15 } } });
  const dure = T.simulatePlan([]);
  if (!(dure.next.clients < original.next.clients)) throw new Error("A game with harsher rules must lose more households");
  T.renderState(T.clone(clinique));
  if (T.simulatePlan([]).next.clients !== original.next.clients || D.socialModel.refusedLeave !== .06) throw new Error("A game without rules must play the original rules again");
  // A base price moves the accepted price with it, unless unlinked.
  const accepte = () => D.segments.community.willingness.consult;
  const origineAccepte = accepte();
  T.renderState({ ...T.clone(clinique), modelRules: { nom: "Prix", valeurs: { "services.consult.price": 60 } } }); T.simulatePlan([]);
  if (Math.abs(accepte() - origineAccepte * 60 / 48) > .01) throw new Error(`A base price of 60 must move the accepted price to ${origineAccepte * 60 / 48}, got ${accepte()}`);
  T.renderState({ ...T.clone(clinique), modelRules: { nom: "Prix", valeurs: { "services.consult.price": 60 }, delies: { consult: true } } }); T.simulatePlan([]);
  if (accepte() !== origineAccepte) throw new Error("An unlinked base price must leave the accepted price as it was");
  // The currency: amounts are shown in it; conversion is explicit, one value per amount.
  T.renderState({ ...T.initialState("balanced", "fr"), modelRules: { nom: "Genève", monnaie: { code: "CHF", facteur: 1.1 } } });
  if (!/CHF/.test(T.renderState({ ...T.getState(), domain: "business" }))) throw new Error("Amounts must be shown in the chosen currency");
  // Starting values: a game not yet started takes them; a started one keeps what it played.
  T.renderState(T.initialState("balanced", "en"));
  const fichier = JSON.stringify({ kind: "clinique-regles", version: 2, nom: "Ville", valeurs: { "socialModel.refusedLeave": .15, "scenarios.balanced.treasury": 200000, "scenarios.balanced.clients": 1500, "services.consult.price": 55 }, noms: { "services.consult.name": { fr: "Consultation de base", en: "Basic consult" } } });
  if (!T.chargerRegles(fichier)) throw new Error("A student must be able to load the teacher's rules before Year 1");
  const st = T.getState();
  if (st.treasury !== 200000 || st.clients !== 1500 || st.services.consult.price !== 55) throw new Error(`A game not yet started must take the new starting values: treasury ${st.treasury}, households ${st.clients}, price ${st.services.consult.price}`);
  if (!/Basic consult/.test(T.renderState({ ...st, domain: "care" }))) throw new Error("A renamed service must show its new name");
  if (T.chargerRegles(JSON.stringify({ kind: "autre" }))) throw new Error("Only a workshop rules file can be loaded");
  T.resolveTurn();
  if (T.chargerRegles(fichier)) throw new Error("Rules cannot be swapped once a year has been played");
  // A version-1 file (values only) still loads.
  T.renderState(T.initialState("balanced", "en"));
  if (!T.chargerRegles(JSON.stringify({ kind: "clinique-regles", version: 1, nom: "Ancien", valeurs: { "staffModel.overtimePremium": 1.5 } })) || T.getState().modelRules.valeurs["staffModel.overtimePremium"] !== 1.5) throw new Error("A version-1 rules file must still load");
  // The exports say which rules were used, section by section.
  T.renderState(T.initialState("balanced", "en")); T.chargerRegles(fichier);
  const json = T.buildExportPayload();
  if (json.modelRules.nom !== "Ville" || json.modelRules.reglages.length !== 5) throw new Error("The analysis file must list every change: " + json.modelRules.reglages.length);
  const pdf = T.buildPrintableReportHtml();
  T.renderState(T.initialState("balanced", "en")); T.chargerRegles(JSON.stringify({ kind: "clinique-regles", version: 2, nom: "Genève", valeurs: { "services.consult.price": 53 }, monnaie: { code: "CHF", facteur: 1.1 } }));
  if (!/€48\s*<\/td>\s*<td>\s*CHF\s*53/.test(T.buildPrintableReportHtml().replace(/\u00a0/g, " "))) throw new Error("The PDF must give originals in euros and the values used in the chosen currency");
  T.renderState(T.initialState("balanced", "en")); T.chargerRegles(fichier);
  if (!/Played with changed rules: « Ville »/.test(pdf) || !/Starting treasury/.test(pdf) || !/Basic consult/.test(pdf)) throw new Error("The PDF must list the changed rules, section by section");
  // The full-screen workshop: closed without the code; with it, the effect shows before applying.
  T.renderState(T.clone(clinique));
  const ferme = T.renderUiForTest({ drawer: null, atelierView: true, atelierUnlocked: false, rulesDraft: null });
  if (/class="atelier-page"/.test(ferme)) throw new Error("Without the code, the workshop must not open");
  const page = T.renderUiForTest({ drawer: null, atelierView: true, atelierUnlocked: true, atelierSection: "regles", rulesDraft: { nom: "Plus dur", valeurs: { "socialModel.refusedLeave": .15 }, noms: {}, delies: {}, monnaie: null } });
  const texte = page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/class="atelier-page"/.test(page) || !/Next year Client households [−-][\d,]+/.test(texte)) throw new Error("The workshop must show what a draft changes next year: " + (texte.match(/What these rules change[^]{0,200}/) || [""])[0]);
  if (T.getState().modelRules) throw new Error("A draft must not change the game until it is applied");
  const prix = T.renderUiForTest({ drawer: null, atelierView: true, atelierUnlocked: true, atelierSection: "services", rulesDraft: { nom: "", valeurs: {}, noms: {}, delies: {}, monnaie: null } });
  if (!/data-rule-cell="services\.consult\.price"/.test(prix) || !/data-rule-link="consult"/.test(prix)) throw new Error("The services section must offer the base prices and the accepted-price link");
  T.renderUiForTest({ atelierView: false, atelierUnlocked: false, rulesDraft: null });
  T.renderState(T.initialState("balanced", "en"));
  if (!/Played with the original rules/.test(T.buildPrintableReportHtml())) throw new Error("The PDF must say when the original rules were used");
}

require("./tests.js");

for (const item of resultItems) console.log(item.textContent);
console.log(elements["#summary"].textContent);
if (resultItems.some((item) => item.className === "fail")) process.exitCode = 1;
