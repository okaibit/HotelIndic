const {
  findHotelbedsDestination
} = require("./hotelbeds-destination-cache");

const DESTINATION_CODES = {
  dubai: "DXB",
  lagos: "LOS",
  abuja: "ABV",
  accra: "ACC",
  nairobi: "NBO",
  "cape town": "CPT",
  johannesburg: "JNB",
  london: "LON",
  paris: "PAR",
  barcelona: "BCN",
  madrid: "MAD",
  rome: "ROM",
  istanbul: "IST",
  "new york": "NYC",
  miami: "MIA",
  orlando: "ORL",
  toronto: "YTO"
};

function resolveDestinationCode(destination) {
  if (!destination) {
    return null;
  }

  const key = String(destination)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return DESTINATION_CODES[key] || null;
}

function normalizeDestination(destination) {
  if (!destination) {
    return null;
  }

  return String(destination)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function resolveDestination(destination) {
  const normalized = normalizeDestination(destination);

  if (!normalized) {
    return {
      query: null,
      code: null,
      resolved: false
    };
  }

  const cachedDestination =
    findHotelbedsDestination(normalized);

  if (cachedDestination) {
    return {
      query: normalized,
      code: cachedDestination.code,
      resolved: true,
      source: "hotelbeds"
    };
  }

  const code = resolveDestinationCode(normalized);

  return {
    query: normalized,
    code,
    resolved: Boolean(code),
    source: code ? "local" : null
  };
}

module.exports = {
  DESTINATION_CODES,
  resolveDestinationCode,
  normalizeDestination,
  resolveDestination
};
