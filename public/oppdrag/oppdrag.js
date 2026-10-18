const form = document.querySelector("#requestForm");
const status = document.querySelector("#formStatus");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const values = Object.fromEntries(new FormData(form).entries());
  status.className = "form-status";
  status.textContent = "Sender forespørselen ...";
  button.disabled = true;

  try {
    const response = await fetch("/api/oppdrag", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Forespørselen kunne ikke sendes.");
    status.textContent = payload.distribution?.status === "awaiting_recipients"
      ? "Takk. Oppdraget er mottatt og klargjort for testpersoner. Testtelefonnumre må legges inn før SMS kan sendes."
      : "Takk. Oppdraget er mottatt og lagt i kø for SMS-fordeling til testpersoner.";
    form.reset();
  } catch (error) {
    status.className = "form-status error";
    status.textContent = error.message || "Noe gikk galt. Prøv igjen.";
  } finally {
    button.disabled = false;
  }
});
