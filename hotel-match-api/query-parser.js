function parseHotelQuery(text = "") {
  const query = text.toLowerCase();

  const result = {
    destination: null,
    adults: 2,
    children: 0,
    totalGuests: null,
    childAges: [],
    bedrooms: null,
    bedroomMode: null,
    bedroomMax: null,
    separateSleepingSpace: false,
    breakfast: false,
    pool: false,
    gym: false,
    parking: false,
    kitchen: false,
    maxPrice: null,
    budgetType: null,
    roomTypePreference: null,
  roomTypeRequired: false,
    connectingRooms: false
  };

  const destinationMatch = query.match(
    /\b(?:in|near|around|at|to)\s+([a-z][a-z .'-]*?)(?=\s+(?:with|under|below|for|near|around|at|and|$))/i
  );

  if (destinationMatch) {
    result.destination = destinationMatch[1]
      .trim()
      .replace(/\s+/g, " ");
  }

  const adultsMatch = query.match(/(\d+)\s*adults?/);
  const childrenMatch = query.match(/(\d+)\s*(?:children|kids?)/);
  const childAgesMatch = query.match(/(?:children|kids?)\s+(?:aged|ages?)\s+([\d\s,and]+)/);
  const familyMatch = query.match(/family\s+of\s+(\d+)/);

  const bedroomRangeMatch = query.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:bedrooms?|br)\b/);
  const bedroomMinimumMatch = query.match(/(?:at least|minimum of|no fewer than)\s*(\d+)\s*(?:bedrooms?|br)\b/);
  const bedroomMatch = query.match(/(\d+)\s*(?:bedrooms?|br)\b/);

  if (adultsMatch) {
    result.adults = Number(adultsMatch[1]);
  }

  if (childrenMatch) {
    result.children = Number(childrenMatch[1]);
  }

  if (childAgesMatch) {
    result.childAges = (childAgesMatch[1].match(/\d+/g) || []).map(Number);
  }

  if (familyMatch && !adultsMatch && !childrenMatch) {
    result.adults = null;
    result.children = null;
    result.totalGuests = Number(familyMatch[1]);
  }

  if (bedroomRangeMatch) {
    result.bedrooms = Number(bedroomRangeMatch[1]);
    result.bedroomMax = Number(bedroomRangeMatch[2]);
    result.bedroomMode = "range";
  } else if (bedroomMinimumMatch) {
    result.bedrooms = Number(bedroomMinimumMatch[1]);
    result.bedroomMode = "minimum";
  } else if (bedroomMatch) {
    result.bedrooms = Number(bedroomMatch[1]);
    result.bedroomMode = "exact";
  }

  const roomTypeMatch = query.match(
    /\b(apartment|suite|villa|family room|standard room|deluxe room)\b/
  );

  if (roomTypeMatch) {
    result.roomTypePreference = roomTypeMatch[1];
  }

  if (result.roomTypePreference) {
    const roomTypePattern = new RegExp(
      `\\b(?:${result.roomTypePreference})\\b`,
      "i"
    );

    if (roomTypePattern.test(query)) {
      result.roomTypeRequired = true;
    }
  }

  result.breakfast = /\bbreakfast\b/.test(query);
  result.pool = /\bpool\b|\bswimming pool\b/.test(query);

  result.separateSleepingSpace =
    /separate sleeping (?:areas?|spaces?)/.test(query) ||
    /separate bedroom/.test(query) ||
    /(?:kids?|children) (?:have|need) their own room/.test(query);

  result.connectingRooms =
    /connecting rooms?/.test(query) ||
    /interconnecting rooms?/.test(query) ||
    /inter[- ]connected rooms?/.test(query);

  result.gym = /\bgym\b|\bfitness\b/.test(query);
  result.parking = /\bparking\b|\bcar park\b/.test(query);
  result.kitchen = /\bkitchen\b|\bkitchenette\b/.test(query);

  const priceMatch = query.match(
    /(?:under|below|max(?:imum)?|less than)\s*([₦$€£])?\s*([\d,]+)\s*(k|thousand)?/
  );

  if (priceMatch) {
    let amount = Number(priceMatch[2].replace(/,/g, ""));

    if (priceMatch[3] === "k" || priceMatch[3] === "thousand") {
      amount *= 1000;
    }

    const currencyMap = {
      "₦": "NGN",
      "$": "USD",
      "€": "EUR",
      "£": "GBP"
    };

    result.maxPrice = amount;
    result.currency = currencyMap[priceMatch[1]] || null;
    result.budgetType = /\bper night\b|\beach night\b|\bnightly\b/.test(query)
      ? "nightly"
      : "total";
  }

  return result;
}

module.exports = {
  parseHotelQuery
};
