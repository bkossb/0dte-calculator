export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const { product, busdate, productdate, filtertype, contracttype } = req.query;

  if (!product || !busdate || !filtertype) {
    return res.status(400).json({
      error: "Brakuje parametrów: product, busdate, filtertype",
    });
  }

  const directUrl = new URL(`https://www.eurex.com/api/v1/overallstatistics/${product}`);
  directUrl.searchParams.set("busdate", String(busdate));
  directUrl.searchParams.set("filtertype", String(filtertype));

  if (productdate) {
    directUrl.searchParams.set("productdate", String(productdate));
  }

  if (contracttype) {
    directUrl.searchParams.set("contracttype", String(contracttype));
  }

  const candidates = [
    directUrl.toString(),
    `https://api.allorigins.win/get?url=${encodeURIComponent(directUrl.toString())}`,
    `https://r.jina.ai/http://https://www.eurex.com/api/v1/overallstatistics/${product}?busdate=${encodeURIComponent(String(busdate))}&filtertype=${encodeURIComponent(String(filtertype))}${productdate ? `&productdate=${encodeURIComponent(String(productdate))}` : ""}${contracttype ? `&contracttype=${encodeURIComponent(String(contracttype))}` : ""}`,
  ];

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        },
      });

      const text = await response.text();

      if (candidate.includes("allorigins.win")) {
        const parsed = JSON.parse(text);
        if (!parsed || !parsed.contents) {
          throw new Error("Empty proxy response");
        }
        const data = JSON.parse(parsed.contents);
        return res.status(200).json(data);
      }

      if (candidate.includes("r.jina.ai")) {
        try {
          const data = JSON.parse(text);
          return res.status(200).json(data);
        } catch {
          return res.status(200).send(text);
        }
      }

      if (text.trim().startsWith("[") || text.trim().startsWith("{")) {
        return res.status(response.status).json(JSON.parse(text));
      }

      return res.status(response.status).send(text);
    } catch (error) {
      lastError = error;
    }
  }

  return res.status(502).json({
    error: "Błąd przy pobieraniu danych z Eurex",
    details: lastError?.message || "Nieznany błąd",
    tried: candidates.length,
  });
}
