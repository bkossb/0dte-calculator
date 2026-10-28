const PRODUCT_CATALOG = {
  ODAP: "3734540",
  ODAX: "ODAX",
};

const statusEl = document.getElementById("status");
const overviewBody = document.getElementById("overviewBody");
const detailBody = document.getElementById("detailBody");
const productSelect = document.getElementById("product");
const customIdInput = document.getElementById("productIdCustom");
const busdateInput = document.getElementById("busdate");
const loadBtn = document.getElementById("loadBtn");

const CONTRACT_TYPES = ["W", "E", "M"];

function createPreviousBusinessDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 3);
  else if (day === 6) d.setDate(d.getDate() - 2);
  else d.setDate(d.getDate() - 1);

  return d;
}

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateForApi(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function setDefaultBusDate() {
  const prev = createPreviousBusinessDay();
  busdateInput.value = formatDateForInput(prev);
}

function getSelectedProductId() {
  const productKey = productSelect.value;
  if (productKey === "ODAX") {
    const custom = (customIdInput.value || "").trim();
    if (!custom) {
      throw new Error("Wpisz ID produktu dla ODAX albo wybierz ODAP.");
    }
    return custom;
  }

  return PRODUCT_CATALOG[productKey] || productKey;
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.result)) return payload.result;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.overview)) return payload.overview;
  return [];
}

function renderOverview(rows) {
  overviewBody.innerHTML = "";

  if (!rows.length) {
    overviewBody.innerHTML = '<tr><td colspan="5">Brak danych overview.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = "clickable";

    tr.innerHTML = `
      <td>${row.date ?? ""}</td>
      <td>${row.contractType ?? ""}</td>
      <td>${row.openInterest ?? row.oi ?? ""}</td>
      <td>${row.volume ?? ""}</td>
      <td>${row.settlement ?? row.close ?? ""}</td>
    `;

    tr.addEventListener("click", () => {
      loadStrikeChain(row.date, row.contractType);
    });

    overviewBody.appendChild(tr);
  });
}

function renderDetail(rows) {
  detailBody.innerHTML = "";

  if (!rows.length) {
    detailBody.innerHTML = '<tr><td colspan="5">Brak danych strike chain.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.strike ?? ""}</td>
      <td>${row.contractType ?? ""}</td>
      <td>${row.openInterest ?? row.oi ?? ""}</td>
      <td>${row.volume ?? ""}</td>
      <td>${row.close ?? row.settlement ?? ""}</td>
    `;
    detailBody.appendChild(tr);
  });
}

async function fetchJsonWithFallback(url) {
  const candidates = [
    url,
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  ];

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();

      if (candidate.includes("allorigins.win")) {
        const parsed = JSON.parse(text);
        if (!parsed || !parsed.contents) {
          throw new Error("Empty proxy response");
        }

        const data = JSON.parse(parsed.contents);
        return data;
      }

      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Nie udało się pobrać danych z Eurex.");
}

async function loadOverview() {
  try {
    const productId = getSelectedProductId();
    const busdate = busdateInput.value;
    const apiDate = formatDateForApi(new Date(`${busdate}T00:00:00`));

    const url =
      `https://www.eurex.com/api/v1/overallstatistics/${productId}` +
      `?busdate=${apiDate}&filtertype=overview`;

    statusEl.textContent = "Pobieram overview...";
    const data = await fetchJsonWithFallback(url);
    const rows = normalizeRows(data);
    renderOverview(rows);
    statusEl.textContent = `Overview OK — ${rows.length} rekordów`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Błąd: ${error.message}`;
  }
}

async function loadStrikeChain(productDate, contractType) {
  try {
    const productId = getSelectedProductId();
    const busdate = busdateInput.value;
    const apiBusDate = formatDateForApi(new Date(`${busdate}T00:00:00`));

    statusEl.textContent = `Pobieram strike chain dla ${productDate}...`;

    let rows = [];
    for (const type of [contractType, ...CONTRACT_TYPES.filter((t) => t !== contractType)]) {
      const url =
        `https://www.eurex.com/api/v1/overallstatistics/${productId}` +
        `?filtertype=detail&productdate=${productDate}&busdate=${apiBusDate}&contracttype=${type}`;

      try {
        const data = await fetchJsonWithFallback(url);
        const candidate = normalizeRows(data);
        if (candidate.length) {
          rows = candidate;
          renderDetail(rows);
          statusEl.textContent = `Strike chain OK — ${rows.length} rekordów (${type})`;
          return;
        }
      } catch (error) {
        // kontynuujemy do kolejnego typu kontraktu
      }
    }

    renderDetail([]);
    statusEl.textContent = `Brak danych dla ${productDate} przy użyciu typów ${[contractType, ...CONTRACT_TYPES].join(", ")}`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Błąd strike chain: ${error.message}`;
  }
}

productSelect.addEventListener("change", () => {
  const isOdax = productSelect.value === "ODAX";
  customIdInput.disabled = !isOdax;
  customIdInput.placeholder = isOdax ? "Wpisz ID produktu ODAX" : "Przy ODAP ID jest podane automatycznie";
});

loadBtn.addEventListener("click", loadOverview);

setDefaultBusDate();
customIdInput.disabled = true;
