// Separate data and configuration for the NBR collaboration-partner directory.
(function exposeCollaborationDirectory() {
  const trades = ["entreprenør", "elektro", "rørlegger", "tømrer", "murer", "maler", "ventilasjon", "tak"];
  const roleLabels = {
    entreprenør: "Entreprenør",
    elektro: "Elektro",
    rørlegger: "Rørlegger",
    tømrer: "Tømrer",
    murer: "Murer",
    maler: "Maler",
    ventilasjon: "Ventilasjon",
    tak: "Tak",
  };
  const regionAnchors = {
    bergensregionen: { lat: 60.39299, lon: 5.32415 },
    stavangerregionen: { lat: 58.97, lon: 5.7331 },
    haugalandsregionen: { lat: 59.505, lon: 5.7 },
    grenlandsregionen: { lat: 59.14, lon: 9.61 },
    sorlandsregionen: { lat: 58.1467, lon: 7.9956 },
  };
  const seeds = {
    bergensregionen: ["Fjordglimt", "Vestkyst", "Nordlys", "Byfjorden", "Havstein"],
    stavangerregionen: ["Jær", "Rogaland", "Sørvest", "Lyng", "Storhaug"],
    haugalandsregionen: ["Haugaland", "Sjøbris", "Karmsund", "Sunnhordland", "Vestavind"],
    grenlandsregionen: ["Grenland", "Telemark", "Skienselva", "Frier", "Kystlinje"],
    sorlandsregionen: ["Sørlys", "Agder", "Skagerrak", "Palme", "Kystbyen"],
  };
  const contacts = ["Ida Nilsen", "Marius Berg", "Silje Hauge", "Jonas Vik", "Nora Strand"];
  const directory = Object.entries(seeds).flatMap(([regionId, regionSeeds]) => regionSeeds.flatMap((seed, companyIndex) => (
    trades.map((trade, tradeIndex) => {
      const region = regionAnchors[regionId];
      const angle = ((tradeIndex * regionSeeds.length + companyIndex) / 40) * Math.PI * 2;
      const radius = 0.01 + ((tradeIndex + companyIndex) % 4) * 0.006;
      const lat = region.lat + Math.cos(angle) * radius;
      const lon = region.lon + Math.sin(angle) * radius;
      const namePart = seed.toLowerCase().replace(/å/g, "a").replace(/ø/g, "o").replace(/æ/g, "ae");
      return {
        id: `${regionId}-${trade}-${companyIndex}`,
        regionId,
        trade,
        company: `${seed} ${roleLabels[trade]} AS`,
        phone: `900 ${String(10 + tradeIndex).padStart(2, "0")} ${String(10 + companyIndex).padStart(2, "0")}`,
        contact: contacts[companyIndex],
        website: `https://www.${namePart}-${trade}.example`,
        email: `kontakt@${namePart}-${trade}.example`,
        lat,
        lon,
      };
    })
  )));

  window.NBRCollaboration = Object.freeze({ trades, roleLabels, directory });
})();
