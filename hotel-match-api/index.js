const path = require("path");
require("dotenv").config();

// Simple in-memory cache for SerpApi results, to avoid burning
// search quota on repeat requests for the same city/dates.
const serpApiCache = new Map();
const SERPAPI_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function getCachedSerpApiResult(key) {
  const hit = serpApiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > SERPAPI_CACHE_TTL_MS) {
    serpApiCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCachedSerpApiResult(key, data) {
  serpApiCache.set(key, { data, time: Date.now() });
}

const fs = require("fs");
const https = require("https");

let hotelbedsAgent;

function getHotelbedsAgent() {
  if (hotelbedsAgent) return hotelbedsAgent;

  const hotelbedsCert = process.env.HOTELBEDS_CLIENT_CERT
    ? Buffer.from(process.env.HOTELBEDS_CLIENT_CERT, "base64").toString("utf8")
    : fs.readFileSync(path.join(__dirname, "hotelbeds-client-chain.pem"), "utf8");

  const hotelbedsKey = process.env.HOTELBEDS_CLIENT_KEY
    ? Buffer.from(process.env.HOTELBEDS_CLIENT_KEY, "base64").toString("utf8")
    : fs.readFileSync(path.join(__dirname, "hotelbeds-client.key"), "utf8");

  hotelbedsAgent = new https.Agent({
    cert: hotelbedsCert,
    key: hotelbedsKey,
    passphrase: process.env.HOTELBEDS_KEY_PASSPHRASE
  });

  return hotelbedsAgent;
}

function hotelbedsRequest(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        ...options,
        agent: getHotelbedsAgent()
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

    if (options.body) {
      request.setHeader(
        "Content-Length",
        Buffer.byteLength(options.body)
      );
      request.write(options.body);
    }

    request.end();
  });
}


const reviewRequestsFile = "./review-requests.json";

