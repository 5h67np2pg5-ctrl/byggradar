// Felles fagkonfigurasjon for samarbeidspartnerlisten i brukerflaten.
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
  window.NBRCollaboration = Object.freeze({ trades, roleLabels });
})();
