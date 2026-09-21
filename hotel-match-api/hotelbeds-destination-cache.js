const fs = require("fs");
const path = require("path");

const {
  getHotelbedsDestinations
} = require("./hotelbeds-destinations");

const cacheFile = path.join(
  __dirname,
  "hotelbeds-destinations.json"
);

function normalizeDestinationName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function saveHotelbedsDestinations(destinations) {
  fs.writeFileSync(
    cacheFile,
    JSON.stringify(
      {
        cachedAt: new Date().toISOString(),
        total: destinations.length,
        destinations
      },
      null,
      2
    )
  );
}

async function importHotelbedsDestinations() {
  const firstPage = await getHotelbedsDestinations();

  const total = Number(firstPage.total || 0);
  const pageSize =
    Number(firstPage.to) - Number(firstPage.from) + 1;

  const destinations = [
    ...(firstPage.destinations || [])
  ];

  let from = Number(firstPage.to) + 1;

  while (from <= total) {
    const result = await getHotelbedsDestinationsPage(
      from,
      from + pageSize - 1
    );

    destinations.push(
      ...(result.destinations || [])
    );

    from += pageSize;
  }

  const normalized = destinations.map(destination => ({
    code: destination.code,
    name: destination.name?.content || "",
    normalizedName: normalizeDestinationName(
      destination.name?.content
    ),
    countryCode: destination.countryCode || null,
    isoCode: destination.isoCode || null
  }));

  saveHotelbedsDestinations(normalized);

  return normalized;
}

async function getHotelbedsDestinationsPage(from, to) {
  const crypto = require("crypto");

  const timestamp = Math.floor(Date.now() / 1000);

  const signature = crypto
    .createHash("sha256")
    .update(
      process.env.HOTELBEDS_API_KEY +
      process.env.HOTELBEDS_API_SECRET +
      timestamp
    )
    .digest("hex");

  const url =
    "https://api.test.hotelbeds.com/hotel-content-api/1.0/locations/destinations" +
    `?fields=all&language=ENG&from=${from}&to=${to}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Api-key": process.env.HOTELBEDS_API_KEY,
      "X-Signature": signature
    }
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Hotelbeds destinations ${response.status}: ${body}`
    );
  }

  return response.json();
}

function loadHotelbedsDestinations() {
  if (!fs.existsSync(cacheFile)) {
    return [];
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(cacheFile, "utf8")
    );

    return Array.isArray(data.destinations)
      ? data.destinations
      : [];
  } catch {
    return [];
  }
}

function findHotelbedsDestination(destination) {
  const normalized = normalizeDestinationName(destination);

  if (!normalized) {
    return null;
  }

  const destinations = loadHotelbedsDestinations();

  return (
    destinations.find(
      item => item.normalizedName === normalized
    ) || null
  );
}

module.exports = {
  normalizeDestinationName,
  saveHotelbedsDestinations,
  loadHotelbedsDestinations,
  findHotelbedsDestination,
  importHotelbedsDestinations
};
