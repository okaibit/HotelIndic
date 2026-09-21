const fs = require("fs");
const path = require("path");

const cacheFile = path.join(__dirname, "stayapi-facilities-cache.json");

function loadFacilitiesCache() {
  if (!fs.existsSync(cacheFile)) {
    return {};
  }

  try {
    const data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveFacilitiesCache(cache) {
  fs.writeFileSync(
    cacheFile,
    JSON.stringify(cache, null, 2)
  );
}

function getCachedFacilities(hotelId) {
  const cache = loadFacilitiesCache();
  return cache[String(hotelId)] || null;
}

function setCachedFacilities(hotelId, facilities) {
  const cache = loadFacilitiesCache();

  cache[String(hotelId)] = {
    facilities,
    cachedAt: new Date().toISOString()
  };

  saveFacilitiesCache(cache);
}

module.exports = {
  loadFacilitiesCache,
  saveFacilitiesCache,
  getCachedFacilities,
  setCachedFacilities
};
