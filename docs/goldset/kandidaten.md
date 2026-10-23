# Gold-Set-Kandidaten (Benchmark Mapping, Vertrag mapping-system-v3)

Stand: 2026-10-23. Quelle der Units: `congress_tracker` (Korpus `data/committee_matcher_inputs`, 225 Units). Referenz-Lauf: `map-fullrun-20261016` (codex / gpt-6.1-sol, 522 Zuordnungen, 21 no_mapping-Units). Die Hashes aller Units stimmen mit dem Fullrun überein.

Die Einschätzungen unten sind vorläufig, ohne Websuche und nur aus Unit-Text und Vertrag abgeleitet. Sie sind kein Gold-Label.

## Legende

- **Typ**: `sub` = subcommittee, `sub/name` = subcommittee name_only, `parent` = committee_parent_core, `direct` = committee_direct
- **Kat**:
  - (a) Broad Scope
  - (b) enger Kontrollfall
  - (c) no_mapping richtig oder naheliegend
  - (d) parent_core/direct
  - (e) name_only
  - (f) schwierige Zuordnung
- **Fullrun**: `industry_id Confidence`; `R` = Evidence "Recherche", also nur per Web gestützt
- **Einschätzung**:
  - **req** = wahrscheinlich required
  - **strittig** = vertretbar, aber umstritten
  - **nein** = sollte nicht zugeordnet werden
- **[ALT]** = Unit war im alten Gold-Set (22 Units, `sample_units.json`)
- Industry-Kürzel im Fließtext:
  - `exchanges` = financial-data-stock-exchanges
  - `P&C` = insurance-property-casualty
  - `drug-gen` = drug-manufacturers-general
  - `drug-spec` = drug-manufacturers-specialty-generic

Ein Fall kann mehreren Kategorien angehören. Er steht unter der Kategorie, für die er am wertvollsten ist.

---

## (a) Broad Scope – Auswahl und Begrenzung schwierig (13)

**A1 `house--energy-and-commerce--health` [ALT]** — sub, House, (a)(f)
- **Warum schwierig:** Der Text ist eine lange Liste: Medicare/Medicaid, biomedical R&D, hospital construction, health IT, medical malpractice, 340B, "regulation of food, drugs, and cosmetics". Daraus sind 3–5 Zuordnungen zu wählen, jede mit eigener Evidence.
- **Typische Fehler schwächerer Modelle:** Sie mappen alle Gesundheits-Industries, ziehen die Nebenglieder "food"/"cosmetics" mit Confidence 3 hoch oder doppeln drug-gen und drug-spec ohne Abgrenzung. Beim alten Labeling gab es den einzigen Dissens: household-personal-products gegen medical-care-facilities.
- **Fullrun:** biotechnology 3, drug-gen 3, drug-spec 3, health-information-services 3, healthcare-plans 3
- **Einschätzung:**
  - req: drug-gen, healthcare-plans
  - strittig: drug-spec, biotechnology, health-information-services, medical-care-facilities ("hospital construction"), household-personal-products/packaged-foods (Nebengegenstand, höchstens 2)

**A2 `house--financial-services--housing-and-insurance` [ALT]** — sub, House, (a)(f)
- **Warum schwierig:** Mehrere ähnliche Insurance-Industries konkurrieren miteinander, dazu kommen Housing und Mortgage.
- **Typische Fehler:** Alle `insurance-*` werden gemappt. Reinsurance wird ohne Textnennung mit 4 bewertet.
- **Fullrun:** P&C 3, insurance-reinsurance 4, insurance-specialty 3, mortgage-finance 3, residential-construction 3
- **Einschätzung:**
  - req: mortgage-finance, P&C
  - strittig: insurance-specialty (private mortgage insurance), residential-construction
  - nein bzw. überkalibriert: reinsurance 4

**A3 `senate--energy-and-natural-resources--public-lands-forests-and-mining` [ALT]** — sub, Senate, (a)(f)
- **Warum schwierig:** "Mining" ist ein Sammelbegriff. Die Verteilung auf gold, other-industrial-metals-mining, thermal-coal und oil-gas-e-p ist Ermessenssache.
- **Typische Fehler:** Jede Rohstoff-Industry wird einzeln gemappt, obwohl der Text den konkreten Rohstoff nicht nennt.
- **Fullrun:** gold 3, lumber-wood-production 3, oil-gas-e-p 3, other-industrial-metals-mining 3, thermal-coal 3
- **Einschätzung:**
  - req: lumber-wood-production
  - strittig: other-industrial-metals-mining, gold, thermal-coal, oil-gas-e-p (je nach Wortlaut zu Leasing)

**A4 `house--energy-and-commerce--commerce-manufacturing-and-trade`** — sub, House, (a)(f)
- **Warum schwierig:** Der Text nennt "motor vehicle safety", privacy/data security, FTC "including sports-related matters", CPSC, "regulation of travel, tourism, and time".
- **Stichwortfallen:** "sports" führt zu entertainment, CPSC zu leisure/household, "privacy" zu internet-content. Zu lösen ist außerdem die Frage, ob "tourism" auf lodging oder auf travel-services gehört.
- **Fullrun:** auto-manufacturers 4, auto-parts 3, internet-content-information 3, lodging 3, travel-services 3
- **Einschätzung:**
  - req: auto-manufacturers
  - strittig: travel-services, auto-parts, internet-content-information
  - eher nein: lodging, entertainment

**A5 `house--energy-and-commerce--environment`** — sub, House, (a)
- **Warum schwierig:** Umweltrecht wirkt auf viele Industries. Nur direkt regulierte Industries tragen eine Zuordnung, etwa über TSCA, Trinkwasser, Abfall oder Kraftstoffe.
- **Typische Fehler:** "Clean Air" wird auf alle emittierenden Industries ausgeweitet.
- **Fullrun:** auto-manufacturers 3, chemicals 3, oil-gas-refining-marketing 3, utilities-regulated-water 3, waste-management 3
- **Einschätzung:**
  - req: chemicals, waste-management, utilities-regulated-water
  - strittig: oil-gas-refining-marketing, auto-manufacturers

