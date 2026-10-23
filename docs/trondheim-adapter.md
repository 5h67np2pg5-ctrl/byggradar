# Trondheim-adapter

Adapteret for Trondheim kommune er laget som en separat forhåndskontroll mot kommunens
offisielle innsynsportal. Det skriver kun rapport til `reports/` og endrer ikke NBR-data.

## Kjøring

```bash
npm run preview:trondheim-api
```

Konfigurasjonen ligger i `config/trondheim-api-preview.json`, og den delte adapteren ligger i
`scripts/lib/trondheim-adapter.mjs`. Kontrollscriptet bruker samme adapter som HTTP-ruten:

```text
GET /api/municipalities/trondheim/building-cases
GET /api/municipalities/trondheim/building-cases?refresh=1
GET /api/municipalities/trondheim/building-cases?source=norske-postlister&refresh=1
```

Filteret bruker samme bokmål-/nynorskbaserte byggefilter som Bergen-adapteret. API-et cacher et
vellykket svar i 15 minutter og samler parallelle kall til ett upstream-kall. `refresh=1` tvinger
ny kontroll mot kommunens kilde.

## Viktig avgrensning

Adapteret importerer ikke saker. Ved feil fra Trondheim-portalen svarer HTTP-ruten `503` og
rapporten markeres som `unavailable`; ingen tall skal brukes som bekreftet datagrunnlag. Første
kontroll mot kilden gir nå meldingen `Innsyn er oppdatert, last siden på ny`. Dette er en feil fra
upstream-kilden, ikke et beregnet NBR-resultat.

Som midlertidig kontrollkilde støttes `source=norske-postlister`. Denne kjører det åpne
JSON-søket hos Norske postlister dag for dag i et 90-dagers vindu, dedupliserer dokumenter og
saker, og merker svaret som `private-control-source`. Det er ikke en erstatning for kommunens
egen levering og skal ikke blandes inn i offisielle kommunetall uten særskilt godkjenning.
