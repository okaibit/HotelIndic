require("dotenv").config();

const fs = require("fs");
const { Agent } = require("undici");

const hotelbedsDispatcher = new Agent({
  connect: {
    cert: fs.readFileSync("./certificate-39e00eb4d82118becdb11aa32ae1b1a6f2bebd61eef2ed58b1cfe628b9638438.pem"),
    key: fs.readFileSync("./hotelbeds-client.key"),
    passphrase: process.env.HOTELBEDS_KEY_PASSPHRASE
  }
});

const crypto = require("crypto");

async function getFacilityTypes() {
  const apiKey = process.env.HOTELBEDS_API_KEY;
  const secret = process.env.HOTELBEDS_API_SECRET;

  if (!apiKey || !secret) {
    throw new Error("Hotelbeds API credentials are missing");
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const signature = crypto
    .createHash("sha256")
    .update(apiKey + secret + timestamp)
    .digest("hex");

  const url =
    "https://api.test.hotelbeds.com/hotel-content-api/1.0/types/facilities" +
    "?fields=all" +
    "&language=ENG" +
    "&from=1" +
    "&to=500";

  const response = await fetch(url, {
    method: "GET",
    dispatcher: hotelbedsDispatcher,
    headers: {
      Accept: "application/json",
      "Api-key": apiKey,
      "X-Signature": signature
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Hotelbeds Facility API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return Array.isArray(data.facilities)
    ? data.facilities
    : [];
}

module.exports = {
  getFacilityTypes
};