**A6 `house--financial-services--digital-assets-financial-technology-and-artificial-intelligence`** — sub, House, (a)(f)
- **Warum schwierig:** Der Text listet Krypto-Akteure detailliert auf ("digital asset trading and lending platforms, custody providers").
- **Stichwortfalle:** "artificial intelligence" verleitet zu semiconductors. Das ist ein Zwei-Schritt-Weg, der laut Vertrag nicht reicht.
- **Fullrun:** capital-markets 4, credit-services 3, exchanges 4, semiconductors 3, software-application 4
- **Einschätzung:**
  - req: exchanges, capital-markets
  - strittig: software-application (Fintech), credit-services (lending platforms)
  - nein: semiconductors

**A7 `senate--appropriations--financial-services-and-general-government`** (Paar mit `house--appropriations--financial-services-and-general-government`) — sub, Senate, (a)(c)(f)
- **Warum schwierig:** Der Text ist eine reine Behördenliste. Laut Rubrik ist eine bloße Behördennennung Nebengegenstand, also Confidence 2, und Broad Scope verlangt ≥3. Zusätzlich gibt es Fallen:
  - "Federal Deposit Insurance Corporation, Office of the Inspector General"
  - "NCUA, Community Development Revolving Loan Fund"
  - Treasury mit "except"
- **Typische Fehler:** Über SEC, FCC und FDIC werden 4–5 Industries mit 3 vergeben.
- **Fullrun:**
  - Senat: asset-management 3, capital-markets 3, exchanges 3, telecom-services 3
  - House: zusätzlich broadcasting 3
- **Einschätzung:**
  - strittig: capital-markets/exchanges (SEC), telecom-services (FCC), jeweils höchstens 2, kein Broad Scope
  - nein: Banken (FDIC nur OIG)
  - Der Fall testet, ob ein Modell die Rubrik einhält.

**A8 `house--appropriations--labor-health-and-human-services-education-and-related-agencies`** (Paar Senat) — sub, House, (a)(c)
- **Warum schwierig:** Die Agency-Liste enthält die Falle CPB (Corporation for Public Broadcasting): Sie finanziert öffentlichen Rundfunk und reguliert nicht die kommerzielle Broadcasting-Industry.
- **Inkonsistenz:** House und Senat haben fast identische Texte, aber unterschiedliche Fullrun-Ergebnisse.
- **Fullrun:**
  - House: broadcasting 3, education-training-services 3, healthcare-plans 3, medical-care-facilities 3
  - Senat: education 3, medical-care-facilities 3
- **Einschätzung:**
  - strittig: healthcare-plans (CMS), medical-care-facilities, education (alle Nebengegenstand, ≤2)
  - nein: broadcasting

**A9 `house--transportation-and-infrastructure--highways-and-transit`** — sub, House, (a)(f)
- **Warum schwierig:** Klassischer Fall für einen einstufigen Wirkungsweg: building-materials ist notwendiger Input. Hinzu kommen Motor-Carrier-Regulierung und NHTSA.
- **Typische Fehler:** Der einstufige Weg wird übersehen oder mit 4 bewertet. Auto-manufacturers wird über NHTSA zu hoch eingestuft.
- **Fullrun:** building-materials 3, engineering-construction 4, infrastructure-operations 3, trucking 4
- **Einschätzung:**
  - req: engineering-construction, trucking
  - strittig: building-materials (einstufig, eher 2–3), infrastructure-operations, auto-manufacturers

**A10 `house--homeland-security--transportation-and-maritime-security`** — sub, House, (a)(c)
- **Warum schwierig:** TSA-Zuständigkeit für Luftfahrt, Schiene, Pipelines und Häfen. Dem Text ist Task-Force-Material angehängt (Olympics, FIFA), das als Falle wirkt.
- **Abgrenzung:** airports-air-services gegen infrastructure-operations.
- **Fullrun:** airlines 3, infrastructure-operations 3, marine-shipping 3, oil-gas-midstream 3, railroads 3
- **Einschätzung:**
  - req: airlines
  - strittig: railroads, oil-gas-midstream, marine-shipping, infrastructure-operations bzw. airports-air-services
  - nein: entertainment/leisure aus dem Task-Force-Text

**A11 `senate--commerce-science-and-transportation--surface-transportation-freight-pipelines-and-safety` [ALT]** — sub, Senate, (a)
- **Warum schwierig:** Die Evidence besteht fast nur aus Behördennamen (NHTSA, FMCSA, FRA, PHMSA). Laut Rubrik ist das Nebengegenstand mit Confidence 2, Broad Scope wäre also unzulässig. Ein direkter Konflikt zwischen Rubrik und Fullrun.
- **Fullrun:** auto-manufacturers 3, oil-gas-midstream 3, railroads 3, trucking 3, utilities-regulated-gas 3
- **Einschätzung:**
  - req: railroads, trucking
  - strittig: oil-gas-midstream, auto-manufacturers
  - eher nein: utilities-regulated-gas
  - Ob Broad Scope zulässig ist, hängt davon ab, ob der Text Sachgebiete nennt oder nur Behörden.

**A12 `house--oversight-and-government-reform--health-care-and-financial-services`** — sub, House, (a)(c)
- **Warum schwierig:** Alle fünf Zuordnungen stammen aus einer Sammelaufzählung von Aufsichtsthemen. Laut Rubrik sind das Nebengegenstände, Broad Scope ist also unzulässig.
- **Typische Fehler:** Für jedes Listenglied eine Industry, packaged-foods aus "food".
- **Fullrun:** banks-diversified 3, banks-regional 3, drug-gen 3, healthcare-plans 3, packaged-foods 3
- **Einschätzung:** strittig: höchstens 2, z. B. healthcare-plans und banks-diversified, mit Confidence ≤2. Auch no_mapping ist vertretbar, weil es sich um Oversight handelt.

