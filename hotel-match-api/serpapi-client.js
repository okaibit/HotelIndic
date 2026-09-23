const { request } = require("undici");

const SERPAPI_KEY = process.env.SERPAPI_KEY;

async function searchHotelsSerpApi({
  query,
  checkIn,
  checkOut,
  currency = "USD",
  nextPageToken = null
}) {
  if (!SERPAPI_KEY) {
    throw new Error("Missing SERPAPI_KEY in environment");
  }

  const params = new URLSearchParams({
    engine: "google_hotels",
    q: query,
    check_in_date: checkIn,
    check_out_date: checkOut,
    currency,
    api_key: SERPAPI_KEY
  });

  if (nextPageToken) {
    params.set("next_page_token", nextPageToken);
  }

  const res = await request(
    `https://serpapi.com/search?${params}`
  );

  const data = await res.body.json();

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`);
  }

  return {
    properties: data.properties || [],
    nextPageToken:
      data.serpapi_pagination?.next_page_token || null
  };
}

module.exports = {
  searchHotelsSerpApi
};
