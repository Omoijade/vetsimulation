(function (root) {
  "use strict";

  const bi = (en, fr) => ({ en, fr });

  // Scales every service's base yearly requests so that a well-staffed clinic
  // can fill most of its paid hours. Tuned against the calibration tests.
  const demandScale = 2.2;

  const skills = {
    general: bi("General practice", "Médecine générale"),
    preventive: bi("Preventive care", "Soins préventifs"),
    surgery: bi("Surgery and anaesthesia", "Chirurgie et anesthésie"),
    lab: bi("Laboratory diagnostics", "Diagnostic de laboratoire"),
    imaging: bi("Imaging support", "Soutien en imagerie"),
    ultrasound: bi("Ultrasound", "Échographie"),
    dentistry: bi("Dentistry", "Dentisterie"),
    emergency: bi("Emergency support", "Soutien aux urgences"),
    inpatient: bi("Inpatient care", "Soins hospitaliers"),
    orthopedics: bi("Orthopedic surgery", "Chirurgie orthopédique"),
    pharmacy: bi("Pharmacy standards", "Normes pharmaceutiques"),
    animalCare: bi("Animal care", "Soins animaliers")
  };

  const services = [
    { id: "consult", name: bi("General consultation", "Consultation générale"), category: bi("Core care", "Soins essentiels"), price: 48, demand: 900, duration: .55, vetShare: 1, supportShare: 0, roomIds: ["consult"], equipmentIds: [], vetSkills: ["general"], supportSkills: [], operations: [], variableCost: .12, elasticity: .18, priority: 1, active: true },
    { id: "vaccination", name: bi("Vaccination", "Vaccination"), category: bi("Core care", "Soins essentiels"), price: 58, demand: 680, duration: .34, vetShare: 0, supportShare: 1, roomIds: ["consult"], equipmentIds: [], vetSkills: [], supportSkills: ["preventive"], operations: [], variableCost: .22, elasticity: .20, priority: 1, active: false },
    { id: "preventive", name: bi("Preventive care", "Soins préventifs"), category: bi("Core care", "Soins essentiels"), price: 72, demand: 520, duration: .72, vetShare: .35, supportShare: .65, roomIds: ["consult"], equipmentIds: [], vetSkills: ["general"], supportSkills: ["preventive"], operations: [], variableCost: .20, elasticity: .28, priority: 2, active: false },
    { id: "surgery", name: bi("Basic surgery", "Chirurgie courante"), category: bi("Surgery", "Chirurgie"), price: 420, demand: 118, duration: 2.6, vetShare: 1, supportShare: 1, roomIds: ["surgery"], equipmentIds: ["anesthesia"], vetSkills: ["general"], supportSkills: ["surgery"], operations: [], variableCost: .36, elasticity: .16, priority: 3, active: false },
    { id: "lab", name: bi("Laboratory diagnostics", "Analyses de laboratoire"), category: bi("Diagnostics", "Diagnostic"), price: 86, demand: 310, duration: .38, vetShare: 0, supportShare: 1, roomIds: ["lab"], equipmentIds: ["labAnalyzer"], vetSkills: [], supportSkills: ["lab"], operations: [], variableCost: .28, elasticity: .34, priority: 2, active: false },
    { id: "ultrasound", name: bi("Ultrasound imaging", "Échographie"), category: bi("Imaging", "Imagerie"), price: 145, demand: 180, duration: .82, vetShare: 1, supportShare: .55, roomIds: ["imaging"], equipmentIds: ["ultrasound"], vetSkills: ["ultrasound"], supportSkills: ["imaging"], operations: [], variableCost: .22, elasticity: .32, priority: 3, active: false },
    { id: "dentistry", name: bi("Dental scaling", "Détartrage dentaire"), category: bi("Dentistry", "Dentisterie"), price: 205, demand: 165, duration: 1.35, vetShare: 1, supportShare: .8, roomIds: ["dental"], equipmentIds: ["dentalUnit"], vetSkills: ["dentistry"], supportSkills: ["surgery"], operations: [], variableCost: .30, elasticity: .52, priority: 4, active: false },
    { id: "emergency", name: bi("Emergency consultation", "Consultation d’urgence"), category: bi("Emergency", "Urgences"), price: 150, demand: 180, duration: 1, vetShare: 1, supportShare: .4, roomIds: ["consult"], equipmentIds: [], vetSkills: ["general"], supportSkills: ["emergency"], operations: ["emergencyCoverage"], variableCost: .18, elasticity: .10, priority: 1, active: false },
    { id: "radiography", name: bi("Radiography", "Radiographie"), category: bi("Imaging", "Imagerie"), price: 120, demand: 220, duration: .55, vetShare: .35, supportShare: .65, roomIds: ["imaging"], equipmentIds: ["xray"], vetSkills: ["general"], supportSkills: ["imaging"], operations: [], variableCost: .25, elasticity: .30, priority: 3, active: false },
    { id: "hospital", name: bi("Hospitalization / day care", "Hospitalisation / soins de jour"), category: bi("Inpatient care", "Hospitalisation"), price: 180, demand: 140, duration: 1.8, vetShare: .25, supportShare: 1, roomIds: ["ward"], equipmentIds: ["cages"], vetSkills: ["general"], supportSkills: ["inpatient"], operations: [], variableCost: .32, elasticity: .22, priority: 2, active: false },
    { id: "orthopedic", name: bi("Orthopedic surgery", "Chirurgie orthopédique"), category: bi("Specialist surgery", "Chirurgie spécialisée"), price: 950, demand: 55, duration: 4, vetShare: 1, supportShare: 1, roomIds: ["surgery"], equipmentIds: ["anesthesia", "orthopedicKit"], vetSkills: ["orthopedics"], supportSkills: ["surgery"], operations: [], variableCost: .42, elasticity: .18, priority: 5, active: false },
    { id: "pharmacy", name: bi("Pharmacy dispensing", "Délivrance pharmaceutique"), category: bi("Pharmacy", "Pharmacie"), price: 42, demand: 700, duration: .12, vetShare: 0, supportShare: 1, roomIds: ["dispensary"], equipmentIds: ["pharmacySystem"], vetSkills: [], supportSkills: ["pharmacy"], operations: [], variableCost: .62, elasticity: .55, priority: 2, active: false },
    { id: "retail", name: bi("Nutrition and retail", "Nutrition et vente"), category: bi("Retail", "Vente"), price: 35, demand: 450, duration: .08, vetShare: 0, supportShare: .3, roomIds: ["retail"], equipmentIds: [], vetSkills: [], supportSkills: [], operations: [], variableCost: .68, elasticity: .70, priority: 4, active: false },
    { id: "boarding", name: bi("Boarding", "Pension"), category: bi("Animal care", "Soins animaliers"), price: 48, demand: 380, duration: .35, vetShare: 0, supportShare: 1, roomIds: ["kennel"], equipmentIds: ["boardingUnits"], vetSkills: [], supportSkills: ["animalCare"], operations: [], variableCost: .35, elasticity: .45, priority: 4, active: false }
  ];

  // Activity coefficients are transparent simulation assumptions rather than
  // universal clinical averages. Conversion factors are versioned separately.
  const carbonActivity = {
    consult:      { electricityKWhPerCase: .8, clinicalWasteKgPerCase: .10, generalWasteKgPerCase: .15, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    vaccination:  { electricityKWhPerCase: .5, clinicalWasteKgPerCase: .08, generalWasteKgPerCase: .12, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    preventive:   { electricityKWhPerCase: .8, clinicalWasteKgPerCase: .10, generalWasteKgPerCase: .15, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    surgery:      { electricityKWhPerCase: 8,  clinicalWasteKgPerCase: 2.50, generalWasteKgPerCase: 1.00, anaestheticMlPerCase: 12, clientTripsPerCase: 1 },
    lab:          { electricityKWhPerCase: 1.5,clinicalWasteKgPerCase: .35, generalWasteKgPerCase: .10, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    ultrasound:   { electricityKWhPerCase: 1.8,clinicalWasteKgPerCase: .20, generalWasteKgPerCase: .10, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    dentistry:    { electricityKWhPerCase: 5,  clinicalWasteKgPerCase: 1.50, generalWasteKgPerCase: .50, anaestheticMlPerCase: 8,  clientTripsPerCase: 1 },
    emergency:    { electricityKWhPerCase: 1.5,clinicalWasteKgPerCase: .30, generalWasteKgPerCase: .20, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    radiography:  { electricityKWhPerCase: 2.5,clinicalWasteKgPerCase: .25, generalWasteKgPerCase: .10, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    hospital:     { electricityKWhPerCase: 6,  clinicalWasteKgPerCase: 1.00, generalWasteKgPerCase: 1.00, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    orthopedic:   { electricityKWhPerCase: 12, clinicalWasteKgPerCase: 4.00, generalWasteKgPerCase: 1.50, anaestheticMlPerCase: 18, clientTripsPerCase: 1 },
    pharmacy:     { electricityKWhPerCase: .3, clinicalWasteKgPerCase: .05, generalWasteKgPerCase: .15, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    retail:       { electricityKWhPerCase: .2, clinicalWasteKgPerCase: 0,   generalWasteKgPerCase: .20, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 },
    boarding:     { electricityKWhPerCase: 4,  clinicalWasteKgPerCase: .20, generalWasteKgPerCase: 1.50, anaestheticMlPerCase: 0,  clientTripsPerCase: 1 }
  };
  services.forEach((service) => { service.carbonActivity = carbonActivity[service.id]; });

  const rooms = {
    consult: { name: bi("Consult room", "Salle de consultation"), fitout: 5200, annualRent: 5200, capacityHours: 2256, baseIncluded: 1 },
    surgery: { name: bi("Surgery room", "Salle de chirurgie"), fitout: 8400, annualRent: 8400, capacityHours: 2256, baseIncluded: 0 },
    lab: { name: bi("Laboratory", "Laboratoire"), fitout: 4600, annualRent: 4600, capacityHours: 2256, baseIncluded: 0 },
    imaging: { name: bi("Imaging room", "Salle d’imagerie"), fitout: 5200, annualRent: 5200, capacityHours: 2256, baseIncluded: 0 },
    dental: { name: bi("Dental room", "Salle dentaire"), fitout: 4800, annualRent: 4800, capacityHours: 2256, baseIncluded: 0 },
    ward: { name: bi("Hospital ward", "Unité d’hospitalisation"), fitout: 9800, annualRent: 7200, capacityHours: 2256, baseIncluded: 0 },
    dispensary: { name: bi("Dispensary", "Dispensaire pharmaceutique"), fitout: 3900, annualRent: 3000, capacityHours: 2256, baseIncluded: 0 },
    retail: { name: bi("Retail area", "Espace de vente"), fitout: 3200, annualRent: 2600, capacityHours: 2256, baseIncluded: 0 },
    kennel: { name: bi("Boarding kennel", "Chenil de pension"), fitout: 12500, annualRent: 9000, capacityHours: 2256, baseIncluded: 0 }
  };

  const roomCarbon = {
    consult: { electricityKWhYear: 600, heatingKWhYear: 900 },
    surgery: { electricityKWhYear: 2200, heatingKWhYear: 1500 },
    lab: { electricityKWhYear: 1600, heatingKWhYear: 1200 },
    imaging: { electricityKWhYear: 1600, heatingKWhYear: 1200 },
    dental: { electricityKWhYear: 1600, heatingKWhYear: 1200 },
    ward: { electricityKWhYear: 3000, heatingKWhYear: 2400 },
    dispensary: { electricityKWhYear: 600, heatingKWhYear: 900 },
    retail: { electricityKWhYear: 600, heatingKWhYear: 900 },
    kennel: { electricityKWhYear: 3000, heatingKWhYear: 2400 }
  };
  Object.entries(roomCarbon).forEach(([id, values]) => Object.assign(rooms[id], values));

  const equipment = {
    anesthesia: { name: bi("Anaesthesia station", "Poste d’anesthésie"), purchase: 18000, lease: 15000, maintenanceRate: .06, capacityHours: 2256 },
    labAnalyzer: { name: bi("Laboratory analyser", "Analyseur de laboratoire"), purchase: 11000, lease: 9000, maintenanceRate: .06, capacityHours: 2256 },
    ultrasound: { name: bi("Ultrasound unit", "Échographe"), purchase: 21000, lease: 12000, maintenanceRate: .06, capacityHours: 1800 },
    dentalUnit: { name: bi("Dental unit", "Unité dentaire"), purchase: 14000, lease: 9000, maintenanceRate: .06, capacityHours: 1900 },
    xray: { name: bi("Digital radiography unit", "Radiographie numérique"), purchase: 26000, lease: 14500, maintenanceRate: .06, capacityHours: 1800 },
    cages: { name: bi("Hospital cage bank", "Batterie de cages"), purchase: 12000, lease: 7200, maintenanceRate: .06, capacityHours: 2256 },
    orthopedicKit: { name: bi("Orthopedic instrument set", "Matériel orthopédique"), purchase: 24000, lease: 13500, maintenanceRate: .06, capacityHours: 1200 },
    pharmacySystem: { name: bi("Pharmacy storage system", "Système de stockage pharmaceutique"), purchase: 8500, lease: 5400, maintenanceRate: .06, capacityHours: 2256 },
    boardingUnits: { name: bi("Boarding units", "Unités de pension"), purchase: 16000, lease: 9600, maintenanceRate: .06, capacityHours: 2256 }
  };

  const trainings = {
    preventive: { role: "support", name: skills.preventive, cost: 1200, hours: 16 },
    surgery: { role: "support", name: skills.surgery, cost: 1800, hours: 22 },
    lab: { role: "support", name: skills.lab, cost: 1500, hours: 18 },
    imaging: { role: "support", name: skills.imaging, cost: 1500, hours: 18 },
    emergency: { role: "support", name: skills.emergency, cost: 1900, hours: 24 },
    inpatient: { role: "support", name: skills.inpatient, cost: 1700, hours: 22 },
    pharmacy: { role: "support", name: skills.pharmacy, cost: 1300, hours: 16 },
    animalCare: { role: "support", name: skills.animalCare, cost: 1100, hours: 14 },
    ultrasound: { role: "vet", name: skills.ultrasound, cost: 4200, hours: 56 },
    dentistry: { role: "vet", name: skills.dentistry, cost: 3600, hours: 42 },
    orthopedics: { role: "vet", name: skills.orthopedics, cost: 6800, hours: 80 }
  };

  const baseStaff = [
    { id: "vet-founder", name: "Dr Amina Kone", role: "vet", baseSalary: 56000, salary: 56000, capacity: 1545, skills: ["general"], primaryService: "consult", secondaryService: "preventive", secondaryShare: .2 },
    { id: "support-maya", name: "Maya Chen", role: "support", baseSalary: 29000, salary: 29000, capacity: 1545, skills: ["preventive"], primaryService: "vaccination", secondaryService: "preventive", secondaryShare: .35 }
  ];

  const specialistStaff = [
    { id: "vet-imaging", name: "Dr Sofia Neri", role: "vet", baseSalary: 68000, salary: 68000, capacity: 1500, skills: ["general", "ultrasound"], primaryService: "ultrasound", secondaryService: "consult", secondaryShare: .25 },
    { id: "support-imaging", name: "Noah Silva", role: "support", baseSalary: 31000, salary: 31000, capacity: 1500, skills: ["imaging", "lab"], primaryService: "ultrasound", secondaryService: "lab", secondaryShare: .35 }
  ];

  const candidates = [
    { id: "vet-generalist", name: "Dr Leo Martin", role: "vet", baseSalary: 52000, expectedSalary: 52000, capacity: 1545, postingFee: 500, skills: ["general"], primaryService: "consult", pitch: bi("Adds general clinical hours without specialist capability.", "Ajoute du temps clinique général sans compétence spécialisée.") },
    { id: "vet-imaging-candidate", name: "Dr Sofia Neri", role: "vet", baseSalary: 68000, expectedSalary: 68000, capacity: 1500, postingFee: 500, skills: ["general", "ultrasound"], primaryService: "ultrasound", pitch: bi("Provides imaging skill when facilities and support are ready.", "Apporte la compétence d’imagerie lorsque les installations et le soutien sont prêts.") },
    { id: "vet-dentistry", name: "Dr Omar Haddad", role: "vet", baseSalary: 64000, expectedSalary: 64000, capacity: 1500, postingFee: 500, skills: ["general", "dentistry"], primaryService: "dentistry", pitch: bi("Covers dentistry and can support basic surgery.", "Couvre la dentisterie et peut soutenir la chirurgie courante.") },
    { id: "vet-orthopedic", name: "Dr Camille Bernard", role: "vet", baseSalary: 79000, expectedSalary: 81000, capacity: 1450, postingFee: 700, skills: ["general", "orthopedics"], primaryService: "orthopedic", pitch: bi("Unlocks advanced orthopedic work when the complete surgery chain exists.", "Débloque l’orthopédie avancée lorsque toute la chaîne chirurgicale est disponible.") },
    { id: "support-surgery", name: "Elise Roy", role: "support", baseSalary: 34000, expectedSalary: 34000, capacity: 1545, postingFee: 400, skills: ["preventive", "surgery", "emergency"], primaryService: "surgery", pitch: bi("Supports surgery, emergencies, and routine preventive work.", "Soutient la chirurgie, les urgences et les soins préventifs.") },
    { id: "support-lab", name: "Imani Price", role: "support", baseSalary: 32000, expectedSalary: 32000, capacity: 1500, postingFee: 400, skills: ["lab", "pharmacy"], primaryService: "lab", pitch: bi("Turns diagnostic and pharmacy facilities into usable capacity.", "Rend opérationnelles les installations de diagnostic et de pharmacie.") },
    { id: "support-inpatient", name: "Lucas Dubois", role: "support", baseSalary: 33000, expectedSalary: 33500, capacity: 1500, postingFee: 400, skills: ["inpatient", "animalCare"], primaryService: "hospital", pitch: bi("Supports hospitalized animals and boarding operations.", "Soutient les animaux hospitalisés et la pension.") },
    { id: "support-imaging-candidate", name: "Noah Silva", role: "support", baseSalary: 31000, expectedSalary: 31000, capacity: 1500, postingFee: 400, skills: ["imaging"], primaryService: "radiography", pitch: bi("Adds imaging throughput but not specialist veterinary skill.", "Ajoute de la capacité d’imagerie, mais pas de compétence vétérinaire spécialisée.") }
  ];

  const segmentBase = {
    community: { name: bi("Community mix", "Population locale mixte"), growth: .01, priceSensitivity: 1, serviceMix: {}, willingness: {} },
    routine: { name: bi("Routine-care households", "Foyers de soins courants"), growth: .025, priceSensitivity: 1.12, serviceMix: { vaccination: 1.32, preventive: 1.35, emergency: .65, orthopedic: .45, boarding: 1.05 }, willingness: { consult: 52, vaccination: 63, preventive: 82, surgery: 390, ultrasound: 118, dentistry: 185, emergency: 125, orthopedic: 680 } },
    budget: { name: bi("Price-sensitive families", "Familles sensibles aux prix"), growth: .035, priceSensitivity: 1.45, serviceMix: { vaccination: 1.18, preventive: .78, surgery: .48, ultrasound: .35, dentistry: .45, orthopedic: .25, pharmacy: 1.15, retail: 1.2, boarding: .72 }, willingness: { consult: 42, vaccination: 50, preventive: 58, surgery: 260, lab: 66, ultrasound: 96, dentistry: 122, emergency: 105, radiography: 82, hospital: 120, orthopedic: 480, pharmacy: 34, retail: 30, boarding: 39 } },
    advanced: { name: bi("Advanced-care owners", "Propriétaires orientés soins avancés"), growth: -.005, priceSensitivity: .66, serviceMix: { consult: .82, vaccination: .72, surgery: 1.48, lab: 1.62, ultrasound: 1.78, radiography: 1.65, hospital: 1.45, orthopedic: 1.8, dentistry: 1.52, boarding: .7 }, willingness: { consult: 70, vaccination: 76, preventive: 110, surgery: 560, lab: 135, ultrasound: 240, dentistry: 300, emergency: 230, radiography: 205, hospital: 310, orthopedic: 1450, pharmacy: 65, retail: 52, boarding: 65 } }
  };

  Object.values(segmentBase).forEach((segment) => {
    services.forEach((service) => {
      if (segment.serviceMix[service.id] === undefined) segment.serviceMix[service.id] = 1;
      if (segment.willingness[service.id] === undefined) segment.willingness[service.id] = Math.round(service.price * 1.04);
    });
  });

  const locations = {
    residential: { name: bi("Residential district", "Quartier résidentiel"), description: bi("Balanced access, rent, and competition.", "Équilibre entre accès, loyer et concurrence."), rent: 26000, competition: .96, moveCost: 20000, parkingCost: 10000, parkingMaintenance: 1000, segmentMultipliers: { community: 1, routine: 1.08, budget: 1.02, advanced: .92 }, serviceMultipliers: {} },
    centre: { name: bi("City centre", "Centre-ville"), description: bi("Higher rent and competition with stronger advanced-care demand.", "Loyer et concurrence élevés, avec davantage de soins avancés."), rent: 44000, competition: .90, moveCost: 20000, parkingCost: 18000, parkingMaintenance: 1800, segmentMultipliers: { community: 1.05, routine: 1.08, budget: .85, advanced: 1.18 }, serviceMultipliers: { lab: 1.08, ultrasound: 1.12, radiography: 1.12, orthopedic: 1.15 } },
    periurban: { name: bi("Peri-urban area", "Zone périurbaine"), description: bi("Lower rent with stronger budget, parking, and boarding demand.", "Loyer réduit, avec davantage de demande économique, de parking et de pension."), rent: 20000, competition: .98, moveCost: 20000, parkingCost: 6000, parkingMaintenance: 700, segmentMultipliers: { community: .96, routine: .95, budget: 1.15, advanced: .85 }, serviceMultipliers: { boarding: 1.25, retail: 1.1 } }
  };
  Object.assign(locations.residential, { averageRoundTripKm: 8, carShare: .75 });
  Object.assign(locations.centre, { averageRoundTripKm: 6, carShare: .45 });
  Object.assign(locations.periurban, { averageRoundTripKm: 14, carShare: .90 });

  const sustainability = {
    energyUpgrades: {
      none: { name: bi("Current building", "Bâtiment actuel"), once: 0, annual: 0, supportHours: 0, facilityHoursLost: 0, electricityMultiplier: 1, heatingMultiplier: 1 },
      controls: { name: bi("Energy controls", "Pilotage énergétique"), once: 4000, annual: 600, supportHours: 24, facilityHoursLost: 0, electricityMultiplier: .88, heatingMultiplier: .92 },
      retrofit: { name: bi("Deep retrofit", "Rénovation profonde"), once: 40000, annual: 1200, supportHours: 0, facilityHoursLost: 120, electricityMultiplier: .75, heatingMultiplier: .70 }
    },
    wasteStrategies: {
      standard: { name: bi("Standard handling", "Gestion standard"), once: 0, annual: 0, supportHours: 0, clinicalMultiplier: 1, totalMultiplier: 1, variableCostMultiplier: 1 },
      segregated: { name: bi("Improved segregation", "Tri amélioré"), once: 3000, annual: 1500, supportHours: 60, clinicalMultiplier: .70, totalMultiplier: 1, variableCostMultiplier: 1 },
      circular: { name: bi("Circular protocol", "Protocole circulaire"), once: 0, annual: 8000, supportHours: 100, clinicalMultiplier: 1, totalMultiplier: .85, variableCostMultiplier: .98 }
    },
    interventions: {
      heatPump: { name: bi("Heat pump", "Pompe à chaleur"), once: 32000, annual: 900, facilityHoursLost: 80, heatingFuelReplacement: .80, cop: 3 },
      solar: { name: bi("Solar installation", "Installation solaire"), once: 20000, annual: 500, facilityHoursLost: 40, electricityShare: .25 },
      lowFlow: { name: bi("Low-flow anaesthesia", "Anesthésie à bas débit"), once: 2500, annual: 0, vetHours: 40, anaestheticMultiplier: .60 },
      accessPlan: { name: bi("Low-carbon access plan", "Plan d’accès bas carbone"), once: 0, annual: 6000, supportHours: 60, travelMultiplier: .92, trust: 2, demand: .01 }
    }
  };

  const carbonFactorRegistry = {
    electricityKgPerKWh: {
      value: .145,
      unit: "kgCO2e/kWh",
      year: 2023,
      source: "European Environment Agency — Belgium electricity generation intensity",
      detail: bi("Belgium, electricity generation, 145 gCO2e/kWh", "Belgique, production d’électricité, 145 gCO2e/kWh")
    },
    naturalGasKgPerKWh: {
      value: .18296,
      unit: "kgCO2e/kWh",
      year: 2025,
      source: "UK Government GHG Conversion Factors for Company Reporting",
      detail: bi("Natural gas, gross calorific value", "Gaz naturel, pouvoir calorifique supérieur")
    },
    anaestheticKgPerMl: {
      value: .5236,
      unit: "kgCO2e/ml",
      year: "2024 + 2026",
      source: "UK Environment Agency F-gas GWP table and DailyMed isoflurane product data",
      detail: bi("Isoflurane GWP 350 × specific gravity 1.496 g/ml ÷ 1,000", "PRG de l’isoflurane 350 × masse volumique 1,496 g/ml ÷ 1 000")
    },
    clinicalWasteKgPerKg: {
      value: .9013,
      unit: "kgCO2e/kg",
      year: 2023,
      source: "NHS England clinical-waste carbon tool",
      detail: bi("High-temperature incineration; used as a conservative clinical-waste route", "Incinération à haute température ; filière prudente retenue pour les déchets cliniques")
    },
    generalWasteKgPerKg: {
      value: .00468568,
      unit: "kgCO2e/kg",
      year: 2025,
      source: "UK Government GHG Conversion Factors for Company Reporting",
      detail: bi("Commercial and industrial waste, incineration with energy recovery", "Déchets commerciaux et industriels, incinération avec valorisation énergétique")
    },
    carKgPerKm: {
      value: .16272,
      unit: "kgCO2e/km",
      year: 2025,
      source: "UK Government GHG Conversion Factors for Company Reporting",
      detail: bi("Average petrol car", "Voiture à essence moyenne")
    }
  };

  const carbonModel = {
    version: "2025.2-BE",
    context: "BE",
    factors: Object.fromEntries(Object.entries(carbonFactorRegistry).map(([key, factor]) => [key, factor.value])),
    factorRegistry: carbonFactorRegistry,
    building: { electricityKWhPerOpenHour: 5.5, heatingKWhPerOpenHour: 11 },
    sources: {
      electricity: "European Environment Agency, 2023 electricity generation intensity",
      fuelAndTravel: "UK Government GHG Conversion Factors for Company Reporting, 2025",
      anaesthetic: "UK Environment Agency F-gas table and DailyMed isoflurane product data",
      clinicalWaste: "NHS England clinical-waste carbon tool, 2023",
      generalWaste: "UK Government GHG Conversion Factors for Company Reporting, 2025"
    },
    assumptions: ["serviceActivity", "buildingDemand", "roomDemand", "clientTripPatterns", "wasteTreatmentRoutes"],
    excluded: ["purchasedMedicines", "staffCommuting", "equipmentManufacture", "construction", "refrigerants", "otherSupplyChain"]
  };

  const openingPeriods = {
    extended: { name: bi("Extended weekdays", "Semaine prolongée"), hours: 520, cost: 12000, demand: .03, climate: -1 },
    sunday: { name: bi("Sunday opening", "Ouverture le dimanche"), hours: 416, cost: 16000, demand: .04, climate: -2 },
    night: { name: bi("Night and emergency coverage", "Nuit et couverture d’urgence"), hours: 1095, cost: 40000, demand: .02, emergencyDemand: .25, climate: -4 }
  };

  // Pace changes staff, room, and equipment time per case. Faster care serves
  // more cases with the same hours but lowers client trust and reputation.
  const servicePaces = {
    thorough: { name: bi("Thorough", "Approfondi"), note: bi("20% more time per case; clients notice the extra care.", "20 % de temps en plus par cas ; les clients remarquent le soin supplémentaire."), duration: 1.2, trust: 1.5, reputation: .5 },
    standard: { name: bi("Standard", "Standard"), note: bi("The reference time per case.", "Le temps de référence par cas."), duration: 1, trust: 0, reputation: 0 },
    fast: { name: bi("Fast", "Rapide"), note: bi("20% less time per case; rushed visits lower trust and reputation.", "20 % de temps en moins par cas ; les visites pressées réduisent la confiance et la réputation."), duration: .8, trust: -2.5, reputation: -1 }
  };

  const stockStrategies = {
    basic: { name: bi("Basic", "Basique"), multiplier: 1.08, supportHours: 0, cost: 0, stockoutRate: .06 },
    coordinated: { name: bi("Coordinated", "Coordonnée"), multiplier: 1, supportHours: 60, cost: 2000, stockoutRate: .02 },
    optimized: { name: bi("Optimized", "Optimisée"), multiplier: .92, supportHours: 140, cost: 5000, stockoutRate: .005 }
  };

  const hrStrategies = {
    reactive: { name: bi("Reactive", "Réactive"), absenteeism: .08, cost: 0, climate: 0, retention: 0 },
    structured: { name: bi("Structured", "Structurée"), absenteeism: .05, cost: 4000, climate: 2, retention: 3 },
    supportive: { name: bi("Supportive", "Soutenante"), absenteeism: .03, cost: 10000, climate: 5, retention: 6 }
  };

  const marketingStrategies = {
    communication: {
      basic: { name: bi("Basic communication", "Communication de base"), cost: 0, trust: 0, demand: 0 },
      standard: { name: bi("Regular follow-up", "Suivi régulier"), cost: 3000, trust: 2, demand: .02 },
      targeted: { name: bi("Targeted communication", "Communication ciblée"), cost: 8000, trust: 5, demand: .05 }
    },
    monitoring: {
      none: { name: bi("No monitoring", "Aucune veille"), cost: 0, supportHours: 0, relief: 0 },
      internal: { name: bi("Internal monitoring", "Veille interne"), cost: 0, supportHours: 80, relief: .25 },
      external: { name: bi("External monitoring", "Veille externe"), cost: 6000, supportHours: 0, relief: .5 }
    },
    geomarketing: {
      none: { name: bi("No geographic analysis", "Aucune analyse géographique"), cost: 0, supportHours: 0, demand: 0 },
      internal: { name: bi("Internal geographic analysis", "Analyse géographique interne"), cost: 0, supportHours: 60, demand: .03 },
      external: { name: bi("External geographic analysis", "Analyse géographique externe"), cost: 8000, supportHours: 0, demand: .06 }
    }
  };

  const socialIndicators = {
    clientTrust: bi("Client trust", "Confiance des clients"),
    staffClimate: bi("Staff climate", "Climat de l’équipe"),
    referralSupport: bi("Referral support", "Soutien des référents"),
    communityPressure: bi("Access pressure", "Pression d’accès")
  };

  const socialActions = {
    communication: { name: bi("Improve communication", "Améliorer la communication"), note: bi("Clear reminders and follow-up raise trust and repeat visits.", "Des rappels et un suivi clairs renforcent la confiance et les visites répétées."), cost: 800, deltas: { clientTrust: 8, communityPressure: -2 } },
    staffMeeting: { name: bi("Hold a staff meeting", "Organiser une réunion d’équipe"), note: bi("Alignment improves staff climate but uses management time.", "L’alignement améliore le climat mais mobilise du temps de gestion."), cost: 500, deltas: { staffClimate: 8, clientTrust: 1 }, supportHours: 12, fatigueRelief: .5 },
    referralOutreach: { name: bi("Referral outreach", "Développer les référents"), note: bi("Local partners send more diagnostic and advanced-care requests.", "Les partenaires locaux envoient davantage de demandes diagnostiques et avancées."), cost: 1200, deltas: { referralSupport: 10 }, advancedDemand: .06 },
    communityAccess: { name: bi("Community access offer", "Offre d’accès communautaire"), note: bi("Easier access raises routine demand and public expectations.", "Un accès facilité augmente la demande courante et les attentes publiques."), cost: 1200, deltas: { clientTrust: 5, communityPressure: 8 }, routineDemand: .07 }
  };

  const scenarioGoals = {
    balanced: [
      { id: "served", type: "min", metric: "honoredRate", value: .82, label: bi("Serve at least 82% of open requests", "Traiter au moins 82 % des demandes ouvertes") },
      { id: "net", type: "min", metric: "netResult", value: 0, label: bi("Reach a non-negative net result", "Atteindre un résultat net non négatif") },
      { id: "cash", type: "min", metric: "treasury", value: 0, label: bi("Keep treasury above zero", "Maintenir une trésorerie positive") },
      { id: "staff", type: "range", metric: "staffUse", value: [.45, .94], label: bi("Keep staff use between 45% and 94% (overtime pushes it above)", "Maintenir l’utilisation du personnel entre 45 % et 94 % (les heures supplémentaires la font dépasser)") },
      { id: "services", type: "min", metric: "readyServices", value: 3, label: bi("Operate at least three ready and staffed services", "Exploiter au moins trois services prêts et dotés en personnel") }
    ],
    rescue: [
      { id: "net", type: "min", metric: "netResult", value: 0, label: bi("Return to a non-negative net result", "Revenir à un résultat net non négatif") },
      { id: "cash", type: "min", metric: "treasury", value: 0, label: bi("Restore positive treasury", "Rétablir une trésorerie positive") },
      { id: "served", type: "min", metric: "honoredRate", value: .75, label: bi("Serve at least 75% of open requests", "Traiter au moins 75 % des demandes ouvertes") },
      { id: "climate", type: "min", metric: "staffClimate", value: 45, label: bi("Keep staff climate at 45 or above", "Maintenir le climat de travail à 45 ou plus") }
    ],
    growth: [
      { id: "margin", type: "min", metric: "margin", value: .08, label: bi("Reach an 8% net margin", "Atteindre une marge nette de 8 %") },
      { id: "advanced", type: "min", metric: "advancedServed", value: 220, label: bi("Serve 220 advanced-care cases", "Traiter 220 cas de soins avancés") },
      { id: "cash", type: "min", metric: "treasury", value: 50000, label: bi("Keep at least EUR 50,000 treasury", "Conserver au moins 50 000 EUR de trésorerie") },
      { id: "staff", type: "range", metric: "staffUse", value: [.5, .92], label: bi("Keep staff use between 50% and 92% (overtime pushes it above)", "Maintenir l’utilisation du personnel entre 50 % et 92 % (les heures supplémentaires la font dépasser)") },
      { id: "services", type: "min", metric: "readyServices", value: 4, label: bi("Operate at least four ready and staffed services", "Exploiter au moins quatre services prêts et dotés en personnel") }
    ]
  };

  const scenarios = {
    balanced: { name: bi("Balanced startup", "Démarrage équilibré"), description: bi("A stable clinic with room to choose its direction.", "Une clinique stable qui peut choisir son orientation."), treasury: 160000, clients: 1200, reputation: 56, marketFocus: "community", staff: baseStaff, services: ["consult"], rooms: { consult: 1 }, equipment: {}, trainings: ["preventive"], location: "residential", social: { clientTrust: 50, staffClimate: 50, referralSupport: 50, communityPressure: 50 }, goals: scenarioGoals.balanced },
    rescue: { name: bi("Cash-strapped rescue", "Redressement sous contrainte"), description: bi("Low cash, tired staff, and urgent routine demand require careful recovery.", "Trésorerie faible, équipe fatiguée et demande courante pressante exigent un redressement prudent."), treasury: 50000, clients: 900, reputation: 48, marketFocus: "budget", staff: baseStaff.map((person) => ({ ...person, salary: Math.round(person.salary * .95) })), services: ["consult", "vaccination"], rooms: { consult: 1 }, equipment: {}, trainings: ["preventive"], location: "residential", social: { clientTrust: 43, staffClimate: 38, referralSupport: 42, communityPressure: 67 }, goals: scenarioGoals.rescue },
    growth: { name: bi("Specialist growth clinic", "Clinique spécialisée en croissance"), description: bi("A capable imaging clinic must turn expensive assets into sustainable growth.", "Une clinique d’imagerie doit transformer des actifs coûteux en croissance durable."), treasury: 140000, clients: 1050, reputation: 64, marketFocus: "advanced", staff: [...baseStaff, ...specialistStaff], services: ["consult", "vaccination", "lab", "ultrasound"], rooms: { consult: 2, lab: 1, imaging: 1 }, equipment: { labAnalyzer: { owned: 1, leased: 0 }, ultrasound: { owned: 0, leased: 1 } }, trainings: ["preventive", "lab", "imaging", "ultrasound"], location: "centre", social: { clientTrust: 58, staffClimate: 52, referralSupport: 64, communityPressure: 48 }, goals: scenarioGoals.growth }
  };

  root.ClinicData = {
    bi, demandScale, skills, services, rooms, equipment, trainings, candidates, segments: segmentBase,
    locations, openingPeriods, servicePaces, stockStrategies, hrStrategies, marketingStrategies,
    socialIndicators, socialActions, scenarios, baseStaff, sustainability, carbonModel
  };
})(globalThis);
