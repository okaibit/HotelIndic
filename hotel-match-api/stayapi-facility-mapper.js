function mapStayAPIFacilities(facilities = {}) {
  const allFacilities = Object.values(facilities)
    .flat()
    .map(item => String(item).toLowerCase());

  const has = (...terms) =>
    terms.some(term =>
      allFacilities.some(item => item.includes(term))
    );

  return {
    pool: has("swimming pool", "fenced pool"),
    gym: has("fitness center", "fitness"),
    parking: has("parking"),
    internet: has("free wifi", "wifi", "internet"),
    kitchen: has("kitchen"),
    familyRoom: has("family rooms", "family room"),
    spa: has("spa", "wellness center"),
    restaurant: has("restaurant"),
    breakfast: has("breakfast"),
    airportShuttle: has("airport shuttle"),
    wheelchairAccessible: has("wheelchair accessible"),
    seaView: has("sea view"),
    cityView: has("city view"),
    sauna: has("sauna"),
    hotTub: has("hot tub", "jacuzzi")
  };
}

module.exports = {
  mapStayAPIFacilities
};
