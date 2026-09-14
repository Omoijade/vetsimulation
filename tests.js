(function () {
  "use strict";

  const T = globalThis.ClinicTest;
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = (name, fn) => {
    try { fn(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
  };
  const simulateFresh = (scenarioId, actions = []) => {
    const before = T.initialState(scenarioId, "en");
    const clinic = T.clone(before);
    const effects = T.emptyEffects();
    actions.forEach((action) => T.combineEffects(effects, T.applyAction(clinic, action, true)));
    return T.simulateYear(clinic, before, effects, actions);
  };

  test("catalog contains exactly 14 services", () => {
    assert(T.data.services.length === 14, `Expected 14, got ${T.data.services.length}`);
    assert(new Set(T.data.services.map((service) => service.id)).size === 14, "Service IDs must be unique");
  });

  test("three scenario presets initialize independently", () => {
    const ids = Object.keys(T.data.scenarios);
    assert(ids.length === 3, `Expected 3 scenarios, got ${ids.length}`);
    const treasuries = ids.map((id) => T.initialState(id, "en").treasury);
    assert(new Set(treasuries).size === 3, "Scenario treasuries should differ");
  });

  test("English and French translation trees have matching keys", () => {
    const flatten = (object, prefix = "") => Object.entries(object).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return value && typeof value === "object" ? flatten(value, path) : [path];
    }).sort();
    const en = flatten(ClinicI18n.dictionaries.en);
    const fr = flatten(ClinicI18n.dictionaries.fr);
    assert(JSON.stringify(en) === JSON.stringify(fr), "Translation keys differ");
  });

  test("equipment purchase and lease are never double charged", () => {
    const buyState = T.initialState("balanced", "en");
    const buy = T.applyAction(buyState, { payload: { kind: "equipment-acquire", targetId: "xray", mode: "buy" } }, true);
    assert(buy.oneTimeCosts === T.data.equipment.xray.purchase, "Purchase must charge purchase price once");
    assert(buyState.equipment.xray.owned === 1 && buyState.equipment.xray.leased === 0, "Purchase ownership is incorrect");
    const leaseState = T.initialState("balanced", "en");
    const lease = T.applyAction(leaseState, { payload: { kind: "equipment-acquire", targetId: "xray", mode: "lease" } }, true);
    assert(lease.oneTimeCosts === 0, "Lease must not charge purchase price");
    assert(leaseState.equipment.xray.leased === 1 && leaseState.equipment.xray.owned === 0, "Lease ownership is incorrect");
  });

  test("multi-resource services report every missing dependency", () => {
    const clinic = T.initialState("balanced", "en");
    const service = T.data.services.find((item) => item.id === "orthopedic");
    const missing = T.missingRequirements(service, clinic);
    assert(missing.some((item) => item.type === "missingRoom"), "Orthopedic room blocker missing");
    assert(missing.filter((item) => item.type === "missingEquipment").length === 2, "Orthopedic equipment blockers missing");
    assert(missing.some((item) => item.type === "missingVetSkill"), "Orthopedic vet skill blocker missing");
  });

  test("opening hours add facility capacity but not staff capacity", () => {
    const baseline = simulateFresh("balanced");
    const action = { key: "opening:extended", payload: { kind: "opening-period", targetId: "extended", value: true } };
    const extended = simulateFresh("balanced", [action]);
    const baseRoom = baseline.operational.roomUse.find((row) => row.id === "consult").capacity;
    const extendedRoom = extended.operational.roomUse.find((row) => row.id === "consult").capacity;
    assert(extendedRoom > baseRoom, "Extended hours must add room capacity");
    assert(extended.operational.startVetHours === baseline.operational.startVetHours, "Opening hours must not add vet hours");
  });

  test("stock strategies trade purchase cost against support hours", () => {
    assert(T.data.stockStrategies.basic.multiplier > T.data.stockStrategies.optimized.multiplier, "Optimized stock should cost less per purchase");
    assert(T.data.stockStrategies.basic.supportHours < T.data.stockStrategies.optimized.supportHours, "Optimized stock should use more support time");
  });

  test("recruitment acceptance uses the visible salary threshold", () => {
    const candidate = T.data.candidates[0];
    const low = T.initialState("balanced", "en");
    const lowEffect = T.applyAction(low, { payload: { kind: "hire", targetId: candidate.id, value: candidate.expectedSalary - 500 } }, true);
    assert(!low.staff.some((person) => person.id === candidate.id), "Low offer must be refused");
    assert(lowEffect.recruitment[0].accepted === false, "Refusal must be reported");
    const exact = T.initialState("balanced", "en");
    T.applyAction(exact, { payload: { kind: "hire", targetId: candidate.id, value: candidate.expectedSalary } }, true);
    assert(exact.staff.some((person) => person.id === candidate.id), "Threshold offer must be accepted");
  });

  test("loan proceeds and repayment use structured finance state", () => {
    const clinic = T.initialState("balanced", "en");
    const loan = T.applyAction(clinic, { payload: { kind: "loan", value: 50000 } }, true);
    assert(loan.cashAdjustment === 50000, "Loan proceeds missing");
    assert(clinic.finance.loan.remaining === 50000, "Loan principal missing");
    const repay = T.applyAction(clinic, { payload: { kind: "repay-loan" } }, true);
    assert(repay.cashAdjustment === -50000, "Repayment cash effect is incorrect");
    assert(clinic.finance.loan === null, "Loan should be cleared");
  });

  test("simulation is deterministic for the same state and actions", () => {
    const first = simulateFresh("growth");
    const second = simulateFresh("growth");
    assert(JSON.stringify(first.financial) === JSON.stringify(second.financial), "Financial forecast is not deterministic");
    assert(JSON.stringify(first.operational) === JSON.stringify(second.operational), "Operational forecast is not deterministic");
  });

  test("state migration preserves legacy clinic values", () => {
    const migrated = T.hydrate({ year: 3, treasury: 12345, clients: 777, services: { consult: { active: true, price: 61 } }, equipment: { anesthesia: 1 }, rooms: { consult: 3 } });
    assert(migrated.schemaVersion === 6, "Schema version was not upgraded");
    assert(migrated.year === 3 && migrated.treasury === 12345 && migrated.clients === 777, "Core values were lost");
    assert(migrated.equipment.anesthesia.owned === 1, "Legacy equipment was not migrated");
    assert(migrated.uiPreferences.beginnerGuideDismissed === false, "Legacy clinics need a safe guide preference default");
    assert(migrated.staff.every((person) => person.allocations.reduce((sum, row) => sum + row.share, 0) === 1), "Legacy staff allocations were not migrated");
  });

  test("legacy primary and secondary assignments preserve the forecast", () => {
    const current = T.initialState("balanced", "en");
    const expected = T.simulateYear(T.clone(current), current, T.emptyEffects(), []);
    const legacy = T.clone(current);
    legacy.schemaVersion = 5;
    legacy.staff.forEach((person) => { delete person.allocations; });
    const migrated = T.hydrate(legacy);
    const actual = T.simulateYear(T.clone(migrated), migrated, T.emptyEffects(), []);
    assert(actual.operational.totalHonored === expected.operational.totalHonored, "Migrated assignments changed cases served");
    assert(Math.abs(actual.financial.netResult - expected.financial.netResult) < 1e-9, "Migrated assignments changed the financial forecast");
  });

  test("one person can divide conserved hours across more than three services", () => {
    const clinic = T.initialState("balanced", "en");
    clinic.staff[0].allocations = [{ serviceId: "consult", share: .3 }, { serviceId: "surgery", share: .2 }, { serviceId: "preventive", share: .2 }, { serviceId: "emergency", share: .15 }, { serviceId: "radiography", share: .15 }];
    assert(T.validAllocations(clinic.staff[0], clinic.staff[0].allocations), "Valid five-service allocation was rejected");
    const report = T.simulateYear(T.clone(clinic), clinic, T.emptyEffects(), []);
    const row = report.operational.staffRows.find((item) => item.id === clinic.staff[0].id);
    const assigned = row.assignments.reduce((sum, assignment) => sum + assignment.assignedHours, 0);
    assert(Math.abs(assigned - row.availableHours) < 1e-8, "Assigned hours do not equal available hours");
    assert(row.assignments.length === 5, "Five service assignments were not retained");
    row.assignments.forEach((assignment) => assert(Math.abs(assignment.assignedHours - row.availableHours * assignment.share) < 1e-8, "Service share produced incorrect hours"));
  });

  const busyConsultClinic = (share) => {
    const clinic = T.initialState("balanced", "en");
    clinic.clients = 6000;
    clinic.staff.find((person) => person.id === "vet-founder").allocations = [{ serviceId: "consult", share }];
    return clinic;
  };

  test("allocations are capped at 130% and may fall below 100%", () => {
    const person = T.initialState("balanced", "en").staff[0];
    assert(T.validAllocations(person, [{ serviceId: "consult", share: .8 }, { serviceId: "surgery", share: .5 }]), "A 130% allocation should be allowed");
    assert(!T.validAllocations(person, [{ serviceId: "consult", share: .85 }, { serviceId: "surgery", share: .5 }]), "A 135% allocation must be rejected");
    assert(T.validAllocations(person, [{ serviceId: "consult", share: .8 }]), "An 80% allocation should be allowed as idle time");
    assert(T.validAllocations(person, [{ serviceId: "consult", share: 1.2 }]), "Overtime on a single service should be allowed");
  });

  test("overtime is paid, lowers staff climate, and raises next-year absence", () => {
    const normal = busyConsultClinic(1);
    const overtime = busyConsultClinic(1.2);
    const normalReport = T.simulateYear(T.clone(normal), normal, T.emptyEffects(), []);
    const overtimeReport = T.simulateYear(T.clone(overtime), overtime, T.emptyEffects(), []);
    const row = overtimeReport.operational.staffRows.find((item) => item.id === "vet-founder");
    assert(normalReport.financial.overtimeHours === 0, "A 100% allocation must not create overtime");
    assert(row.overtimeHours > 0 && overtimeReport.financial.overtimePay > 0, "Worked overtime was not paid");
    assert(overtimeReport.social.after.staffClimate < normalReport.social.after.staffClimate, "Overtime did not lower staff climate");
    assert(overtimeReport.operational.totalHonored > normalReport.operational.totalHonored, "Overtime hours did not serve more cases");
    const nextYear = T.clone(overtime);
    nextYear.staff.find((person) => person.id === "vet-founder").lastOvertimeRatio = row.overtimeHours / row.availableHours;
    const nextRow = T.simulateYear(T.clone(nextYear), nextYear, T.emptyEffects(), []).operational.staffRows.find((item) => item.id === "vet-founder");
    assert(nextRow.expectedAbsenceHours > row.expectedAbsenceHours, "Last year's overtime did not raise absence");
  });

  test("allocations below 100% show paid idle time without overtime", () => {
    const clinic = busyConsultClinic(.8);
    const row = T.simulateYear(T.clone(clinic), clinic, T.emptyEffects(), []).operational.staffRows.find((item) => item.id === "vet-founder");
    assert(row.idleHours > 0 && row.overtimeHours === 0, "Idle hours were not reported");
    assert(Math.abs(row.idleHours - row.availableHours * .2) < 1e-8, "Idle hours do not match the unassigned share");
  });

  test("per-person training gives the skill and training hours to one person only", () => {
    const clinic = T.initialState("balanced", "en");
    const candidate = T.data.candidates.find((item) => item.id === "vet-generalist");
    T.applyAction(clinic, { payload: { kind: "hire", targetId: candidate.id, value: candidate.expectedSalary } }, false);
    const effect = T.applyAction(clinic, { payload: { kind: "training", targetId: "ultrasound", personId: "vet-founder" } }, true);
    assert(clinic.staff.find((person) => person.id === "vet-founder").skills.includes("ultrasound"), "Trainee did not receive the skill");
    assert(!clinic.staff.find((person) => person.id === candidate.id).skills.includes("ultrasound"), "Training spread to another veterinarian");
    assert(effect.oneTimeCosts === T.data.trainings.ultrasound.cost, "Training cost was not charged once");
    const rows = T.simulateYear(T.clone(clinic), clinic, effect, []).operational.staffRows;
    assert(rows.find((row) => row.id === "vet-founder").trainingHours === T.data.trainings.ultrasound.hours, "Trainee hours were not deducted");
    assert(rows.find((row) => row.id === candidate.id).trainingHours === 0, "Another person lost training hours");
  });

  test("fast pace serves more cases but lowers client trust", () => {
    const clinic = busyConsultClinic(1);
    const standard = T.simulateYear(T.clone(clinic), clinic, T.emptyEffects(), []);
    const fast = T.clone(clinic);
    T.applyAction(fast, { payload: { kind: "service-pace", targetId: "consult", value: "fast" } }, true);
    const fastReport = T.simulateYear(T.clone(fast), fast, T.emptyEffects(), []);
    assert(fastReport.operational.totalHonored > standard.operational.totalHonored, "Fast pace did not serve more cases");
    assert(fastReport.social.after.clientTrust < standard.social.after.clientTrust, "Fast pace did not lower client trust");
  });

  test("saves without pace or overtime history still load and forecast", () => {
    const saved = T.initialState("balanced", "en");
    Object.values(saved.services).forEach((service) => { delete service.pace; });
    saved.staff.forEach((person) => { delete person.lastOvertimeRatio; });
    saved.pending = { "training:ultrasound": { key: "training:ultrasound", payload: { kind: "training", targetId: "ultrasound" } } };
    const restored = T.hydrate(saved);
    const report = T.simulateYear(T.clone(restored), restored, T.emptyEffects(), []);
    assert(Number.isFinite(report.financial.netResult) && report.financial.overtimeHours === 0, "Older save did not forecast cleanly");
  });

  test("person and service hour usage reconcile", () => {
    const report = simulateFresh("growth");
    const peopleUsed = report.operational.staffRows.reduce((sum, row) => sum + row.usedHours, 0);
    const servicesUsed = report.operational.serviceHourRows.reduce((sum, row) => sum + row.usedHours, 0);
    const clinicUsed = report.operational.startVetHours - report.operational.remainingVetHours + report.operational.startSupportHours - report.operational.remainingSupportHours;
    assert(Math.abs(peopleUsed - servicesUsed) < 1e-8, "Person hours do not reconcile with service hours");
    assert(Math.abs(peopleUsed - clinicUsed) < 1e-8, "Person hours do not reconcile with clinic workload");
  });

  test("unqualified allocations stay blocked until training is planned", () => {
    const clinic = T.initialState("balanced", "en");
    clinic.services.ultrasound.active = true;
    clinic.rooms.imaging = 1;
    clinic.equipment.ultrasound.owned = 1;
    const candidate = T.data.candidates.find((item) => item.id === "support-imaging-candidate");
    T.applyAction(clinic, { payload: { kind: "hire", targetId: candidate.id, value: candidate.expectedSalary } }, false);
    clinic.staff.find((person) => person.id === "vet-founder").allocations = [{ serviceId: "ultrasound", share: 1 }];
    clinic.staff.find((person) => person.id === candidate.id).allocations = [{ serviceId: "ultrasound", share: 1 }];
    const blocked = T.simulateYear(T.clone(clinic), clinic, T.emptyEffects(), []);
    assert(blocked.operational.staffRows.find((row) => row.id === "vet-founder").blockedHours > 0, "Unqualified hours were treated as effective");
    const trainedClinic = T.clone(clinic);
    const training = T.applyAction(trainedClinic, { payload: { kind: "training", targetId: "ultrasound" } }, true);
    const trained = T.simulateYear(trainedClinic, clinic, training, []);
    assert(trained.operational.staffRows.find((row) => row.id === "vet-founder").blockedHours === 0, "Planned training did not unblock assigned hours");
  });

  test("beginner signals explain the balanced clinic without changing it", () => {
    const clinic = T.initialState("balanced", "en");
    const before = T.clone(clinic);
    const report = T.simulateYear(T.clone(clinic), before, T.emptyEffects(), []);
    const snapshot = JSON.stringify(clinic);
    const signals = T.getBeginnerSignals(report, clinic);
    assert(signals.some((signal) => signal.key === "financialLoss"), "Balanced startup should explain its financial loss");
    assert(signals.some((signal) => signal.key === "teamUnderused"), "Balanced startup should explain team underuse");
    assert(signals.length <= 3, "Overview should show no more than three causal signals");
    assert(JSON.stringify(clinic) === snapshot, "View-only signals changed clinic economics");
  });

  test("guide preferences persist without becoming gameplay actions", () => {
    const clinic = T.initialState("balanced", "en");
    clinic.uiPreferences.beginnerGuideDismissed = true;
    const restored = T.hydrate(clinic);
    assert(restored.uiPreferences.beginnerGuideDismissed === true, "Guide dismissal was not preserved");
    assert(Object.keys(restored.pending).length === 0, "Guide dismissal created a gameplay action");
  });

  test("carbon model covers every service with explicit activity", () => {
    T.data.services.forEach((service) => {
      assert(service.carbonActivity, `${service.id} has no carbon activity`);
      ["electricityKWhPerCase", "clinicalWasteKgPerCase", "generalWasteKgPerCase", "anaestheticMlPerCase", "clientTripsPerCase"].forEach((key) => {
        assert(Number.isFinite(service.carbonActivity[key]), `${service.id}.${key} is invalid`);
      });
    });
  });

  test("carbon factor registry is versioned, sourced, and uses audited 2025 values", () => {
    const model = T.data.carbonModel;
    assert(model.version === "2025.2-BE", "Carbon factor version is stale");
    Object.values(model.factorRegistry).forEach((factor) => {
      assert(Number.isFinite(factor.value), "A carbon factor has no numeric value");
      assert(factor.unit && factor.year && factor.source && factor.detail, "A carbon factor is missing provenance");
    });
    assert(model.factors.naturalGasKgPerKWh === .18296, "Natural-gas factor does not match UK 2025");
    assert(model.factors.carKgPerKm === .16272, "Average petrol-car factor does not match UK 2025");
    assert(model.factors.electricityKgPerKWh === .145, "Belgian electricity factor does not match EEA 2023");
  });

  test("carbon forecast is deterministic and source totals reconcile", () => {
    const first = simulateFresh("growth");
    const second = simulateFresh("growth");
    assert(JSON.stringify(first.carbon) === JSON.stringify(second.carbon), "Carbon forecast is not deterministic");
    const sourceTotal = Object.values(first.carbon.bySource).reduce((sum, value) => sum + value, 0);
    assert(Math.abs(sourceTotal - first.carbon.total) < 1e-9, "Carbon sources do not reconcile to total");
  });

  test("low-flow anaesthesia reduces clinical carbon without changing demand", () => {
    const clinic = T.initialState("balanced", "en");
    clinic.services.surgery.active = true;
    clinic.rooms.surgery = 1;
    clinic.equipment.anesthesia.owned = 1;
    clinic.staff[0].allocations = [{ serviceId: "surgery", share: 1 }];
    clinic.staff.push(T.clone(T.data.candidates.find((item) => item.id === "support-surgery")));
    clinic.staff[clinic.staff.length - 1].salary = 34000;
    clinic.staff[clinic.staff.length - 1].allocations = [{ serviceId: "surgery", share: 1 }];
    const before = T.clone(clinic);
    const standard = T.simulateYear(T.clone(clinic), before, T.emptyEffects(), []);
    const effect = T.applyAction(clinic, { payload: { kind: "sustainability", targetId: "anaesthesiaProtocol", value: "lowFlow" } }, true);
    const lowFlow = T.simulateYear(clinic, before, effect, []);
    assert(lowFlow.carbon.bySource.clinical < standard.carbon.bySource.clinical, "Low-flow should reduce clinical carbon");
    assert(lowFlow.serviceResults.find((row) => row.id === "surgery").demand === standard.serviceResults.find((row) => row.id === "surgery").demand, "Low-flow should not change demand");
  });

  test("solar lowers purchased electricity and building carbon", () => {
    const clinic = T.initialState("balanced", "en");
    const before = T.clone(clinic);
    const baseline = T.simulateYear(T.clone(clinic), before, T.emptyEffects(), []);
    const effect = T.applyAction(clinic, { payload: { kind: "sustainability", targetId: "solar", value: true } }, true);
    const solar = T.simulateYear(clinic, before, effect, []);
    assert(solar.carbon.activity.purchasedElectricityKWh < baseline.carbon.activity.purchasedElectricityKWh, "Solar should lower purchased electricity");
    assert(solar.carbon.bySource.building < baseline.carbon.bySource.building, "Solar should lower building carbon");
  });

  test("parking increases modelled client car travel", () => {
    const clinic = T.initialState("balanced", "en");
    const before = T.clone(clinic);
    const baseline = T.simulateYear(T.clone(clinic), before, T.emptyEffects(), []);
    const effect = T.applyAction(clinic, { payload: { kind: "parking", value: true } }, true);
    const parking = T.simulateYear(clinic, before, effect, []);
    assert(parking.carbon.activity.carKm > baseline.carbon.activity.carKm, "Parking should increase modelled car travel");
  });

  test("structured vacancy offers preserve the visible recruitment criteria", () => {
    const clinic = T.initialState("balanced", "en");
    const candidate = T.data.candidates.find((item) => item.id === "vet-generalist");
    const value = { role: "vet", desiredSkills: ["general"], salaryBudget: 55000, offeredSalary: candidate.expectedSalary };
    const effect = T.applyAction(clinic, { payload: { kind: "hire", targetId: candidate.id, value } }, true);
    assert(effect.recruitment[0].accepted, "Structured threshold offer should be accepted");
    assert(clinic.staff.some((person) => person.id === candidate.id), "Structured offer did not add the candidate");
  });

  test("carbon goal cannot be achieved by closing all services", () => {
    const clinic = T.initialState("balanced", "en");
    Object.values(clinic.services).forEach((service) => { service.active = false; });
    const report = T.simulateYear(clinic, clinic, T.emptyEffects(), []);
    const carbonGoal = T.goalChecks(report, clinic).find((goal) => goal.id === "carbon");
    assert(carbonGoal && !carbonGoal.ok, "Closing care should not satisfy the carbon goal");
  });

  test("sustainability installation costs are charged once and annual costs recur", () => {
    const clinic = T.initialState("balanced", "en");
    const first = T.applyAction(clinic, { payload: { kind: "sustainability", targetId: "solar", value: true } }, true);
    const second = T.applyAction(clinic, { payload: { kind: "sustainability", targetId: "solar", value: true } }, true);
    assert(first.oneTimeCosts === T.data.sustainability.interventions.solar.once, "Solar installation cost is incorrect");
    assert(second.oneTimeCosts === 0, "Installed solar must not be charged twice");
    const report = T.simulateYear(clinic, clinic, T.emptyEffects(), []);
    assert(report.financial.sustainabilityCost === T.data.sustainability.interventions.solar.annual, "Solar annual maintenance is missing");
  });

  test("analytical and printable exports include staffing and reflections", () => {
    const clinic = T.initialState("balanced", "en");
    const report = T.simulateYear(T.clone(clinic), clinic, T.emptyEffects(), []);
    clinic.history = [report];
    clinic.reflections = { 1: { rationale: "We used spare time", expected: "More care", observed: "It worked", surprise: "Travel rose", uncertainty: "Demand" } };
    clinic.playerTeam = { teamName: "Team Cedar", participantNames: ["Alex", "Sam"] };
    T.renderState(clinic);
    const json = T.buildExportPayload();
    assert(json.playerTeam.teamName === "Team Cedar", "Export lost team identity");
    assert(json.years[0].operational.staffRows.length === clinic.staff.length, "JSON export lost staff hour rows");
    assert(json.years[0].reflection.rationale === "We used spare time", "JSON export lost reflection text");
    const printable = T.buildPrintableReportHtml();
    assert(printable.includes("Team Cedar") && printable.includes("We used spare time"), "Printable report lost participant or reflection detail");
    assert(printable.includes("Staff hours") && printable.includes("Carbon footprint"), "Printable report lacks operational or carbon detail");
  });

  const planYear = (scenarioId, payloads, mutate) => {
    const before = T.initialState(scenarioId, "en");
    const clinic = T.clone(before);
    if (mutate) mutate(clinic);
    const effects = T.emptyEffects();
    payloads.forEach((payload) => T.combineEffects(effects, T.applyAction(clinic, { payload }, true)));
    return T.simulateYear(clinic, before, effects, []);
  };
  const openServices = (...ids) => ids.map((id) => ({ kind: "toggle-service", targetId: id, value: true }));
  const facility = (report, id) => report.operational.facilityRows.find((row) => row.id === id);

  test("calibration: doing nothing loses money but a sensible Balanced year uses the team", () => {
    const idle = planYear("balanced", []);
    assert(idle.financial.netResult < 0, "Balanced with no actions should lose money");
    assert(idle.operational.staffUse >= .3 && idle.operational.staffUse <= .55, `Balanced idle staff use out of range: ${idle.operational.staffUse}`);
    const plan = planYear("balanced", openServices("vaccination", "preventive"));
    assert(plan.operational.staffUse >= .6 && plan.operational.staffUse <= .9, `Sensible plan staff use out of range: ${plan.operational.staffUse}`);
    assert(plan.financial.netResult > idle.financial.netResult + 50000, "Opening compatible services should clearly improve the result");
    assert(plan.operational.staffRows.find((row) => row.id === "support-maya").workload > .6, "Maya's hours should be used once her services open");
  });

  test("calibration: Rescue can recover and Growth assets pay off", () => {
    const rescueIdle = planYear("rescue", []);
    const rescuePlan = planYear("rescue", openServices("preventive"));
    assert(rescueIdle.financial.netResult < 0, "Rescue with no actions should lose money");
    assert(rescuePlan.financial.netResult - rescueIdle.financial.netResult > 25000, "A recovery action should improve Rescue by more than €25k");
    const growth = planYear("growth", openServices("preventive"));
    assert(growth.financial.netResult >= 0, "A sensible Growth year should not lose money");
    assert(facility(growth, "ultrasound").rate >= .3, "Growth's ultrasound should be meaningfully used");
  });

  test("a full shared room cuts every service by the same share and capacity relieves it", () => {
    const full = planYear("balanced", openServices("vaccination", "preventive"));
    const consult = facility(full, "consult");
    assert(consult.full && consult.turnedAway > 0, "The single consult room should fill when core services open");
    const ratios = full.serviceResults.filter((row) => row.active && row.staffCap > 100 && T.data.services.find((service) => service.id === row.id).roomIds.includes("consult")).map((row) => row.honored / row.staffCap);
    assert(ratios.length > 1 && Math.max(...ratios) - Math.min(...ratios) < .02, `Room time was not shared evenly: ${ratios.join(", ")}`);
    const relieved = planYear("balanced", [...openServices("vaccination", "preventive"), { kind: "room-add", targetId: "consult" }]);
    assert(!facility(relieved, "consult").full && relieved.operational.totalHonored > full.operational.totalHonored, "A second consult room should relieve the bottleneck");
    const extended = planYear("balanced", [...openServices("vaccination", "preventive"), { kind: "opening-period", targetId: "extended", value: true }]);
    assert(extended.operational.totalHonored > full.operational.totalHonored, "Extended opening should add room time and cases");
  });

  test("vets can cover support-only services", () => {
    const report = planYear("balanced", openServices("vaccination"), (clinic) => {
      clinic.staff.find((person) => person.id === "vet-founder").allocations = [{ serviceId: "consult", share: .5 }, { serviceId: "vaccination", share: .5 }];
      clinic.staff.find((person) => person.id === "support-maya").allocations = [{ serviceId: "preventive", share: 1 }];
    });
    const vaccination = report.serviceResults.find((row) => row.id === "vaccination");
    assert(vaccination.honored > 0 && vaccination.vetCoverHours > 0, "A vet should be able to run vaccination");
    const assignment = report.operational.staffRows.find((row) => row.id === "vet-founder").assignments.find((row) => row.serviceId === "vaccination");
    assert(assignment.qualified && assignment.usedHours > 0, "The vet's vaccination hours were not used");
  });

  test("open services with nobody assigned are reported as unstaffed, not ready", () => {
    const report = planYear("balanced", openServices("vaccination"), (clinic) => {
      clinic.staff.find((person) => person.id === "support-maya").allocations = [{ serviceId: "preventive", share: 1 }];
    });
    const vaccination = report.serviceResults.find((row) => row.id === "vaccination");
    assert(vaccination.honored === 0 && vaccination.bottleneck.type === "unstaffed", "Unstaffed vaccination should serve nothing and say why");
    assert(report.operational.readyServices === 1, "Only the staffed consultation should count as ready");
  });

  test("the first signal points at hours wasted on closed services", () => {
    const clinic = T.initialState("balanced", "en");
    const report = T.simulateYear(T.clone(clinic), clinic, T.emptyEffects(), []);
    const signals = T.getBeginnerSignals(report, clinic);
    assert(signals[0].key === "hoursOnClosedServices" && signals[0].text.includes("Vaccination"), "Maya's wasted hours should be the first signal");
    assert(signals[0].destination.service === "vaccination" && signals[0].secondary.destination.context === "support-maya", "The signal should link to both fixes");
  });

  test("results explain why each number changed", () => {
    const clinic = T.initialState("balanced", "en");
    clinic.history = [T.simulateYear(T.clone(clinic), clinic, T.emptyEffects(), [])];
    clinic.domain = "results";
    const html = T.renderState(clinic);
    assert(html.includes("Why each number changed") && html.includes("Staff climate") && html.includes("Client trust"), "Results do not explain metric changes");
  });

  const list = document.querySelector("#results");
  results.forEach((result) => {
    const item = document.createElement("li");
    item.className = result.ok ? "pass" : "fail";
    item.textContent = result.ok ? `PASS — ${result.name}` : `FAIL — ${result.name}: ${result.error}`;
    list.appendChild(item);
  });
  const passed = results.filter((result) => result.ok).length;
  document.querySelector("#summary").textContent = `${passed}/${results.length} tests passed`;
  document.title = passed === results.length ? "PASS — Clinic Simulation Tests" : "FAIL — Clinic Simulation Tests";
})();