**A13 `house--appropriations--energy-and-water-development-and-related-agencies`** (Paar Senat) — sub, House, (a)(f)
- **Warum schwierig:** NRC führt zu uranium (einstufig über Kernkraft), TVA und PMAs sind staatliche Versorger.
- **Typische Fehler:** Staatliche Erzeuger werden als Regulierung der privaten Utilities gewertet.
- **Fullrun:**
  - House: engineering-construction 3, uranium 3, utilities-regulated-electric 3, utilities-renewable 3, waste-management 3
  - Senat: nur die ersten drei
- **Einschätzung:**
  - strittig: engineering-construction (Corps of Engineers), uranium/utilities-regulated-electric (NRC)
  - eher nein: utilities-renewable über PMAs

## (b) Enge Kontrollfälle (5)

**B1 `house--appropriations--defense`** (Paar `senate--appropriations--department-of-defense`) — sub, House/Senat, (b)
- **Warum relevant:** Eindeutiger Treffer. Er misst die Confidence-Konsistenz.
- **Inkonsistenz:** Der Fullrun vergibt bei identischem Text 4 (House) und 2 (Senat).
- **Fullrun:** aerospace-defense 4 (House) bzw. 2 (Senat)
- **Einschätzung:** req: aerospace-defense, Confidence 3–4

**B2 `senate--banking-housing-and-urban-affairs--financial-institutions-and-consumer-protection`** — sub, Senate, (b)
- **Warum relevant:** Klarer Bankenfall. Er testet, ob credit-services (consumer protection) als dritte Zuordnung Broad Scope auslöst.
- **Fullrun:** banks-diversified 4, banks-regional 4, credit-services 3
- **Einschätzung:**
  - req: banks-diversified, banks-regional
  - strittig: credit-services

**B3 `house--transportation-and-infrastructure--railroads-pipelines-and-hazardous-materials`** — sub, House, (b)
- **Warum relevant:** Zwei klare Treffer und ein strittiger dritter (Gasverteilnetz).
- **Fullrun:** oil-gas-midstream 4, railroads 4, utilities-regulated-gas 3
- **Einschätzung:**
  - req: railroads, oil-gas-midstream
  - strittig: utilities-regulated-gas

**B4 `senate--armed-services--airland`** — sub, Senate, (b)
- **Warum relevant:** Ein einziger klarer Treffer. Er misst, ob das Modell nicht künstlich weitere Zuordnungen hinzufügt.
- **Fullrun:** aerospace-defense 4
- **Einschätzung:** req: aerospace-defense

**B5 `senate--agriculture-nutrition-and-forestry--livestock-dairy-poultry-and-food-safety` [ALT]** — sub, Senate, (b)(f)
- **Warum relevant:** Abgrenzung farm-products gegen packaged-foods bei Fleischverarbeitung und Food Safety. Tyson wird in yfinance als farm-products geführt, Hormel als packaged-foods.
- **Fullrun:** farm-products 4, packaged-foods 3
- **Einschätzung:**
  - req: farm-products
  - strittig: packaged-foods

## (c) no_mapping richtig oder naheliegend (12)

**C1 `house--rules--legislative-and-budget-process` [ALT]** — sub, House, (c)
- **Warum relevant:** Reine Verfahrenszuständigkeit, ein Basis-Kontrollfall.
- **Typische Fehler:** "budget" wird zu einer allgemeinen Wirtschaftswirkung gemacht.
- **Fullrun:** no_mapping
- **Einschätzung:** no_mapping

**C2 `house--foreign-affairs--africa` [ALT]** — sub, House, (c)
- **Warum relevant:** Regionaler Auswärtiger Ausschuss. Rohstoffe stehen nicht im Text.
- **Typische Fehler:** Rohstoffe werden aus Weltwissen ergänzt.
- **Fullrun:** gold 3R, other-industrial-metals-mining 3R
- **Einschätzung:** Ohne Web no_mapping. Mit Web strittig, aber nach Prüffrage 2 eher nein.

**C3 `senate--indian-affairs`** — direct, Senate, (c)(f)
- **Warum schwierig:** Gaming bzw. IGRA steht nicht im Text, liegt aber als Weltwissen nahe.
- **Typische Fehler:** gambling wird aus Weltwissen gemappt. Laut Taxonomie gehören Casinos zu resorts-casinos und nicht zu gambling; das ist eine zweite Falle.
- **Fullrun:** gambling 3R, resorts-casinos 3R
- **Einschätzung:**
  - Ohne Web: no_mapping
  - Mit Web: strittig, dann eher resorts-casinos

**C4 `house--strategic-competition-between-the-united-states-and-the-chinese-communist-party`** — direct, House, (c)
- **Warum relevant:** Select Committee mit 256 Zeichen Text, ohne Gesetzgebungskompetenz und ohne Industry-Nennung.
- **Typische Fehler:** Chips über China-Assoziation.
- **Fullrun:** semiconductor-equipment-materials 3R, semiconductors 3R
- **Einschätzung:** no_mapping

**C5 `joint--printing`** — direct, Joint, (c)(f)
- **Warum schwierig:** Die Taxonomie-Beschreibung von specialty-business-services nennt Druck. Das Komitee beaufsichtigt aber die staatliche GPO. Verwandt ist `joint--library`, das im Fullrun no_mapping ist.
- **Typische Fehler:** Die Taxonomie-Beschreibung dient als Evidence, was der Vertrag verbietet.
- **Fullrun:** specialty-business-services 4, paper-paper-products 2R
- **Einschätzung:** strittig. Eher no_mapping; wenn zugeordnet, dann höchstens 2–3, nicht 4.