function saveReviewRequest(request) {
  let requests = [];

  if (fs.existsSync(reviewRequestsFile)) {
    try {

      requests = JSON.parse(fs.readFileSync(reviewRequestsFile, "utf8"));
      if (!Array.isArray(requests)) requests = [];
    } catch {
      requests = [];
    }
  }

  requests.push({
    id: `review-${Date.now()}`,
    submittedAt: new Date().toISOString(),
    ...request
  });

  fs.writeFileSync(
    reviewRequestsFile,
    JSON.stringify(requests, null, 2)
  );
}

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { normalizeHotels } = require("./normalizer");
const { mapHotelFacilities } = require("./hotel-facility-mapper");
const { matchHotels } = require("./matcher");
const { searchStayAPI } = require("./stayapi-client");
const { resolveStayAPIDestination } = require("./stayapi-destinations");
const { lookupStayAPIDestination } = require("./stayapi-destination");
const { normalizeStayAPIHotels } = require("./stayapi-normalizer");
const { getCachedFacilities } = require("./stayapi-facilities-cache");
const { getExchangeRate } = require("./fx");
const { getHotelContent } = require("./hotelbeds-content");
const { parseHotelQuery } = require("./query-parser");
const { resolveDestination } = require("./destinations");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/api/hotels", async (req, res) => {
  try {
    if (req.query.source === "stayapi") {
      let result;

      try {
        result = await searchStayAPI({
        destId: req.query.destId
      ? Number(req.query.destId)
      : (
          resolveStayAPIDestination(req.query.destination) ??
          (await lookupStayAPIDestination(req.query.destination)).destId
        ),
        checkin: req.query.checkIn || "2026-10-10",
        checkout: req.query.checkOut || "2026-10-12",
        adults: Number(req.query.adults || 2),
        rooms: Number(req.query.rooms || 1),
        children: Number(req.query.children || 0),
        childrenAges: req.query.childAges
          ? req.query.childAges.split(",").map(age => Number(age.trim()))
          : [],
        currency: req.query.currency || "USD",
        rowsPerPage: Number(req.query.rowsPerPage || 25),
        offset: Number(req.query.offset || 0)
      });
      } catch (error) {
        console.error("StayAPI search unavailable:", error.message);

        return res.status(503).json({
          total: 0,
          source: "stayapi",
          error: "StayAPI search is currently unavailable.",
          hotels: []
        });
      }

      const stayApiHotels = result.data?.hotels || [];

      const facilitiesByHotelId = Object.fromEntries(
        stayApiHotels.map(hotel => [
          hotel.hotel_id,
          getCachedFacilities(hotel.hotel_id)?.facilities || {}
        ])
      );

      const hotels = normalizeStayAPIHotels(
        stayApiHotels,
        facilitiesByHotelId
      );

      const matches = matchHotels(hotels, {
        adults: Number(req.query.adults || 2),
        children: Number(req.query.children || 0),
        maxPrice: req.query.maxPrice !== undefined
          ? Number(req.query.maxPrice)
          : undefined,
        budgetType: req.query.budgetType || "nightly",
        displayBudget: req.query.maxPrice !== undefined
          ? Number(req.query.maxPrice)
          : undefined,

        breakfastRequired: req.query.breakfast === "true",
        poolRequired: req.query.pool === "true",
        gymRequired: req.query.gym === "true",
        parkingRequired: req.query.parking === "true",
        kitchenRequired: req.query.kitchen === "true",
        familyRoomRequired: req.query.familyRoom === "true",
        internetRequired: req.query.internet === "true",

        separateSleepingSpace:
          req.query.separateSleepingSpace === "true",

        connectingRooms:
          req.query.connectingRooms === "true",

        roomTypePreference:
          req.query.roomTypePreference || null,

        roomTypeRequired:
          req.query.roomTypeRequired === "true",

        bedroomsRequired:
          req.query.bedrooms
            ? Number(req.query.bedrooms)
            : null,

        bedroomMode:
          req.query.bedroomMode || "exact",

        bedroomMax:
          req.query.bedroomMax
            ? Number(req.query.bedroomMax)
            : null
      });

      return res.json({
        total: matches.length,
        source: "stayapi",
        search: {
          destination: req.query.destination || req.query.destId,
          checkIn: req.query.checkIn || "2026-10-10",
          checkOut: req.query.checkOut || "2026-10-12",
          adults: Number(req.query.adults || 2),
          children: Number(req.query.children || 0),
          currency: req.query.currency || "USD"
        },
        hotels: matches
      });
    }

    if (req.query.source === "serpapi") {
      const { searchHotelsSerpApi } = require("./serpapi-client");
      const { normalizeSerpApiHotel } = require("./serpapi-normalizer");

      const destination = req.query.destination || req.query.q || "hotels";
      const checkIn = req.query.checkIn || "2026-12-20";
      const checkOut = req.query.checkOut || "2026-12-23";
      const currency = req.query.currency || "USD";
      const cacheKey = [destination, checkIn, checkOut, currency].join("|").toLowerCase();

      let hotels = getCachedSerpApiResult(cacheKey);

      if (!hotels) {
        let properties;
        try {
          properties = await searchHotelsSerpApi({
            query: destination,
            checkIn,
            checkOut,
            currency
          });
        } catch (error) {
          console.error("SerpApi search failed:", error.message);
          return res.status(503).json({
            total: 0,
            source: "serpapi",
            error: "Hotel search is currently unavailable.",
            hotels: []
          });
        }

        hotels = properties.map(normalizeSerpApiHotel);
        setCachedSerpApiResult(cacheKey, hotels);
      }

      return res.json({
        total: hotels.length,
        source: "serpapi",
        search: { destination, checkIn, checkOut, currency },
        hotels
      });
    }

    const apiKey = process.env.HOTELBEDS_API_KEY;
    const secret = process.env.HOTELBEDS_API_SECRET;

    const timestamp = Math.floor(Date.now() / 1000);
    console.log("Hotelbeds auth debug:", { timestamp, endpoint: "https://api-mtls.test.hotelbeds.com/hotel-api/1.0/hotels", keyLength: apiKey?.length, secretLength: secret?.length });
    const signature = crypto
      .createHash("sha256")
      .update(apiKey + secret + timestamp)
      .digest("hex");

    // User requirements
    const parsedQuery = req.query.q
      ? parseHotelQuery(req.query.q)
      : null;

    const adults =
      req.query.adults !== undefined
        ? Number(req.query.adults)
        : parsedQuery?.adults != null
          ? parsedQuery.adults
          : parsedQuery?.totalGuests
            ? 2
            : 2;

    const children =
      req.query.children !== undefined
        ? Number(req.query.children)
        : parsedQuery?.children != null
          ? parsedQuery.children
          : parsedQuery?.totalGuests
            ? Math.max(parsedQuery.totalGuests - adults, 0)
            : 2;

    const childAges =
      req.query.childAges
        ? req.query.childAges
            .split(",")
            .map(age => Number(age.trim()))
        : parsedQuery?.childAges?.length
          ? parsedQuery.childAges
          : [8, 5];

    const paxes = [
      ...Array.from(
        { length: adults },
        () => ({
          type: "AD",
          age: 30
        })
      ),

      ...childAges
        .slice(0, children)
        .map(age => ({
          type: "CH",
          age
        }))
    ];

    const body = {
      stay: {
        checkIn: req.query.checkIn || "2026-10-10",
        checkOut: req.query.checkOut || "2026-10-12"
      },

      occupancies: [
        {
          rooms: 1,
          adults,
          children,
          paxes
        }
      ],

      destination: {
        code:
          resolveDestination(
            req.query.destination ||
            parsedQuery?.destination ||
            "Dubai"
          ).code
      },
      currency:
        req.query.currency ||
        parsedQuery?.currency ||
        "EUR"
    };

    if (req.query.dryRun === "true") {
      return res.json({
        query: req.query.q || null,
        parsedQuery,
        hotelbedsRequest: body
      });
    }

    const response = await hotelbedsRequest(
      "https://api-mtls.test.hotelbeds.com/hotel-api/1.0/hotels",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Api-key": apiKey,
          "X-Signature": signature
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();

    console.log("Hotelbeds availability status:", response.status);
    console.log(
      "Hotelbeds availability response:",
      JSON.stringify(data)
    );

    if (!response.ok) {
      console.log("Hotelbeds response:", data);

      return res.status(response.status).json(data);
    }

    // Get hotel content metadata
    console.log(
      "Hotelbeds availability hotel count:",
      Array.isArray(data.hotels) ? data.hotels.length : 0
    );

    const availabilityHotels = Array.isArray(data.hotels)
      ? data.hotels
      : Array.isArray(data.hotels?.hotels)
        ? data.hotels.hotels
        : [];

    const availableHotelCodes = availabilityHotels.map(
      hotel => hotel.code
    );

    console.log(
      "Hotelbeds content request hotel codes:",
      availableHotelCodes
    );

    const contentHotels = await getHotelContent(
      availableHotelCodes
    );

    console.log(
      "Hotelbeds content hotel count:",
      contentHotels.length
    );

    const contentByHotelCode = new Map(
      contentHotels.map(hotel => [
        String(hotel.code),
        hotel
      ])
    );

    // Attach Content API room metadata to availability rooms
    for (const hotel of availabilityHotels) {
      const contentHotel = contentByHotelCode.get(
        String(hotel.code)
      );

      if (!contentHotel) {
        continue;
      }

      hotel.facilitiesMapped = mapHotelFacilities(contentHotel.facilities || []);
      console.log("Hotelbeds facilities:", String(hotel.code), contentHotel.facilities || []);
      // Preserve hotel content for presentation
      hotel.contentMetadata = {
        images: contentHotel.images || [],
        address: contentHotel.address || null,
        city: contentHotel.city || null,
        country: contentHotel.country || null,
        category: contentHotel.category || null,
        description: contentHotel.description || null
      };

      const contentRooms = contentHotel.rooms || [];

      for (const room of hotel.rooms || []) {
        const contentRoom = contentRooms.find(
          content =>
            content.roomCode === room.code
        );

        if (contentRoom) {
          room.contentMetadata = contentRoom;
        }
      }
    }

    // Normalize Hotelbeds data
    const hotels = normalizeHotels(data);

    // Match rooms against user requirements
    const checkInDate = new Date(body.stay.checkIn);
    const checkOutDate = new Date(body.stay.checkOut);

    const stayNights = Math.max(
      1,
      Math.round(
        (checkOutDate - checkInDate) /
        (1000 * 60 * 60 * 24)
      )
    );

    const budgetType =
      req.query.budgetType ||
      parsedQuery?.budgetType ||
      "nightly";

    const requestedBudget =
      req.query.maxPrice !== undefined
        ? Number(req.query.maxPrice)
        : parsedQuery?.maxPrice ?? undefined;

    const requestedCurrency = body.currency;
    const fxRates = {};

    for (const hotel of hotels) {
      for (const room of hotel.rooms || []) {
        if (
          room.price != null &&
          room.currency &&
          room.currency.toUpperCase() !== requestedCurrency.toUpperCase()
        ) {
          const fromCurrency = room.currency.toUpperCase();
          const rateKey = `${fromCurrency}_${requestedCurrency.toUpperCase()}`;

          if (!fxRates[rateKey]) {
            fxRates[rateKey] = await getExchangeRate(
              fromCurrency,
              requestedCurrency
            );
          }

          room.price = Number(
            (Number(room.price) * fxRates[rateKey]).toFixed(2)
          );

          room.currency = requestedCurrency;
        }
      }
    }

    const matcherMaxPrice =
      requestedBudget === undefined
        ? undefined
        : budgetType === "nightly"
          ? requestedBudget * stayNights
          : requestedBudget;

    const matches = matchHotels(hotels, {
      adults,
      children,

      maxPrice: matcherMaxPrice,

      budgetType,
      displayBudget: requestedBudget,

      breakfastRequired:
        req.query.breakfast === "true" ||
        parsedQuery?.breakfast === true,

      poolRequired:
        req.query.pool === "true" ||
        parsedQuery?.pool === true,

      gymRequired:
        req.query.gym === "true" ||
        parsedQuery?.gym === true,

      parkingRequired:
        req.query.parking === "true" ||
        parsedQuery?.parking === true,

      kitchenRequired:
        req.query.kitchen === "true" ||
        parsedQuery?.kitchen === true,

      familyRoomRequired:
        req.query.familyRoom === "true" ||
        parsedQuery?.roomTypePreference === "family room",

      internetRequired:
        req.query.internet === "true" ||
        parsedQuery?.internet === true,

      // Room configuration preferences
      separateSleepingSpace:
        req.query.separateSleepingSpace === "true" ||
        parsedQuery?.separateSleepingSpace === true,

      connectingRooms:
        req.query.connectingRooms === "true" ||
        parsedQuery?.connectingRooms === true,

      roomTypePreference:
        req.query.roomTypePreference ||
        parsedQuery?.roomTypePreference ||
        null,

      roomTypeRequired:
        parsedQuery?.roomTypeRequired === true,

      bedroomsRequired:
        req.query.bedrooms
          ? Number(req.query.bedrooms)
          : parsedQuery?.bedrooms ?? null,

      bedroomMode:
        parsedQuery?.bedroomMode || "exact",

      bedroomMax:
        parsedQuery?.bedroomMax ?? null
    });

    for (const match of matches) {
      match.stayNights = stayNights;
      match.totalStayPrice = match.price;
      match.pricePerNight = Number(
        (match.price / stayNights).toFixed(2)
      );
      match.currency = match.currency || "EUR";
    }

    res.json({
      total: matches.length,

      search: {
        destination: body.destination.code,
        checkIn: body.stay.checkIn,
        checkOut: body.stay.checkOut,
        adults,
        children,
        childAges,

        budgetType,
        budget: requestedBudget,
        currency: body.currency,

        separateSleepingSpace:
          req.query.separateSleepingSpace === "true" ||
          parsedQuery?.separateSleepingSpace === true,

        connectingRooms:
          req.query.connectingRooms === "true" ||
          parsedQuery?.connectingRooms === true,

        roomTypePreference:
          req.query.roomTypePreference ||
          parsedQuery?.roomTypePreference ||
          null,

        bedrooms:
          req.query.bedrooms !== undefined
            ? Number(req.query.bedrooms)
            : parsedQuery?.bedrooms ?? null,

        breakfast:
          req.query.breakfast === "true" ||
          parsedQuery?.breakfast === true,

        pool:
          req.query.pool === "true" ||
          parsedQuery?.pool === true,

        gym:
          req.query.gym === "true" ||
          parsedQuery?.gym === true,

        parking:
          req.query.parking === "true" ||
          parsedQuery?.parking === true,

        kitchen:
          req.query.kitchen === "true" ||
          parsedQuery?.kitchen === true
      },

      hotels: matches
    });

  } catch (error) {
    console.error("HotelIndice error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});



const FEATURED_CITIES = [
  "Lagos",
  "Paris",
  "Tokyo",
  "New York",
  "São Paulo",
  "Sydney"
];

const FEATURED_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
let featuredCache = null;
let featuredCacheTime = 0;

app.get("/api/hotels/featured", async (req, res) => {
  try {
    if (featuredCache && Date.now() - featuredCacheTime < FEATURED_CACHE_TTL_MS) {
      return res.json({ total: featuredCache.length, source: "serpapi", hotels: featuredCache });
    }

    const { searchHotelsSerpApi } = require("./serpapi-client");
    const { normalizeSerpApiHotel } = require("./serpapi-normalizer");

    const checkIn = "2026-12-20";
    const checkOut = "2026-12-23";

    const results = await Promise.allSettled(
      FEATURED_CITIES.map(city =>
        searchHotelsSerpApi({ query: city, checkIn, checkOut, currency: "USD" })
      )
    );

    const allHotels = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const normalized = result.value.map(normalizeSerpApiHotel);
        normalized.forEach(h => { h.featuredCity = FEATURED_CITIES[i]; });
        allHotels.push(...normalized);
      } else {
        console.error(`Featured city failed (${FEATURED_CITIES[i]}):`, result.reason?.message);
      }
    });

    featuredCache = allHotels;
    featuredCacheTime = Date.now();

    res.json({ total: allHotels.length, source: "serpapi", hotels: allHotels });
  } catch (error) {
    console.error("Featured hotels failed:", error.message);
    res.status(503).json({ total: 0, source: "serpapi", error: "Featured hotels unavailable", hotels: [] });
  }
});

