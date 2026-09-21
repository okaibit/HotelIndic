const crypto = require("crypto");

const HOTELBEDS_DESTINATIONS_URL =
  "https://api.test.hotelbeds.com/hotel-content-api/1.0/locations/destinations";

async function getHotelbedsDestinations() {
  if (!process.env.HOTELBEDS_API_KEY) {
    throw new Error("HOTELBEDS_API_KEY is not configured");
  }

  if (!process.env.HOTELBEDS_API_SECRET) {
    throw new Error("HOTELBEDS_API_SECRET is not configured");
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const signature = crypto
    .createHash("sha256")
    .update(
      process.env.HOTELBEDS_API_KEY +
      process.env.HOTELBEDS_API_SECRET +
      timestamp
    )
    .digest("hex");

  const response = await fetch(
    `${HOTELBEDS_DESTINATIONS_URL}?fields=all&language=ENG&from=1&to=1000`,
    {
      headers: {
        Accept: "application/json",
        "Api-key": process.env.HOTELBEDS_API_KEY,
        "X-Signature": signature
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hotelbeds destinations ${response.status}: ${body}`);
  }

  return response.json();
}

module.exports = {
  getHotelbedsDestinations
};
