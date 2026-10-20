# Nasjonale anskaffelseskilder

Innsamlingen i `scripts/collect-national-procurements.mjs` bruker én felles modell for alle anskaffelser. Det legges ikke inn CPV-, fag- eller bygg/anlegg-filter i adapterlaget. Filtrering kan gjøres senere i visning og søk.

## Kilder

- **Doffin**: nasjonal hovedkilde for norske offentlige kunngjøringer. Adapteren bruker Doffins offisielle Public API-inngang når `DOFFIN_API_KEY` er satt. Endepunktet kan overstyres med `DOFFIN_API_BASE_URL`.
- **TED**: EUs kunngjøringsdatabase. Adapteren bruker TED Search API og søker som standard etter kunngjøringer med kjøperland Norge. Søk kan overstyres med `TED_QUERY`.
- **Bane NOR**: bruker eksisterende lokale uttrekk fra planlagte og pågående anskaffelser.
- **Statens vegvesen**: offentlig side for planlagte og pågående anskaffelser. Adapteren kan lese en overstyrt HTML-inngang og beholder lenker som kilde.
- **Statsbygg**: leverandør- og markedsdialog. Konkurranser bør samtidig dekkes gjennom Doffin/TED.
- **Avinor**: leverandør- og anskaffelsesinformasjon.
- **Kystverket**: planlagte anskaffelser og kunngjøringer.
- **Nye Veier**: leverandør- og markedsinformasjon.
- **Forsvarsbygg**: leverandør- og anskaffelsesinformasjon.
- **NVE**: anskaffelsesinformasjon.
- **Sykehusinnkjøp**: nasjonal offentlig innkjøpskilde.

## Arbeidsflyt

1. Adapteren henter råposter uten bransjefilter.
2. Poster normaliseres til felles felter: tittel, oppdragsgiver, type, status, dato, frist, kommune/sted, dokumentnummer, kilde og vedlegg.
3. Duplikater fjernes per kilde og dokumentnummer/tittel.
4. `public/data/national_projects.json` skrives med både poster og status per kilde.

Kilder som ikke har et dokumentert eller konfigurert API blir ikke fremstilt som komplette. De får status `not_configured` eller `error` i innsamlingsrapporten.