**C6 `house--ways-and-means--social-security`** — sub, House, (c)
- **Warum relevant:** Sozialversicherung wirkt nur allgemein auf die Wirtschaft.
- **Falle:** Die Railroad-Retirement-Tax lockt zu railroads.
- **Fullrun:** personal-services 2R, staffing-employment-services 3R
- **Einschätzung:** no_mapping

**C7 `senate--special-committee-on-aging`** — direct, Senate, (c)(d)
- **Warum schwierig:** Laut Text keine Gesetzgebungskompetenz, nur Untersuchungen. Die genannten Themen (Medicare, Pflege) wirken trotzdem einschlägig.
- **Fullrun:** drug-spec 3R, medical-care-facilities 3
- **Einschätzung:** strittig. no_mapping ist naheliegend; medical-care-facilities höchstens 2.

**C8 `house--energy-and-commerce--oversight-and-investigations`** — sub, House, (c)
- **Warum relevant:** Der Text verweist nur auf die Zuständigkeit des Full Committee.
- **Typische Fehler:** Der Parent-Kontext wird als Evidence genutzt, was der Vertrag verbietet.
- **Fullrun:** drug-spec 3R, medical-care-facilities 3R
- **Einschätzung:** no_mapping

**C9 `house--small-business--economic-growth-tax-and-capital-access`** — sub, House, (c)(f)
- **Warum schwierig:** "Capital access" klingt nach Banken. Der Weg über SBA-Kredite zu den Banken ist aber nicht zwingend, und eine 4 ist überkalibriert.
- **Fullrun:** asset-management 3R, banks-regional 4
- **Einschätzung:** strittig. Eher no_mapping oder banks-regional 2.

**C10 `senate--foreign-relations--state-department-and-usaid-management-international-operations-and-bilateral-international-development`** — sub, Senate, (c)
- **Falle:** USAGM ist ein staatlicher Sender und keine Broadcasting-Industry.
- **Fullrun:** broadcasting 2
- **Einschätzung:** no_mapping

**C11 `house--judiciary--administrative-state-regulatory-reform-and-antitrust`** — sub, House, (c)
- **Warum relevant:** Antitrust und Regulierungsreform sind Querschnittsthemen.
- **Typische Fehler:** Aktuelle Kartellfälle werden aus Weltwissen eingesetzt.
- **Fullrun:** airlines 3R, broadcasting 3R
- **Einschätzung:** no_mapping

**C12 `house--appropriations--legislative-branch`** (Paar Senat) — sub, House, (c)
- **Falle:** GPO bzw. Druck wird wie bei C5 zu specialty-business-services.
- **Inkonsistenz:** House und Senat unterscheiden sich im Fullrun.
- **Fullrun:**
  - House: publishing 3R, specialty-business-services 2
  - Senat: entertainment 3R, publishing 3R
- **Einschätzung:** no_mapping

## (d) committee_parent_core / committee_direct (7)

**D1 `house--agriculture`** — parent, House, (d)(a)
- **Warum schwierig:** Rund 20 Gegenstände, darunter "commodity exchanges", aber höchstens 2 Zuordnungen sind erlaubt. Es kommt also auf die Auswahl an.
- **Fullrun:** farm-products 4, exchanges 4
- **Einschätzung:**
  - req: farm-products
  - strittig: exchanges (eher 3) gegen lumber-wood-production (forestry)

**D2 `house--energy-and-commerce`** — parent, House, (d)(c)
- **Warum schwierig:** Der Fullrun liefert no_mapping mit der Begründung "an Unterausschüsse delegiert". Der Vertrag regelt diese Delegation nicht.
- **Datenproblem:** Der Text enthält eine deutsche Kuratorenannotation ("> *Zusatz:*").
- **Fullrun:** no_mapping
- **Einschätzung:** strittig. Vor der Aufnahme muss der Vertrag geklärt werden (siehe Vertragsklärungen).

**D3 `house--foreign-affairs`** — parent, House, (d)(f)
- **Warum schwierig:** Beide Zuordnungen hängen an "Export controls, including nonproliferation of nuclear technology...". Semiconductors steht nicht im Text.
- **Fullrun:** aerospace-defense 3, semiconductors 3
- **Einschätzung:**
  - strittig: aerospace-defense (Waffenexporte, eher 2)
  - nein: semiconductors

**D4 `senate--health-education-labor-and-pensions`** — parent, Senate, (d)
- **Warum schwierig:** Im Text stehen health, education, student loans, private pension plans und labor. Erlaubt sind höchstens 2 Zuordnungen.
- **Datenproblem:** deutsche Annotation im Text.
- **Fullrun:** biotechnology 3, education-training-services 3
- **Einschätzung:**
  - req: education-training-services
  - strittig: healthcare-plans/biotechnology/credit-services

**D5 `senate--veterans-affairs`** — direct, Senate, (d)(f)
- **Fallen:**
  - Die staatliche Veteranen-Lebensversicherung ist keine Lebensversicherungs-Industry.
  - VA-Krankenhäuser sind staatlich; private Häuser sind höchstens über Community Care einstufig betroffen.
- **Fullrun:** education-training-services 4, insurance-life 3, medical-care-facilities 4
- **Einschätzung:**
  - strittig: medical-care-facilities, education-training-services (GI Bill als Hauptabsatzmarkt für For-Profit-Colleges)
  - nein: insurance-life

**D6 `senate--appropriations`** — parent, Senate, (d)(c)
- **Warum relevant:** Allgemeine Haushaltskompetenz. Die Fullrun-Zuordnung ist offensichtlich falsch.
- **Fullrun:** aerospace-defense 3R, biotechnology 3R
- **Einschätzung:** no_mapping

