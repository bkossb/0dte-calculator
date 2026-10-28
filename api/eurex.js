const PRODUCT_CATALOG = {
  ODAP: "3734540",
  ODAX: "ODAX",
};

const statusEl = document.getElementById("status");
const summaryCardsEl = document.getElementById("summaryCards");
const overviewBody = document.getElementById("overviewBody");
const detailBody = document.getElementById("detailBody");
const productSelect = document.getElementById("product");
const customIdInput = document.getElementById("productIdCustom");
const busdateInput = document.getElementById("busdate");
const loadBtn = document.getElementById("loadBtn");

const CONTRACT_TYPES = ["W", "E", "M"];

function formatNumber(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "n/a";
  return num.toLocaleString("pl-PL");
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "n/a") return "n/a";
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return `${num.toFixed(3)}`;
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

function formatDateForDisplay(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "";
  const year = yyyymmdd.slice(0, 4);
  const month = yyyymmdd.slice(4, 6);
  const day = yyyymmdd.slice(6, 8);
  return `${day}.${month}.${year}`;
}

function createPreviousBusinessDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 3);
  else if (day === 6) d.setDate(d.getDate() - 2);
  else d.setDate(d.getDate() - 1);

  return d;
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
  if (Array.isArray(payload.dataRows)) return payload.dataRows;
  return [];
}

function normalizeEurexOverview(payload) {
  const header = payload?.header || {};
  const rowsSource = Array.isArray(payload?.dataRows)
    ? payload.dataRows
    : normalizeRows(payload);

  const rows = rowsSource.map((row) => {
    const callOI = Number(row.callOpenInterest ?? row.callOI ?? row.openInterest ?? 0);
    const putOI = Number(row.putOpenInterest ?? row.putOI ?? 0);
    const callVol = Number(row.callVolume ?? row.callVol ?? 0);
    const putVol = Number(row.putVolume ?? row.putVol ?? 0);
    const totalVol = Number(row.total ?? row.volume ?? callVol + putVol ?? 0);
    const totalOI = Number(row.openInterest ?? callOI + putOI ?? 0);

    return {
      date: row.date,
      expiryLabel: formatDateForDisplay(String(row.date || "")),
      contractType: row.contractType || row.type || "",
      totalOpenInterest: totalOI,
      totalVolume: totalVol,
      openInterest: totalOI,
      volume: totalVol,
      callVolume: callVol,
      putVolume: putVol,
      callOpenInterest: callOI,
      putOpenInterest: putOI,
      putCallRatio:
        row.putCallRatio === "n/a" || row.putCallRatio === null || row.putCallRatio === undefined
          ? null
          : Number(row.putCallRatio),
    };
  });

  const safeRows = rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    productCode: payload?.meta?.productCode || payload?.productCode || "",
    isin: payload?.meta?.isin || payload?.isin || "",
    underlyingClose: Number(header.underlyingClosingPrice ?? payload?.underlyingClose ?? 0),
    totalVolume: Number(header.volume ?? payload?.totalVolume ?? 0),
    totalOpenInterest: Number(header.openInterest ?? payload?.totalOpenInterest ?? 0),
    putCallRatio:
      header.putCallRatio === "n/a" || header.putCallRatio === undefined
        ? null
        : Number(header.putCallRatio),
    rows: safeRows,
  };
}

function renderSummary(summary) {
  const nearest = summary.rows[0] || null;
  const bestOi = summary.rows.reduce((best, row) =>
    row.totalOpenInterest > best.totalOpenInterest ? row : best
  , summary.rows[0] || { totalOpenInterest: 0, expiryLabel: "n/a" });

  const bestVolume = summary.rows.reduce((best, row) =>
    row.totalVolume > best.totalVolume ? row : best
  , summary.rows[0] || { totalVolume: 0, expiryLabel: "n/a" });

  summaryCardsEl.innerHTML = `
    <div class="summary-card">
      <span class="label">Produkt</span>
      <div class="value">${summary.productCode || "—"}</div>
    </div>
    <div class="summary-card">
      <span class="label">Underlying</span>
      <div class="value">${formatNumber(summary.underlyingClose)}</div>
    </div>
    <div class="summary-card">
      <span class="label">Najbliższa expiry</span>
      <div class="value">${nearest ? nearest.expiryLabel : "—"}</div>
    </div>
    <div class="summary-card">
      <span class="label">OI / Vol</span>
      <div class="value">${formatNumber(summary.totalOpenInterest)} / ${formatNumber(summary.totalVolume)}</div>
    </div>
  `;

  if (summary.rows.length) {
    statusEl.textContent = `Najbliższa: ${nearest ? nearest.expiryLabel : "—"}, max OI: ${bestOi.expiryLabel}, max volume: ${bestVolume.expiryLabel}`;
  }
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
      <td>${row.expiryLabel || row.date || ""}</td>
      <td>${row.contractType ?? ""}</td>
      <td>${formatNumber(row.totalOpenInterest)}</td>
      <td>${formatNumber(row.totalVolume)}</td>
      <td>${row.putCallRatio === null ? "n/a" : formatPercent(row.putCallRatio)}</td>
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
      <td>${formatNumber(row.openInterest ?? row.totalOpenInterest ?? 0)}</td>
      <td>${formatNumber(row.volume ?? row.totalVolume ?? 0)}</td>
      <td>${row.close ?? row.settlement ?? ""}</td>
    `;
    detailBody.appendChild(tr);
  });
}

async function fetchEurex(params) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`/api/eurex?${query}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || "request failed"}`);
  }

  return response.json();
}

async function loadOverview() {
  try {
    const productId = getSelectedProductId();
    const busdate = busdateInput.value;
    const apiDate = formatDateForApi(new Date(`${busdate}T00:00:00`));

    statusEl.textContent = "Pobieram overview...";

    const data = await fetchEurex({
      product: productId,
      busdate: apiDate,
      filtertype: "overview",
    });

    const summary = normalizeEurexOverview(data);
    renderSummary(summary);
    renderOverview(summary.rows);
    statusEl.textContent = `Overview OK — ${summary.rows.length} rekordów`;
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
      try {
        const data = await fetchEurex({
          product: productId,
          busdate: apiBusDate,
          filtertype: "detail",
          productdate: productDate,
          contracttype: type,
        });

        const candidate = normalizeRows(data);
        if (candidate.length) {
          rows = candidate;
          renderDetail(rows);
          statusEl.textContent = `Strike chain OK — ${rows.length} rekordów (${type})`;
          return;
        }
      } catch (error) {
        // kolejny typ kontraktu
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

// domyślnie ładowanie dla ODAP
loadOverview();
