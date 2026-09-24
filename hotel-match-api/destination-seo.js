const DESTINATIONS = {
  london: {
    name: "London",
    country: "United Kingdom",
    description: "Discover and compare hotels in London by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Central London", "Westminster", "Kensington", "Shoreditch"]
  },
  paris: {
    name: "Paris",
    country: "France",
    description: "Discover and compare hotels in Paris by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["1st arrondissement", "Le Marais", "Montmartre", "Saint-Germain-des-Prés"]
  },
  amsterdam: {
    name: "Amsterdam",
    country: "Netherlands",
    description: "Discover and compare hotels in Amsterdam by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Centrum", "Jordaan", "De Pijp", "Oud-West"]
  },
  istanbul: {
    name: "Istanbul",
    country: "Türkiye",
    description: "Discover and compare hotels in Istanbul by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Sultanahmet", "Beyoğlu", "Karaköy", "Kadıköy"]
  },
  dubai: {
    name: "Dubai",
    country: "United Arab Emirates",
    description: "Discover and compare hotels in Dubai by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Downtown Dubai", "Dubai Marina", "Jumeirah", "Deira"]
  },
  tokyo: {
    name: "Tokyo",
    country: "Japan",
    description: "Discover and compare hotels in Tokyo by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Shinjuku", "Shibuya", "Ginza", "Asakusa"]
  },
  "new-york": {
    name: "New York",
    country: "United States",
    description: "Discover and compare hotels in New York by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Manhattan", "Midtown", "SoHo", "Brooklyn"]
  },
  "sao-paulo": {
    name: "São Paulo",
    country: "Brazil",
    description: "Discover and compare hotels in São Paulo by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Jardins", "Itaim Bibi", "Pinheiros", "Vila Madalena"]
  },
  "cape-town": {
    name: "Cape Town",
    country: "South Africa",
    description: "Discover and compare hotels in Cape Town by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["City Bowl", "Camps Bay", "Sea Point", "Waterfront"]
  },
  nairobi: {
    name: "Nairobi",
    country: "Kenya",
    description: "Discover and compare hotels in Nairobi by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Westlands", "Kilimani", "Karen", "Nairobi CBD"]
  },
  lagos: {
    name: "Lagos",
    country: "Nigeria",
    description: "Discover and compare hotels in Lagos by price, location, rooms, amenities, and what matters for your trip.",
    areas: ["Victoria Island", "Ikoyi", "Lekki", "Ikeja"]
  }
};

function getDestinationSeo(slug) {
  const key = String(slug || "").toLowerCase().trim();
  return DESTINATIONS[key] || null;
}

module.exports = {
  DESTINATIONS,
  getDestinationSeo
};
