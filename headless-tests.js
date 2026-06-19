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
ClinicTest.renderState(careState);
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
const allocationHtml = ClinicTest.renderUiForTest({ drawer: "staffAllocation", drawerContext: "vet-founder", confirm: null, allocationDrafts: {} });
if (!allocationHtml.includes("does not create new hours") || !allocationHtml.includes("100% assigned") || !allocationHtml.includes("Live impact")) throw new Error("Allocation drawer lacks conservation guidance or live consequences");
if ((allocationHtml.match(/data-allocation-adjust/g) || []).length < 4) throw new Error("Allocation drawer lacks accessible 5% controls");
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
