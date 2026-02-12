// lib/sources.js
// All source definitions and batch prompts in one place

export const SOURCES = [
  { id: "ted_crypto", label: "TED — Crypto/Blockchain", region: "EU", cat: "crypto" },
  { id: "ted_forensics", label: "TED — Crypto Forensics/AML", region: "EU", cat: "crypto" },
  { id: "ted_seizure", label: "TED — Seizure/Forfeiture", region: "EU", cat: "crypto" },
  { id: "ted_insider", label: "TED — Insider Threat/SIEM", region: "EU", cat: "insider_threat" },
  { id: "uk_crypto", label: "UK — Crypto/Digital Assets", region: "UK", cat: "crypto" },
  { id: "uk_insider", label: "UK — Insider Threat", region: "UK", cat: "insider_threat" },
  { id: "no_crypto", label: "Norway — Doffin/Mercell", region: "Nordics", cat: "crypto" },
  { id: "fi_crypto", label: "Finland — Hilma/Hansel", region: "Nordics", cat: "crypto" },
  { id: "dk_crypto", label: "Denmark — Udbud/Ethics", region: "Nordics", cat: "crypto" },
  { id: "se_crypto", label: "Sweden — Polisen/Avropa", region: "Nordics", cat: "crypto" },
  { id: "is_crypto", label: "Iceland — Rikiskaup/TendSign", region: "Nordics", cat: "crypto" },
  { id: "lv_crypto", label: "Latvia — IUB/EIS", region: "Baltics", cat: "crypto" },
  { id: "lt_crypto", label: "Lithuania — CVP IS", region: "Baltics", cat: "crypto" },
  { id: "ee_crypto", label: "Estonia — Riigihangete", region: "Baltics", cat: "crypto" },
  { id: "sam_crypto", label: "USA — SAM.gov Crypto", region: "US", cat: "crypto" },
  { id: "sam_seizure", label: "USA — SAM.gov Seizure", region: "US", cat: "crypto" },
  { id: "sam_insider", label: "USA — SAM.gov Insider/SIEM", region: "US", cat: "insider_threat" },
];

