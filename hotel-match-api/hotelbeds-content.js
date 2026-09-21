const crypto = require("crypto");
const fs = require("fs");
const https = require("https");

const hotelbedsAgent = new https.Agent({
  cert: fs.readFileSync("./hotelbeds-client-chain.pem"),
  key: fs.readFileSync("./hotelbeds-client.key"),
  passphrase: process.env.HOTELBEDS_KEY_PASSPHRASE
});

function hotelbedsContentRequest(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        ...options,
        agent: hotelbedsAgent
      },
      response => {
        let body = "";

        response.on("data", chunk => {
          body += chunk;
        });

        response.on("end", () => {
          let data;

          try {
            data = JSON.parse(body);
          } catch {
            data = body;
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            async json() {
              return data;
            }
          });
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

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

  const response = await hotelbedsContentRequest(url, {
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