**D7 `senate--finance`** — parent, Senate, (d)
- **Warum schwierig:** Medicare/Medicaid ist ein klarer Gegenstand, Steuern und Zölle sind allgemeine Wirkung. Wie bei D1 sind höchstens 2 Zuordnungen erlaubt.
- **Datenproblem:** deutsche Annotation im Text.
- **Fullrun:** healthcare-plans 4, medical-care-facilities 4
- **Einschätzung:**
  - req: healthcare-plans
  - strittig: medical-care-facilities (eher 3)

## (e) name_only (5)

**E1 `senate--finance--health-care` [ALT]** — sub/name, Senate, (e)
- **Warum relevant:** Positiver name_only-Fall: Der Name nennt ein Gebiet, also Confidence 3.
- **Fullrun:** healthcare-plans 3, medical-care-facilities 3
- **Einschätzung:**
  - req: healthcare-plans
  - strittig: medical-care-facilities

**E2 `senate--finance--taxation-and-irs-oversight`** — sub/name, Senate, (e)(c)
- **Falle:** Steuerpolitik ist allgemeine Wirkung. "IRS oversight" lockt zu Steuererklärungsdienstleistern; personal-services umfasst laut Taxonomie die Steuererklärung.
- **Fullrun:** personal-services 3, software-application 3
- **Einschätzung:** strittig. Eher no_mapping; personal-services höchstens 2.

**E3 `senate--finance--energy-natural-resources-and-infrastructure`** — sub/name, Senate, (e)(f)
- **Warum schwierig:** Der Name nennt Gebiete, aber es handelt sich um einen Steuerausschuss. Die Fullrun-Wahl (Bau, Infrastruktur) ist willkürlich; Energie-Steuergutschriften lägen näher an utilities-renewable/solar.
- **Fullrun:** engineering-construction 3, infrastructure-operations 3
- **Einschätzung:** strittig. Eher no_mapping oder utilities-renewable 2.

**E4 `senate--homeland-security-and-governmental-affairs--border-management-federal-workforce-and-regulatory-affairs` [ALT]** — sub/name, Senate, (e)(c)
- **Warum relevant:** Das alte Gold-Set erwartete no_mapping.
- **Fullrun:** infrastructure-operations 2R, security-protection-services 2R
- **Einschätzung:** no_mapping

**E5 `senate--finance--fiscal-responsibility-and-economic-growth`** — sub/name, Senate, (e)(c)
- **Warum relevant:** Der Name beschreibt reine Makroökonomie. Die Fullrun-Zuordnung ist absurd.
- **Fullrun:** internet-retail 2R
- **Einschätzung:** no_mapping

## (f) Schwierige Zuordnungen (15)

**F1 `house--agriculture--conservation-research-and-biotechnology`** — sub, House, (f)
- **Stichwortfalle:** "biotechnology" meint hier Agrar-Biotech, nicht die Industry biotechnology.
- **Zusatzfrage:** Fallen Pestizide unter agricultural-inputs?
- **Fullrun:** agricultural-inputs 2, farm-products 3R
- **Einschätzung:**
  - req bzw. strittig: agricultural-inputs (2–3)
  - nein: biotechnology

**F2 `senate--agriculture-nutrition-and-forestry--conservation-forestry-natural-resources-and-biotechnology`** — sub, Senate, (f)
- **Warum relevant:** Gegenstück zu F1, mit Forestry. Dieselbe biotechnology-Falle.
- **Fullrun:** agricultural-inputs 3, farm-products 3, lumber-wood-production 4
- **Einschätzung:**
  - req: lumber-wood-production
  - strittig: agricultural-inputs, farm-products
  - nein: biotechnology

**F3 `house--science-space-and-technology--research-and-technology`** — sub, House, (f)
- **Warum schwierig:** Der Text enthält "Emerging technology policy, including biotechnology, artificial intelligence, and quantum". Das entspricht fast wörtlich dem Rubrikbeispiel für Confidence 1. Semiconductors läuft nur über NIST/CHIPS.
- **Fullrun:** semiconductors 3, software-infrastructure 3
- **Einschätzung:** strittig. Eher no_mapping oder Zuordnungen mit ≤1–2.

**F4 `house--veterans-affairs--disability-assistance-and-memorial-affairs`** — sub, House, (f)
- **Fallen:**
  - "life insurance issued by the Government" ist keine Industry.
  - "cemeteries of the United States" sind staatlich. personal-services umfasst laut Taxonomie zwar Bestattung/Friedhof, das reizt hier aber nur über das Stichwort.
- **Fullrun:** insurance-life 3, personal-services 4
- **Einschätzung:**
  - strittig: personal-services (burial benefits, höchstens 2)
  - nein: insurance-life

**F5 `senate--commerce-science-and-transportation--science-manufacturing-and-competitiveness`** — sub, Senate, (f)
- **Warum schwierig:** Die Tourismus-Behörden stehen in einer Agency-Liste (Nebengegenstand). "live entertainment issues" ist ein Listenglied, das der Fullrun übersieht. Semiconductors läuft über NIST.
- **Fullrun:** semiconductors 2, travel-services 2
- **Einschätzung:** strittig: travel-services, entertainment, je ≤2

**F6 `senate--judiciary--crime-and-counterterrorism`** — sub, Senate, (f)
- **Warum schwierig:**
  - Bureau of Prisons und Detention: Haftanstalten gehören laut Taxonomie zu security-protection-services.
  - "encryption policies and export licensing" ist Oversight.
- **Falle:** ATF "as it relates to crime or drug policy". Die Einschränkung schließt die Tabak-/Alkohol-Regulierung aus.
- **Fullrun:** security-protection-services 4, software-infrastructure 3
- **Einschätzung:**
  - req: security-protection-services (eher 3)
  - strittig: software-infrastructure (eher ≤2)
  - nein: tobacco/beverages