export const BATCHES = [
  {
    id: "eu",
    label: "EU (TED)",
    sourceIds: ["ted_crypto", "ted_forensics", "ted_seizure", "ted_insider"],
    prompt: `Search ted.europa.eu for procurement notices published in the last 60 days. Search for these four categories separately:

1. "ted_crypto" — cryptocurrency, blockchain, bitcoin, ethereum, stablecoin, DeFi, tokenization, distributed ledger, virtual currency, digital asset, crypto exchange
2. "ted_forensics" — blockchain analytics, Chainalysis, Elliptic, TRM Labs, CipherTrace, crypto forensics, cryptocurrency investigation, AML crypto
3. "ted_seizure" — asset seizure, forfeiture, confiscated assets, asset recovery, liquidation of seized assets, proceeds of crime, seized cryptocurrency
4. "ted_insider" — insider threat, SIEM, data loss prevention, UEBA, privileged access management, security operations, zero trust

Return a JSON object with 4 keys. Each key is the category ID (ted_crypto, ted_forensics, ted_seizure, ted_insider). Each value is an array of notice objects.
Each notice: {"title":"...","buyer":"...","country":"XX","date":"YYYY-MM-DD","notice_id":"...","url":"https://ted.europa.eu/..."}
Empty categories = empty array. Return ONLY the JSON. No markdown.`,
  },
  {
    id: "uk",
    label: "UK",
    sourceIds: ["uk_crypto", "uk_insider"],
    prompt: `Search these UK government procurement portals for tenders from the last 30 days:
- https://www.find-tender.service.gov.uk
- https://www.contractsfinder.service.gov.uk

Search for two categories:

1. "uk_crypto" — cryptocurrency, blockchain, digital assets, bitcoin, crypto custody, blockchain analytics, Chainalysis, crypto forensics, DeFi, stablecoin, virtual assets, distributed ledger
2. "uk_insider" — insider threat, SIEM, data loss prevention, privileged access management, security operations center, zero trust, endpoint detection

Return a JSON object with 2 keys (uk_crypto, uk_insider). Each value is an array of notice objects.
Each notice: {"title":"...","buyer":"...","country":"UK","date":"YYYY-MM-DD","notice_id":"...","url":"https://..."}
Empty categories = empty array. Return ONLY the JSON. No markdown.`,
  },
  {
    id: "nordics",
    label: "Nordics",
    sourceIds: ["no_crypto", "fi_crypto", "dk_crypto", "se_crypto", "is_crypto"],
    prompt: `Search the following Nordic procurement portals for tenders from the last 60 days related to cryptocurrency, blockchain, digital assets, crypto forensics, Chainalysis, crypto custody, AML crypto, virtual currency.

Search each country's portals:

"no_crypto" (Norway): doffin.no, app.mercell.com, eu.eu-supply.com/ctm/supplier/publictenders
"fi_crypto" (Finland): hankintailmoitukset.fi (Hilma), hansel.fi/en/framework-agreements, poliisi.fi/hankinnat
"dk_crypto" (Denmark): udbud.dk, app.mercell.com, ethics.dk/ethics/eo. Also check mercell.com/da-dk/udbud/252548981 for Danish crypto forensics framework.
"se_crypto" (Sweden): upphandling.polisen.se, polisen.se/en/the-swedish-police/procurements-purchases, avropa.se
"is_crypto" (Iceland): island.is/en/tender-website, tendsign.is, utbod.reykjavik.is, rikiskaup.is

Return a JSON object with 5 keys (no_crypto, fi_crypto, dk_crypto, se_crypto, is_crypto). Each value is an array of notice objects.
Each notice: {"title":"...","buyer":"...","country":"XX","date":"YYYY-MM-DD","notice_id":"...","url":"https://..."}
Empty countries = empty array. Return ONLY the JSON. No markdown.`,
  },
  {
    id: "baltics_us",
    label: "Baltics + USA",
    sourceIds: ["lv_crypto", "lt_crypto", "ee_crypto", "sam_crypto", "sam_seizure", "sam_insider"],
    prompt: `Search the following procurement portals for tenders from the last 60 days.

BALTICS — search for cryptocurrency, blockchain, digital assets, crypto forensics, cybersecurity:

"lv_crypto" (Latvia): info.iub.gov.lv/lv/meklet, eis.gov.lv/EKEIS/Supplier, izsoles.ta.gov.lv. Also check vp.gov.lv for Reactor software procurement.
"lt_crypto" (Lithuania): cvpp.eviesiejipirkimai.lt, viesiejipirkimai.lt, cpo.lt. Also check vmi.lt for crypto admin tenders.
"ee_crypto" (Estonia): riigihanked.riik.ee, also TED europa.eu filtered to Estonia (EE).

USA — search sam.gov:

"sam_crypto": cryptocurrency, blockchain, digital assets, bitcoin, crypto custody, blockchain analytics, Chainalysis, Elliptic, TRM Labs, crypto forensics
"sam_seizure": asset seizure, forfeiture, seized property disposal, US Marshals, crypto asset seizure, Treasury forfeiture
"sam_insider": insider threat, SIEM, data loss prevention, UEBA, privileged access, SOC, zero trust, endpoint detection

Return a JSON object with 6 keys (lv_crypto, lt_crypto, ee_crypto, sam_crypto, sam_seizure, sam_insider). Each value is an array of notice objects.
Each notice: {"title":"...","buyer":"...","country":"XX","date":"YYYY-MM-DD","notice_id":"...","url":"https://..."}
Empty sources = empty array. Return ONLY the JSON. No markdown.`,
  },
];

export const REGIONS = ["All", "EU", "UK", "Nordics", "US", "Baltics"];
export const CATS = ["All", "crypto", "insider_threat"];
