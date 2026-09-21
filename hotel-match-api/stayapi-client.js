const STAYAPI_URL = "https://api.stayapi.com/v1/booking/search";

async function searchStayAPI({
  destId,
  checkin,
  checkout,
  adults = 2,
  rooms = 1,
  children = 0,
  childrenAges = [],
  currency = "USD",
  rowsPerPage = 25,
  offset = 0,
}) {
  if (!process.env.STAYAPI_API_KEY) {
    throw new Error("STAYAPI_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    dest_id: String(destId),
    checkin,
    checkout,
    adults: String(adults),
    rooms: String(rooms),
    children: String(children),
    currency,
    rows_per_page: String(rowsPerPage),
    offset: String(offset),
  });

  if (childrenAges.length > 0) {
    params.set("children_ages", childrenAges.join(","));
  }

  const response = await fetch(`${STAYAPI_URL}?${params}`, {
    headers: {
      "x-api-key": process.env.STAYAPI_API_KEY,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`StayAPI ${response.status}: ${body}`);
  }

  return response.json();
}

module.exports = {
  searchStayAPI,
};