**F7 `house--financial-services--national-security-illicit-finance-and-international-financial-institutions`** — sub, House, (f)
- **Warum schwierig:** Der Defense Production Act führt zu aerospace-defense. Der Zusammenhang ist plausibel, aber nur über ein Behördenprogramm und deshalb kein Hauptgegenstand. AML/BSA reguliert Banken direkt.
- **Fullrun:** aerospace-defense 4, banks-diversified 3, banks-regional 3
- **Einschätzung:**
  - strittig: banks-diversified/banks-regional (≤3), aerospace-defense (≤2, nicht 4)

**F8 `senate--banking-housing-and-urban-affairs--national-security-and-international-trade-and-finance`** — sub, Senate, (f)(c)
- **Warum relevant:** Senatsgegenstück zu F7. "Export controls" und DPA werden ohne Industry genannt.
- **Fullrun:** semiconductor-equipment-materials 2R, semiconductors 3R
- **Einschätzung:** Ohne Web no_mapping, sonst strittig. Er testet die Konsistenz zu F7.

**F9 `senate--environment-and-public-works--fisheries-wildlife-and-water`** — sub, Senate, (f)
- **Warum schwierig:** Pittman-Robertson ist eine Verbrauchsteuer auf Waffen und Munition. Waffenhersteller gehören in yfinance zu aerospace-defense, Outdoor-Ausrüster zu leisure; die Abgrenzung ist schwierig. Wasserbezug: Trinkwasser bzw. Wasserinfrastruktur.
- **Fullrun:** leisure 2, utilities-regulated-water 3
- **Einschätzung:**
  - req: utilities-regulated-water
  - strittig: leisure

**F10 `house--natural-resources--water-wildlife-and-fisheries`** — sub, House, (f)
- **Warum schwierig:**
  - Fisheries: Seafood gehört laut Taxonomie zu farm-products.
  - "Federal water projects" und PMAs sind staatliche Wasserkraft. utilities-renewable 4 ist eine Falle.
- **Fullrun:** engineering-construction 3, farm-products 4, utilities-regulated-water 3, utilities-renewable 4
- **Einschätzung:**
  - req: farm-products (Fischerei)
  - strittig: utilities-regulated-water, engineering-construction
  - nein bzw. höchstens 2: utilities-renewable

**F11 `house--agriculture--general-farm-commodities-risk-management-and-credit`** — sub, House, (f)(a)
- **Fallen:**
  - Das Farm Credit System ist eine GSE und gehört nicht zu den Regionalbanken.
  - Crop Insurance läuft über private Versicherer; P&C oder insurance-specialty?
- **Fullrun:** banks-regional 3, credit-services 3, farm-products 4, P&C 3
- **Einschätzung:**
  - req: farm-products
  - strittig: P&C/insurance-specialty, credit-services
  - eher nein: banks-regional

**F12 `senate--armed-services--personnel`** — sub, Senate, (f)
- **Warum schwierig:**
  - Der Military Lending Act reguliert Kreditgeber direkt, ist aber Nebengegenstand.
  - TRICARE: Versicherer verwalten die Verträge, also einstufig über den Hauptabsatzmarkt.
- **Fullrun:** credit-services 2, healthcare-plans 3
- **Einschätzung:** strittig: healthcare-plans (2–3), credit-services (2)

**F13 `house--judiciary--courts-intellectual-property-artificial-intelligence-and-the-internet` [ALT]** — sub, House, (f)(a)
- **Warum schwierig:** Das alte Gold-Set sah hier die Falle "KI/Internet als Rechtsthema". Copyright wirkt allerdings direkt auf Content-Industries. Broad Scope mit fünf Zuordnungen ist fraglich.
- **Datenproblem:** Weblink- bzw. Chair-Artefakt im Text.
- **Fullrun:** entertainment 3, internet-content-information 3, publishing 3, software-application 3, software-infrastructure 3
- **Einschätzung:**
  - strittig: entertainment, publishing (Copyright)
  - nein: software-infrastructure, internet-content-information (nur Rechtsrahmen)

**F14 `senate--environment-and-public-works--chemical-safety-waste-management-environmental-justice-and-regulatory-oversight` [ALT]** — sub, Senate, (f)
- **Warum schwierig:** Abgrenzung chemicals gegen specialty-chemicals bei TSCA. Die 4 für specialty-chemicals ist nicht begründet.
- **Datenproblem:** Quelltippfehler "Chemical Safety and Hazardous Investigation Board".
- **Fullrun:** chemicals 3, specialty-chemicals 4, waste-management 3
- **Einschätzung:**
  - req: chemicals, waste-management
  - strittig: specialty-chemicals

**F15 `house--armed-services--seapower-and-projection-forces`** (Paar `senate--armed-services--seapower`) — sub, House, (f)(b)
- **Warum schwierig:** Schiffbau gehört laut Taxonomie zu aerospace-defense. marine-shipping (Reedereien) ist das Stichwort-Gegenstück.
- **Datenprobleme:** Die Evidence verweist auf "paragraphs 5 and 9 of clause 1(c) of rule X", also auf Parent-Kontext. Der Fullrun ist inkonsistent: House vergibt 4, der Senat 2.
- **Fullrun:** aerospace-defense 4, marine-shipping 4 (Senat: aerospace-defense 4, marine-shipping 2)
- **Einschätzung:**
  - req: aerospace-defense
  - strittig: marine-shipping (Sealift/Merchant Marine, ≤2)

### Reserve (bei Bedarf statt eines Kandidaten oben)

- **`house--energy-and-commerce--communications-and-technology`** (a)
  - Fullrun: broadcasting 3, communication-equipment 4, entertainment 3, software-infrastructure 3, telecom-services 4
  - Einschätzung: req telecom-services und broadcasting; communication-equipment 4 ist überkalibriert.
- **`house--ways-and-means--tax-policy`** (c)
  - Fullrun: asset-management 2R, internet-content-information 2R
  - Einschätzung: no_mapping.