app.get("/api/review-requests", (req, res) => {
  const adminToken = req.get("X-HotelIndice-Admin-Token");

  if (!adminToken || adminToken !== process.env.HOTELINDICE_ADMIN_TOKEN) {
    return res.status(401).json({
      error: "Unauthorized."
    });
  }

  let requests = [];

  if (fs.existsSync(reviewRequestsFile)) {
    try {
      requests = JSON.parse(fs.readFileSync(reviewRequestsFile, "utf8"));
      if (!Array.isArray(requests)) requests = [];
    } catch {
      requests = [];
    }
  }

  res.json({ requests });
});

app.post("/api/review-requests", (req, res) => {
  const {
    name,
    email,
    hotelName,
    city,
    message,
    website
  } = req.body || {};

  if (!name || !email || !hotelName || !city || !message) {
    return res.status(400).json({
      error: "Name, email, hotel name, city, and message are required."
    });
  }

  const reviewRequest = {
    name,
    email,
    hotelName,
    city,
    message,
    website: website || null
  };

  saveReviewRequest(reviewRequest);

  console.log("Hotel review request received:", reviewRequest);

  res.status(201).json({
    success: true,
    message: "Your hotel review request has been received."
  });
});

app.use(express.static(path.join(__dirname, "..")));

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(
      `HotelIndice API running at http://localhost:${PORT}`
    );
  });
}

module.exports = app;
