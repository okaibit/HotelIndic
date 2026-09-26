const path = require("path");
if (process.env.VERCEL !== "1") require("dotenv").config();

function getDefaultStayDates() {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 1);

  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);

  const format = date => date.toISOString().slice(0, 10);

  return {
    checkIn: format(checkIn),
    checkOut: format(checkOut)
  };
}

// Simple in-memory cache for SerpApi results, to avoid burning
// search quota on repeat requests for the same city/dates.
const serpApiCache = new Map();
const SERPAPI_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours


function getCachedSerpApiPage(key) {
  const hit = serpApiCache.get(`page:${key}`);

  if (!hit) return null;

  if (Date.now() - hit.time > SERPAPI_CACHE_TTL_MS) {
    serpApiCache.delete(`page:${key}`);
    return null;
  }

  return hit.data;
}

function setCachedSerpApiPage(key, data) {
  serpApiCache.set(`page:${key}`, {
    data,
    time: Date.now()
  });

  if (serpApiCache.size > 100) {
    const oldestKey = serpApiCache.keys().next().value;
    serpApiCache.delete(oldestKey);
  }
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
const { DESTINATIONS, getDestinationSeo } = require("./destination-seo");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/api/traffic/tiles/:z/:x/:y", async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const apiKey = process.env.TOMTOM_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "TomTom API key is not configured" });
    }

    const url =
      `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.png` +
      `?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to load traffic tile" });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    res.set("Content-Type", response.headers.get("content-type") || "image/png");
    res.set("Cache-Control", "public, max-age=30");

    res.send(buffer);
  } catch (error) {
    console.error("TomTom traffic tile error:", error);
    res.status(500).json({ error: "Failed to load traffic tile" });
  }
});

app.get("/api/hotels", async (req, res) => {
  try {
    const defaultStayDates = getDefaultStayDates();
    if (req.query.source === "stayapi") {
      if (req.query.destId !== undefined && !Number.isInteger(Number(req.query.destId))) {
        return res.status(400).json({ error: "Invalid destId" });
      }

      if (req.query.adults !== undefined && (!Number.isInteger(Number(req.query.adults)) || Number(req.query.adults) < 1)) {
        return res.status(400).json({ error: "Invalid adults" });
      }

      if (req.query.rooms !== undefined && (!Number.isInteger(Number(req.query.rooms)) || Number(req.query.rooms) < 1)) {
        return res.status(400).json({ error: "Invalid rooms" });
      }

      if (req.query.children !== undefined && (!Number.isInteger(Number(req.query.children)) || Number(req.query.children) < 0)) {
        return res.status(400).json({ error: "Invalid children" });
      }

      if (req.query.childAges !== undefined) {
        const childAges = req.query.childAges
          .split(",")
          .map(age => Number(age.trim()));

        if (childAges.some(age => !Number.isFinite(age) || age < 0)) {
          return res.status(400).json({ error: "Invalid childAges" });
        }
      }

      if (req.query.maxPrice !== undefined && (!Number.isFinite(Number(req.query.maxPrice)) || Number(req.query.maxPrice) < 0)) {
        return res.status(400).json({ error: "Invalid maxPrice" });
      }

      if (req.query.offset !== undefined && (!Number.isInteger(Number(req.query.offset)) || Number(req.query.offset) < 0)) {
        return res.status(400).json({ error: "Invalid offset" });
      }

      if (req.query.rowsPerPage !== undefined && (!Number.isInteger(Number(req.query.rowsPerPage)) || Number(req.query.rowsPerPage) < 1)) {
        return res.status(400).json({ error: "Invalid rowsPerPage" });
      }

      let result;

      try {
        result = await searchStayAPI({
        destId: req.query.destId !== undefined
          ? Number(req.query.destId)
          : (
              resolveStayAPIDestination(req.query.destination) ??
              (await lookupStayAPIDestination(req.query.destination)).destId
            ),
        checkin: req.query.checkIn || defaultStayDates.checkIn,
        checkout: req.query.checkOut || defaultStayDates.checkOut,
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
          checkIn: req.query.checkIn || defaultStayDates.checkIn,
          checkOut: req.query.checkOut || defaultStayDates.checkOut,
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
      const checkIn = req.query.checkIn || defaultStayDates.checkIn;
      const checkOut = req.query.checkOut || defaultStayDates.checkOut;
      const currency = req.query.currency || "USD";

      const allowedLimits = [20, 50, 100, 200];
      const requestedLimit = Number(req.query.limit || 20);
      const limit = allowedLimits.includes(requestedLimit)
        ? requestedLimit
        : 20;

      const cacheKey = [
        destination,
        checkIn,
        checkOut,
        currency
      ].join("|").toLowerCase();

      const allHotels = [];
      let nextPageToken = null;
      let page = 1;

      while (allHotels.length < limit) {
        const pageCacheKey = [
          cacheKey,
          page
        ].join("|");

        let cachedPage = getCachedSerpApiPage(pageCacheKey);

        if (cachedPage) {
          allHotels.push(...cachedPage.properties);
          nextPageToken = cachedPage.nextPageToken;
        } else {
          let result;

          try {
            result = await searchHotelsSerpApi({
              query: destination,
              checkIn,
              checkOut,
              currency,
              nextPageToken
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

          const normalizedPage = {
            properties: result.properties.map(normalizeSerpApiHotel),
            nextPageToken: result.nextPageToken
          };

          setCachedSerpApiPage(
            pageCacheKey,
            normalizedPage
          );

          allHotels.push(...normalizedPage.properties);
          nextPageToken = normalizedPage.nextPageToken;
        }

        if (!nextPageToken) {
          break;
        }

        page += 1;
      }

      const hotels = allHotels.slice(0, limit);

      return res.json({
        total: hotels.length,
        requested: limit,
        hasMore: Boolean(nextPageToken),
        source: "serpapi",
        search: {
          destination,
          checkIn,
          checkOut,
          currency
        },
        hotels
      });
    }

    const apiKey = process.env.HOTELBEDS_API_KEY;
    const secret = process.env.HOTELBEDS_API_SECRET;
const hotelbedsHotelsUrl = process.env.HOTELBEDS_HOTELS_URL;

    const timestamp = Math.floor(Date.now() / 1000);
    console.log("Hotelbeds auth debug:", { timestamp, endpoint: hotelbedsHotelsUrl, keyLength: apiKey?.length, secretLength: secret?.length });
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
            : 0;

    const childAges =
      req.query.childAges
        ? req.query.childAges
            .split(",")
            .map(age => Number(age.trim()))
        : parsedQuery?.childAges?.length
          ? parsedQuery.childAges
          : [];

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
        checkIn: req.query.checkIn || defaultStayDates.checkIn,
        checkOut: req.query.checkOut || defaultStayDates.checkOut
      },

      occupancies: [
        {
          rooms: 1,
          adults,
          children,
          paxes
        }
      ],

      destination: (() => {
        const destinationInput =
          req.query.destination ||
          parsedQuery?.destination ||
          null;

        const resolved = resolveDestination(destinationInput);

        if (!resolved.code) {
          throw new Error(
            `Hotelbeds destination could not be resolved: ${destinationInput || "missing"}`
          );
        }

        return {
          code: resolved.code
        };
      })(),
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
      hotelbedsHotelsUrl,
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
  "London",
  "Paris",
  "Amsterdam",
  "Istanbul",
  "Dubai",
  "Tokyo",
  "New York",
  "São Paulo",
  "Cape Town",
  "Nairobi"
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

    const defaultStayDates = getDefaultStayDates();
    const checkIn = req.query.checkIn || defaultStayDates.checkIn;
    const checkOut = req.query.checkOut || defaultStayDates.checkOut;

    const results = await Promise.allSettled(
      FEATURED_CITIES.map(city =>
        searchHotelsSerpApi({ query: city, checkIn, checkOut, currency: "USD" })
      )
    );

    const allHotels = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const normalized = (result.value.properties || []).map(normalizeSerpApiHotel);

        if (normalized.length) {
          const hotel = normalized[0];
          hotel.featuredCity = FEATURED_CITIES[i];
          allHotels.push(hotel);
        }
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

const site = "https:" + "/" + "/" + "hotelindice.com";
const schema = "https:" + "/" + "/" + "schema.org";
const sitemapNS = "http:" + "/" + "/" + "www.sitemaps.org/schemas/sitemap/0.9";

app.get("/sitemap.xml", (req, res) => {
  const urls = [
    site + "/",
    ...Object.keys(DESTINATIONS).map(slug => site + "/hotels/" + slug)
  ];

  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="' + sitemapNS + '">' +
    urls.map(url => "  <url><loc>" + url + "</loc></url>").join("\n") +
    "</urlset>";

  res.type("application/xml").send(xml);
});

app.get("/hotels/:destination", (req, res) => {
  const rawSlug = decodeURIComponent(req.params.destination || "")
    .toLowerCase()
    .trim();

  const seo = getDestinationSeo(rawSlug);

  const destination = seo
    ? seo.name
    : rawSlug
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, char => char.toUpperCase());

  const indexPath = path.join(__dirname, "..", "index.html");

  try {
    let html = fs.readFileSync(indexPath, "utf8");

    const safeDestination = destination
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const canonicalDestination = rawSlug
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const description = seo
      ? seo.description
      : "Discover and compare hotels in " + destination + " by price, location, rooms, amenities, and what actually matters for your trip.";

    const safeDescription = description
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const destinationContent = seo
      ? '<section class="destination-seo-content" aria-labelledby="destinationSeoTitle">' +
        '<h1 id="destinationSeoTitle">Hotels in ' + safeDestination + '</h1>' +
        "<p>" + safeDescription + "</p>" +
        "<p>Compare hotels across " + safeDestination + ", including popular areas such as " + seo.areas.join(", ") + ".</p>" +
        '<nav class="destination-internal-links" aria-label="Explore more destinations">' +
        "<h2>Explore more destinations</h2>" +
        '<div class="destination-link-list">' +
        Object.entries(DESTINATIONS)
          .filter(([slug]) => slug !== canonicalDestination)
          .map(([slug, item]) => '<a href="/hotels/' + slug + '">Hotels in ' + item.name + "</a>")
          .join("") +
        "</div></nav></section>"
      : "";

    const destinationSchema = seo
      ? {
          "@context": schema,
          "@type": "CollectionPage",
          "name": "Hotels in " + seo.name,
          "url": site + "/hotels/" + canonicalDestination,
          "description": seo.description,
          "about": {
            "@type": "Place",
            "name": seo.name,
            "address": {
              "@type": "PostalAddress",
              "addressCountry": seo.country
            }
          }
        }
      : null;

    html = html
      .replace(/<title>.*?<\/title>/i, "<title>HotelIndice — Hotels in " + safeDestination + "</title>")
      .replace(/<meta name="description" content=".*?">/i, '<meta name="description" content="' + safeDescription + '">')
      .replace(/<link rel="canonical" href=".*?">/i, '<link rel="canonical" href="' + site + "/hotels/" + canonicalDestination + '">')
      .replace(/<meta property="og:title" content=".*?">/i, '<meta property="og:title" content="HotelIndice — Hotels in ' + safeDestination + '">')
      .replace(/<meta property="og:description" content=".*?">/i, '<meta property="og:description" content="' + safeDescription + '">')
      .replace(/<meta property="og:url" content=".*?">/i, '<meta property="og:url" content="' + site + "/hotels/" + canonicalDestination + '">')
      .replace(/<meta name="twitter:title" content=".*?">/i, '<meta name="twitter:title" content="HotelIndice — Hotels in ' + safeDestination + '">')
      .replace(/<meta name="twitter:description" content=".*?">/i, '<meta name="twitter:description" content="' + safeDescription + '">')

    if (destinationContent) {
      html = html.replace(
        '<div class="list-panel" id="listPanel">',
        `${destinationContent}\n<div id="hotelResults"`
      );
    }

    if (destinationSchema) {
      html = html.replace(
        "</head>",
        `<script type="application/ld+json">${JSON.stringify(destinationSchema)}</script>\n</head>`
      );
    }

    res.type("html").send(html);
  } catch (error) {
    console.error("Destination page render failed:", error);
    res.status(500).send("HotelIndice destination page unavailable.");
  }
});

app.get("/robots.txt", (req, res) => {
  const sitemapUrl = "https:" + "/" + "/" + "hotelindice.com" + "/sitemap.xml";

  res.type("text/plain").send(
    "User-agent: *\n" +
    "Allow: /\n\n" +
    "Sitemap: " + sitemapUrl + "\n"
  );
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
