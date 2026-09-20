const crypto = require("crypto");

async function getHotelContent(hotelCodes = []) {
  const apiKey = process.env.HOTELBEDS_API_KEY;
  const secret = process.env.HOTELBEDS_API_SECRET;

  if (!apiKey || !secret) {
    throw new Error("Hotelbeds API credentials are missing");
  }

  if (!hotelCodes.length) {
    return [];
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const signature = crypto
    .createHash("sha256")
    .update(apiKey + secret + timestamp)
    .digest("hex");

  const url =
    "https://api.test.hotelbeds.com/hotel-content-api/1.0/hotels" +
    "?fields=all" +
    "&language=ENG" +
    "&from=1" +
    "&to=100" +
    "&codes=" +
    hotelCodes.join(",");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Api-key": apiKey,
      "X-Signature": signature
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Hotelbeds Content API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return Array.isArray(data.hotels)
    ? data.hotels
    : [];
}

module.exports = {
  getHotelContent
};