- **`house--oversight-and-government-reform--government-operations`** (f)(c)
  - Fullrun: USPS → integrated-freight-logistics 3. Die USPS ist staatlich, der Bezug zu FedEx/UPS ist nur thematisch.
  - Einschätzung: eher no_mapping.
- **`house--education-and-workforce--workforce-protections`** (f)
  - Black Lung führt zu coal, Workers' Comp zu P&C.
  - Fullrun: coking-coal 3, thermal-coal 3, P&C 3
  - Einschätzung: strittig, eher ≤2.
- **`house--education-and-workforce--early-childhood-elementary-and-secondary-education`** (f)
  - Child Care gehört laut Taxonomie zu personal-services.
  - Fullrun: education-training-services 4, personal-services 4
  - Einschätzung: Die 4 ist überkalibriert, weil K-12 staatlich ist.
- **`senate--commerce-science-and-transportation--consumer-protection-technology-and-data-privacy`** (f)
  - "property and casualty insurance" wird ausdrücklich genannt, aber nur als Listenglied.
  - Fullrun: P&C 3, internet-content-information 3, software-infrastructure 3
- **`house--appropriations--military-construction-veterans-affairs-and-related-agencies`** (f)
  - Fullrun: residential-construction 4 (Militärwohnungen?)
  - Einschätzung: überkalibriert.
- **`senate--foreign-relations--africa-and-global-health-policy`** (c)
  - Fullrun: drug-gen 2, drug-spec 2 (PEPFAR)
  - Einschätzung: eher no_mapping.

### Alte Gold-Set-Units, nicht als Kandidat übernommen

Diese Units sind eher Standardfälle mit geringer Trennschärfe; bei Bedarf als Kontrollen nutzbar:
- E&C energy
- NatRes energy-and-mineral-resources
- W&M health
- Science space-and-aeronautics
- HomeSec cybersecurity
- Approps THUD (House)
- Senate Banking digital-assets
- Senate Commerce telecommunications-and-media
- FS financial-institutions
- T&I aviation

`senate--appropriations--department-of-homeland-security` ist mit 31 Zeichen als Text ungeeignet (siehe Datenprobleme).

---

## Empfehlung: 30er-Auswahl

| Kat | Anzahl | Units |
|---|---|---|
| (f) | 10 | F1, F3, F4, F6, F7, F9, F10, F13 [ALT], F14 [ALT], F15 |
| (a) | 6 | A1 [ALT], A2 [ALT], A4, A6, A7, A9 |
| (c) | 6 | C1 [ALT], C2 [ALT], C3, C5, C7, C8 |
| (d) | 4 | D1, D2, D3, D5 |
| (e) | 2 | E1 [ALT], E2 |
| (b) | 2 | B1 (inkl. Senats-Paar), B3 |

**Eigenschaften dieser Auswahl:**
- **Typen:**
  - 23 subcommittee, davon 2 name_only
  - 3 parent_core (D1, D2, D3)
  - 4 committee_direct (C3, C5, C7, D5)
  - Das sind 7 Committee-Units, im Bestand rund 20 %.
- **Kammern:** 20 House, 9 Senate, 1 Joint. House überwiegt wie im Bestand (House-lastiger Korpus).
- **Altes Gold-Set:** 7 Units übernommen; Vergleichbarkeit ist begrenzt möglich.
- **Erwartete no_mapping-Fälle:** etwa 5–8, nämlich C1, C2, C3 (ohne Web) und C8, je nach Klärung zusätzlich D2, C5, C7 und F3. Damit ist no_mapping stärker vertreten als im Fullrun (9 %), das ist aber gewollt, weil die Versuchung zum Übermappen ein Hauptunterscheidungsmerkmal ist.
- **Abgedeckte Fallen:**
  - Stichwort: biotechnology (F1), cemeteries/Government life insurance (F4), Schiffe (F15), AI → Chips (A6)
  - Einschränkungen: "except" bzw. Inspector General (A7), "as it relates to" (F6)
  - Einstufiger Wirkungsweg: building-materials (A9)
  - Ähnliche Industries: chemicals/specialty (F14), Casinos (C3)
  - Taxonomie als Evidence: C5
  - Parent-Kontext als Evidence: C8, F15
  - Confidence-Konsistenz: B1-Paar

**Austauschoptionen:**
- Wenn D2 bis zur Vertragsklärung zurückgestellt wird: D7 oder D4.
- Für mehr Senat: F7 → F8, A9 → A11, C8 → C10.

---

## Vertragsklärungen, die vor dem Labeln nötig sind

1. **Parent-Core-Delegation.** Der Fullrun behandelt diese Parent-Cores als no_mapping mit der Begründung "an Unterausschüsse delegiert":
   - E&C, FS, Judiciary, T&I, Senate Commerce, EPW, House Appropriations

   Diese Parent-Cores mappt er dagegen:
   - Agriculture, Armed Services, Banking, Finance, HELP u. a.

   Der Vertrag enthält dazu keine Regel. Das Gold-Set braucht eine klare Vorgabe, sonst ist D2 nicht labelbar.
2. **Agency-Listen gegen Broad Scope.** Laut Rubrik ist eine bloße Behördennennung Nebengegenstand mit Confidence 2. Broad Scope verlangt ≥3. Viele Approps- und Commerce-Fälle (A7, A8, A11, A13) sind deshalb im Fullrun regelwidrig. Es ist zu entscheiden, ob "Behörde X" als Teilgegenstand gilt, wenn die Unit ausschließlich für diese Behörde zuständig ist.
3. **Modus mit oder ohne Web.** Etwa 40 Units sind im Fullrun nur per Recherche gemappt. Läuft der Benchmark ohne Webzugang, ist das Gold für diese Units no_mapping. Das Gold-Set muss den Modus festlegen oder zwei Gold-Varianten führen (betrifft C2, C3, C4, C11, F8, E4).
4. **Staatliche Akteure.** Es fehlt eine Regel für staatliche Leistungserbringer: VA-Kliniken, Bundesfriedhöfe, PMAs/TVA, GPO, USPS, USAGM, CPB, Government Life Insurance. Betroffen sind D5, F4, F10, A13, C5, C10 und A8.

