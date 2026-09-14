# Veterinary Clinic Systems Simulation

A bilingual, one-team classroom simulation for teaching systems thinking and veterinary-clinic management. The application is static, works without a backend, and stores progress in the browser.

## Run

Open `index.html` directly, or serve this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

Open `tests.html` to run the model regression suite, or run it headlessly with the bundled Node runtime:

```bash
node headless-tests.js
```

## Included

- Complete English/French interface with browser-language detection and a persistent `FR | EN` switch.
- Localized euro, number, percentage, date, help, history, reflection, and export content.
- Fourteen modeled services across core care, diagnostics, imaging, surgery, hospitalization, pharmacy, retail, and boarding.
- Multiple room, equipment, skill, and operating requirements per service.
- Three starting scenarios: balanced startup, cash-strapped rescue, and specialist growth.
- Student-editable action limit, target year, bankruptcy threshold, and unlimited-action mode.
- Exact no-action versus planned-action forecasting.
- Six focused work areas with progressive drawers instead of permanently exposed catalogs.
- A dismissible Year 1 guide, causal beginner signals, a first-turn example, and a plain-language glossary.
- Compact service-family rows that reveal one service at a time, plus role-filtered recruitment skills with blocker-based suggestions.
- Staged recruitment: define the vacancy first, reveal matching applicants second, and review the complete consequence forecast before submitting an offer.
- Per-person time allocation across any number of compatible services in 5% steps, from idle time below 100% to paid overtime up to 130%, with available, assigned, used, overtime, idle, blocked, and workload hours reconciled to service capacity.
- A "Who can do what" matrix showing, for every person and service, whether they can do it now, need training (with a direct link), or are the wrong role.
- Per-person training and a per-service pace (Thorough / Standard / Fast) that trades time per case against client trust and reputation.
- A focused allocation drawer that previews cases, finances, workload, carbon, and the services helped or harmed before one person’s allocation is confirmed.
- A consistent five-part consequence preview for cash, recurring cost, cases served, team workload, and carbon.
- Opening periods, drop-off workflow, stock strategy, HR strategy, salary decisions, recruitment offers, and training.
- Separate equipment purchase, lease, maintenance, resale, and return economics.
- Room fit-out and recurring rent, three locations, parking, communication, competitive monitoring, and local market research.
- One five-year loan at a time with 6% interest and optional early repayment.
- Per-year rationale, expectation, observation, surprise, and uncertainty notes.
- Draft-based simulation settings with one saved action-limit selector, validation that preserves existing planned actions, and stable focus/scroll after saving.
- Scenario goals, target-year summaries, bankruptcy summaries, analytical JSON export, a detailed localized print/PDF report, and optional continued sandbox play.
- Optional team and participant names plus verbatim yearly reflections in exports; new reports retain clinic, action, staff-allocation, and service-hour snapshots.
- A playable operational carbon model covering building energy, heating, anaesthetic gases, waste treatment, and client travel.
- Energy controls, retrofit, heat pump, solar, low-flow anaesthesia, waste strategies, and a low-carbon access plan, all connected to costs, capacity, staff time, demand, or trust.
- Carbon totals, per-treated-case intensity, starting-clinic comparison, source breakdown, scenario targets, year-end causes, and versioned methodology in exports.
- Browser persistence with migration from the earlier MVP storage format.
- Responsive desktop, tablet, and mobile planning layouts with a compact Plan bar at 1000px and below.

## Decision Rules

Every changed management decision uses one action. Repeated edits to the same target before the year is passed remain one action. Language and rule settings never count as actions.

Opening periods add room and equipment capacity but do not create staff hours. Every visible lever has an explicit effect on money, demand, staff time, facility capacity, staff climate, or client signals.

Each staff member’s annual available time can be allocated across any number of compatible services. Up to 100%, time is conserved: increasing one allocation moves existing hours. Allocations below 100% leave paid idle time. Allocations above 100% (maximum 130%) are overtime: hours actually worked beyond available time are paid at 1.25× plus social charges, lower staff climate that year, and raise that person’s expected absence the following year. Unqualified allocations remain visibly blocked and add no effective service capacity until that person is trained; training is planned for one named person and takes hours from that person only. Vets can be allocated to any service: vet work needs their vet skill, and they can cover the support part of any case without a support skill, at vet cost. A service is only counted as ready when its requirements exist and someone is assigned to it; open services with nobody assigned show as unstaffed. When a room or equipment item is oversubscribed, every service using it is cut by the same share, and the Care page shows use, “Full” status, and the requests turned away. Yearly requests are scaled by `demandScale` (2.2) in `data.js`, calibrated by regression tests so that doing nothing loses money while sensible choices can fill most paid hours. Service pace scales staff, room, and equipment time per case (Thorough 1.2×, Fast 0.8×) and shifts client trust and reputation by the share of cases served at that pace. Inspecting or editing a draft is free; confirming one person’s allocation uses the stable `staff-allocation:{personId}` action key.

The carbon result is labelled as a **modelled operational footprint**. Belgian electricity uses the EEA 2023 generation-intensity factor. Natural gas, average petrol-car travel, and general-waste energy recovery use the UK Government 2025 conversion-factor dataset. The isoflurane factor combines the UK Environment Agency GWP with the product density, while clinical-waste high-temperature incineration uses the NHS England clinical-waste factor. Every value, unit, year, derivation, and source is frozen in the versioned `2025.2-BE` registry and exported. Service-level activity quantities, building demand, travel patterns, and treatment routes are explicitly labelled as simulation assumptions. Medicines and other supply chains, staff commuting, equipment manufacture, construction, and refrigerants are outside the model boundary.

Method sources:

- [Vet Sustain Veterinary Carbon Calculator](https://vetsustain.org/resources/the-veterinary-carbon-calculator-getting-started)
- [European Environment Agency electricity-generation intensity](https://www.eea.europa.eu/en/analysis/indicators/greenhouse-gas-emission-intensity-of-1-1751032678/greenhouse-gas-emission-intensity-of-electricity-generation-country-level)
- [UK Government 2025 greenhouse-gas conversion factors](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025)
- [GHG Protocol corporate standard guidance](https://ghgprotocol.org/corporate-standard-frequently-asked-questions)

Buying equipment charges the purchase price once and annual maintenance thereafter. Leasing charges only the annual lease amount. These costs are never combined for the same unit.

## Français

Cette simulation bilingue permet à une équipe de gérer une clinique vétérinaire au fil de tours annuels. Elle fonctionne sans serveur, conserve la progression dans le navigateur et propose quatorze services, trois scénarios, des décisions opérationnelles, humaines, financières et commerciales, ainsi qu’un registre de réflexion par année.

Le sélecteur `FR | EN` traduit l’interface, l’aide, les décisions planifiées, l’historique et l’export sans réinitialiser la partie. Chaque membre de l’équipe peut répartir son temps entre un et trois services ; les heures disponibles, utilisées, inutilisées et bloquées restent visibles et se réconcilient avec la capacité des services. L’export propose à la fois un JSON analytique et un rapport détaillé imprimable ou enregistrable en PDF. La durabilité est intégrée comme une dimension de gestion : l’interface affiche l’empreinte opérationnelle modélisée, son intensité par cas, sa source principale et les conséquences financières, humaines et opérationnelles des décisions de transition.
