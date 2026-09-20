function inferBedroomCount(roomName = "") {
  const name = roomName.toLowerCase();

  const patterns = [
    { regex: /\\b(?:four|4)\\s*(?:bedrooms?|br)\\b/, count: 4 },
    { regex: /\\b(?:three|3)\\s*(?:bedrooms?|br)\\b/, count: 3 },
    { regex: /\\b(?:two|2)\\s*(?:bedrooms?|br)\\b/, count: 2 },
    { regex: /\\b(?:one|1)\\s*(?:bedrooms?|br)\\b/, count: 1 }
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(name)) {
      return pattern.count;
    }
  }

  return 0;
}

function matchHotels(hotels, requirements = {}) {
  const {
    adults = 2,
    children = 0,
    breakfastRequired = false,
    poolRequired = false,
    gymRequired = false,
    parkingRequired = false,
    kitchenRequired = false,
    familyRoomRequired = false,
    internetRequired = false,
    maxPrice,
    separateSleepingSpace = false,
    connectingRooms = false,
    roomTypePreference = null,
    roomTypeRequired = false,
    bedroomsRequired = null,
    bedroomMode = "exact",
    bedroomMax = null,
    budgetType = "nightly",
    displayBudget
  } = requirements;

  const matches = [];

  for (const hotel of hotels) {
    for (const room of hotel.rooms || []) {
      const roomName = (room.roomName || "").toLowerCase();

      const hasCapacityData =
        room.maxPax != null ||
        room.maxAdults != null ||
        room.maxChildren != null;

      if (!hasCapacityData) {
        continue;
      }

      const maxPax = room.maxPax != null ? Number(room.maxPax) : null;
      const maxAdults = room.maxAdults != null ? Number(room.maxAdults) : null;
      const maxChildren = room.maxChildren != null ? Number(room.maxChildren) : null;

      if (
        maxPax != null && maxPax < adults + children
      ) {
        continue;
      }

      if (
        maxAdults != null && maxAdults < adults
      ) {
        continue;
      }

      if (
        maxChildren != null && maxChildren < children
      ) {
        continue;
      }

      const roomStays = room.roomStays || [];

      const isConnectingRoom =
        room.characteristicCode === "CM" ||
        roomName.includes("connecting room") ||
        roomName.includes("connecting rooms") ||
        roomName.includes("interconnecting room") ||
        roomName.includes("interconnecting rooms");

      if (connectingRooms && !isConnectingRoom) {
        continue;
      }

      const facilities = hotel.facilitiesMapped || {};

      if (poolRequired && !facilities.pool) continue;
      if (gymRequired && !facilities.gym) continue;
      if (parkingRequired && !facilities.parking) continue;
      if (kitchenRequired && !facilities.kitchen) continue;
      if (familyRoomRequired && !facilities.familyRoom) continue;
      if (internetRequired && !facilities.internet) continue;

      if (breakfastRequired && !room.breakfastIncluded) {
        continue;
      }

      if (
        maxPrice !== undefined &&
        Number(room.price) > Number(maxPrice)
      ) {
        continue;
      }

      const structuredBedroomCount = roomStays.filter(
        stay => stay.stayType === "BED"
      ).length;

      const nameBedroomCount = inferBedroomCount(roomName);

      const bedroomCount = Math.max(
        structuredBedroomCount,
        nameBedroomCount
      );

      const hasLivingRoom = roomStays.some(
        stay => stay.stayType === "LIV"
      );

      const looksLikeFamilyRoom =
        roomName.includes("family");

      const looksLikeSuite =
        roomName.includes("suite");

      const looksLikeApartment =
        roomName.includes("apartment");

      let configurationRank = 0;
      let configurationReason = null;

      if (bedroomCount >= 4) {
        configurationRank = 5;
        configurationReason = `${bedroomCount}-bedroom configuration`;
      } else if (bedroomCount === 3) {
        configurationRank = 4;
        configurationReason = "3-bedroom configuration";
      } else if (bedroomCount === 2) {
        configurationRank = 3;
        configurationReason = "2-bedroom configuration";
      } else if (bedroomCount === 1) {
        configurationRank = hasLivingRoom ? 2 : 1;
        configurationReason = "1-bedroom configuration";
      } else if (looksLikeFamilyRoom) {
        configurationRank = 1;
        configurationReason = "Family room configuration";
      } else if (looksLikeSuite || looksLikeApartment) {
        configurationRank = 1;
        configurationReason = looksLikeSuite
          ? "Suite-style configuration"
          : "Apartment-style configuration";
      }

      if (bedroomsRequired != null) {
        if (bedroomMode === "minimum") {
          if (bedroomCount < bedroomsRequired) {
            continue;
          }
        } else if (bedroomMode === "range") {
          if (
            bedroomCount < bedroomsRequired ||
            (bedroomMax != null && bedroomCount > bedroomMax)
          ) {
            continue;
          }
        } else {
          if (bedroomCount !== bedroomsRequired) {
            continue;
          }
        }
      }

      let matchLevel = "possible";
      let matchLabel = "Possible match";
      let matchRank = 1;

      if (separateSleepingSpace) {
        if (bedroomCount >= 2) {
          matchLevel = "exact";
          matchLabel = "Exact match";
          matchRank = 3;
        } else if (bedroomCount === 1 && hasLivingRoom) {
          matchLevel = "good";
          matchLabel = "Good match";
          matchRank = 2;
        }
      } else {
        matchLevel = "exact";
        matchLabel = "Exact match";
        matchRank = 3;
      }

      let preferenceRank = 0;
      let preferenceReason = null;

      if (roomTypePreference) {
        const preferred = roomTypePreference.toLowerCase();

        const typeMatches =
          roomName.includes(preferred) ||
          (room.roomType || "").toLowerCase() === preferred;

        if (roomTypeRequired && !typeMatches) {
          continue;
        }

        if (typeMatches) {
          preferenceRank = 2;
          preferenceReason =
            `Matches room preference: ${roomTypePreference}`;
        }
      }

      let priceRank = 0;

      if (maxPrice !== undefined && maxPrice > 0) {
        const priceRatio = Number(room.price) / Number(maxPrice);

        if (priceRatio <= 0.5) {
          priceRank = 3;
        } else if (priceRatio <= 0.75) {
          priceRank = 2;
        } else {
          priceRank = 1;
        }
      }

      const reasons = [
        `Fits ${adults} adults and ${children} children`
      ];

      if (configurationReason) {
        reasons.push(configurationReason);
      }

      if (
        separateSleepingSpace &&
        bedroomCount >= 2
      ) {
        reasons.push(
          `${bedroomCount} separate sleeping areas`
        );
      } else if (
        separateSleepingSpace &&
        bedroomCount === 1 &&
        hasLivingRoom
      ) {
        reasons.push("Bedroom plus living room");
      }

      if (breakfastRequired) {
        reasons.push("Breakfast included");
      }

      if (poolRequired) {
        reasons.push("Pool available");
      }

      if (gymRequired) {
        reasons.push("Gym available");
      }

      if (parkingRequired) {
        reasons.push("Parking available");
      }

      if (kitchenRequired) {
        reasons.push("Kitchen available");
      }

      if (familyRoomRequired) {
        reasons.push("Family room available");
      }

      if (internetRequired) {
        reasons.push("Internet available");
      }

      if (maxPrice !== undefined) {
        const budgetLabel =
          displayBudget !== undefined
            ? `${displayBudget} ${budgetType === "nightly" ? "per night" : "total"}`
            : maxPrice;

        reasons.push(`Within budget of ${budgetLabel}`);
      }

      if (preferenceReason) {
        reasons.push(preferenceReason);
      }

      matches.push({
        hotelCode: hotel.hotelCode,
        hotelName: hotel.hotelName,
        latitude: hotel.latitude,
        longitude: hotel.longitude,

        // Real Hotelbeds hotel metadata
        images: hotel.images || [],
        address: hotel.address || null,
        city: hotel.city || null,
        country: hotel.country || null,
        category: hotel.category || null,
        description: hotel.description || null,

        facilitiesMapped: hotel.facilitiesMapped || {},

        // Real Hotelbeds room/rate metadata
        roomName: room.roomName,
        roomCode: room.roomCode,
        roomFacilities: room.roomFacilities || [],
        roomStays: room.roomStays || [],
        minPax: room.minPax ?? null,
        rateKey: room.rateKey || null,
        bookable: room.bookable === true,
        allotment: room.allotment ?? null,
        cancellationPolicies: room.cancellationPolicies || [],

        price: room.price,
        currency: room.currency,
        stayNights: null,

        capacity: {
          minPax: room.minPax,
          maxPax: room.maxPax,
          maxAdults: room.maxAdults,
          maxChildren: room.maxChildren
        },

        configuration: {
          bedroomCount,
          hasLivingRoom,
          roomType: room.roomType,
          characteristicCode: room.characteristicCode
        },

        breakfastIncluded: room.breakfastIncluded,
        board: room.board,

        match: {
          level: matchLevel,
          label: matchLabel,
          reasons
        },

        matchRank,
        configurationRank,
        preferenceRank,
        priceRank
      });
    }
  }

  const bestByRoom = new Map();

  for (const match of matches) {
    const key = `${match.hotelCode}:${match.roomCode}`;
    const existing = bestByRoom.get(key);

    if (!existing || match.price < existing.price) {
      bestByRoom.set(key, match);
    }
  }

  const dedupedMatches = Array.from(bestByRoom.values());

  dedupedMatches.sort((a, b) => {
    if (b.matchRank !== a.matchRank) {
      return b.matchRank - a.matchRank;
    }

    if (separateSleepingSpace) {
      const aBedroomDistance =
        a.configuration.bedroomCount >= 2
          ? a.configuration.bedroomCount - 2
          : 99;

      const bBedroomDistance =
        b.configuration.bedroomCount >= 2
          ? b.configuration.bedroomCount - 2
          : 99;

      if (aBedroomDistance !== bBedroomDistance) {
        return aBedroomDistance - bBedroomDistance;
      }
    }

    if (b.preferenceRank !== a.preferenceRank) {
      return b.preferenceRank - a.preferenceRank;
    }

    return a.price - b.price;
  });

  return dedupedMatches;
}

module.exports = {
  matchHotels
};