## Datenprobleme

**Texte (Korpus):**
- Deutsche Kuratorenannotationen im Evidence-Text: "> *Zusatz:* ...", teils mit "überprüft". Betroffen sind die Parent-Cores
  - `house--energy-and-commerce`
  - `senate--agriculture-nutrition-and-forestry`
  - `senate--armed-services`
  - `senate--banking-housing-and-urban-affairs`
  - `senate--commerce-science-and-transportation`
  - `senate--energy-and-natural-resources`
  - `senate--environment-and-public-works`
  - `senate--foreign-relations` (zusätzlich "(bei entsprechendem Antrag ...)")
  - `senate--health-education-labor-and-pensions`

  Modelle könnten die Annotation als Evidence zitieren.
- `senate--homeland-security-and-governmental-affairs`: enthält deutsche "**Hinweis:**"- und "**Pflichten:**"-Blöcke.
- `house--intelligence`: Der Text beginnt mit "Kein Standing Committee aus Clause 1 ..." (deutsche Notiz statt Zuständigkeitstext).
- `joint--joint-economic-committee`: Der gesamte Text ist eine deutsche Zusammenfassung ("Aufgaben", "Mitglieder", "Mehrheits- und ..."), kein Originaltext.
- Silbentrennungsartefakte in House-Appropriations-Texten, z. B. "Regu- latory" (E&W), "Tech- nical"/"Develop- ment" (FSGG), "Super- fund" (Interior), "Adminis- tration"/"In- stitute" (L-HHS), "Commis- sion"/"Can- ada" (NSRP). Dazu kommen doppelte "SUBCOMMITTEE ON ..."-Überschriften. Die Wortformen erschweren die wörtliche Evidence-Prüfung.
- Zu kurze Texte:
  - `senate--appropriations--department-of-homeland-security`: 31 Zeichen (INP_EVIDENCE_TOO_SHORT)
  - `house--appropriations--homeland-security`: 65 Zeichen
  - `house--strategic-competition-...`: 256 Zeichen
- Artefakte und Boilerplate:
  - Weblink "Link to T&I Republicans' GSA Resolutions Database" (T&I economic-development)
  - Chair- bzw. Header-Artefakte in mehreren House-Judiciary-Subcommittees, T&I highways, HELP-Subcommittees und `senate--small-business-and-entrepreneurship`
  - Fußnotenmarker "Committee.16" (`house--budget`)
  - ";;" (`house--science-space-and-technology--environment`)
  - Mitgliederzahl-Boilerplate in `house--house-administration--elections` ("ii. Four majority party members ...") und in `house--oversight-and-government-reform--delivering-on-government-efficiency` ("(2) In addition, each subcommittee ...")
  - Die House-Oversight-Subcommittees beginnen mit dem Fragment "which shall have ...".
  - Streuapostroph am Textende: `house--armed-services--tactical-air-and-land-forces`, `house--education-and-workforce--health-employment-labor-and-pensions`
- Angehängter Task-Force-Text (Olympics, FIFA): `house--homeland-security--transportation-and-maritime-security`
- Quelltippfehler:
  - "Financial Stability Oversight Counsel"
  - "Chemical Safety and Hazardous Investigation Board"
  - "Office of Pollution Control and Prevention (OCSPP)"
  - "Bureau of Export Administration" (veralteter Name)
- Subcommittee-Texte mit reinem Verweis auf Rule-X-Paragraphen (Seapower, E&C O&I) enthalten keine eigene Evidence. Die Zuordnung hängt dann am Parent-Kontext, der laut Vertrag nicht als Evidence zählt.

**Fullrun (Referenz):**
- House und Senat sind bei (nahezu) identischen Appropriations-Texten inkonsistent:
  - Defense: aerospace-defense 4 gegen 2
  - Agriculture: exchanges gegen biotechnology
  - FSGG: 5 gegen 4 Zuordnungen
  - L-HHS: 4 gegen 2
  - Energy-Water: 5 gegen 3
  - Weitere Abweichungen bei Interior, THUD und Legislative Branch
  - Seapower: marine-shipping 4 gegen 2
- Uneinheitliche Behandlung der Parent-Cores (siehe Vertragsklärung 1).
- Broad Scope mit Confidence 3 auf reiner Behördennennung, entgegen der Rubrik (A7, A8, A11, A12, A13).
- Überkalibrierungen:
  - joint--printing specialty-business-services 4
  - housing-and-insurance reinsurance 4
  - small-business banks-regional 4
  - financial-services national-security aerospace-defense 4
  - digital-assets semiconductors 3 (Zwei-Schritt)
  - early-childhood und VA disability personal-services 4
- Offensichtliche Fehlgriffe:
  - `senate--appropriations` biotechnology 3R
  - `senate--finance--fiscal-responsibility-...` internet-retail 2R
  - `house--oversight-...--military-and-foreign-affairs` semiconductors 1R (Confidence 1 bei Recherche ist laut Vertrag nicht vorgesehen)
- Rund 40 Units sind nur per Recherche gemappt. Für einen Lauf ohne Web liefert der Fullrun dort keine verwertbare Referenz.

**Altes Gold-Set:**
- `development_goldset.xlsx`, Blatt `labels`: Die 22 Units haben leere Label-Spalten. Gelabelt wurden in `runs` nur 2 Units. `disagreements.md` enthält genau einen Dissens (E&C Health). Das alte Gold-Set ist also faktisch ungelabelt; [ALT] bedeutet nur "war in der Stichprobe".
