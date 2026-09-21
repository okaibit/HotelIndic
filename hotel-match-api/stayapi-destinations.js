const STAYAPI_DESTINATIONS = {
  "lagos": -2017355,
  "lagos, nigeria": -2017355,
  "lagos, nigeria": -2017355,
  "bang tao beach": -3233180
};

function resolveStayAPIDestination(destination) {
  if (destination === undefined || destination === null) {
    return null;
  }

  const key = String(destination).trim().toLowerCase();

  if (/^-?\d+$/.test(key)) {
    return Number(key);
  }

  return STAYAPI_DESTINATIONS[key] ?? null;
}

module.exports = {
  STAYAPI_DESTINATIONS,
  resolveStayAPIDestination
};
