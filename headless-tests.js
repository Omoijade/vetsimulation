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
  createElement() { return { className: "", textContent: "" }; }
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
if (!exitHtml.includes("severance") || !exitHtml.includes("Review letting go")) throw new Error("The letting-go review does not show its consequences");
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
if (!paceService.includes("Pace: time per case") || !paceService.includes("Who can staff this")) throw new Error("Service detail lacks pace or staffing clarity");
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
const settingsHtml = ClinicTest.renderState(settingsState);
if (!settingsHtml.includes('data-settings-field="actionLimit"') || !settingsHtml.includes("Save settings")) throw new Error("Settings are not a saved draft with one action-limit selector");
if (settingsHtml.includes('data-rule="actionLimit"')) throw new Error("Immediate legacy action-limit control is still visible");
if (!settingsHtml.includes('data-settings-field="startingTreasury"') || !settingsHtml.includes('data-settings-field="forecastPrecision"') || !settingsHtml.includes('data-settings-field="classCode"') || !settingsHtml.includes("data-adjust-cash")) throw new Error("Game setup fields are missing");
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
if (!ClinicTest.renderState(lockedState).includes('data-settings-field="startingTreasury" disabled')) throw new Error("Starting treasury should lock after Year 1");
const unlockedState = ClinicTest.getState();
unlockedState.history = [];
ClinicTest.renderState(unlockedState);
ClinicTest.renderUiForTest({ drawer: null, drawerContext: null, confirm: null });
const css = fs.readFileSync("./styles.css", "utf8");
if (!/\.button\s*\{[\s\S]*?min-height:\s*44px/.test(css)) throw new Error("Primary controls are smaller than 44px");
if (!/@media \(max-width: 1000px\)[\s\S]*?\.plan-panel\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*auto;[\s\S]*?max-height:\s*none;/.test(css)) throw new Error("Tablet Plan bar does not clear desktop positioning");
if (!/\.drawer\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?max-height:\s*100dvh;/.test(css)) throw new Error("Drawer is not constrained to the dynamic viewport");
if (!/@media \(max-width: 480px\)[\s\S]*?\.consequence-grid\s*\{\s*grid-template-columns:\s*1fr;/.test(css)) throw new Error("Phone consequence cards do not collapse to one column");
if (!/\.allocation-rows article[\s\S]*?grid-template-columns:[\s\S]*?@media \(max-width: 480px\)[\s\S]*?\.allocation-rows article\s*\{\s*grid-template-columns:\s*1fr;/.test(css)) throw new Error("Allocation rows do not collapse safely on phones");
require("./tests.js");

for (const item of resultItems) console.log(item.textContent);
console.log(elements["#summary"].textContent);
if (resultItems.some((item) => item.className === "fail")) process.exitCode = 1;
