const FX_API_URL = "https://api.frankfurter.dev/v2";

async function getExchangeRate(from, to) {
  const base = String(from).toUpperCase();
  const quote = String(to).toUpperCase();

  if (base === quote) {
    return 1;
  }

  const response = await fetch(
    `${FX_API_URL}/rate/${base}/${quote}`
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`FX ${response.status}: ${body}`);
  }

  const data = await response.json();

  if (typeof data.rate !== "number") {
    throw new Error("FX response did not contain a valid rate");
  }

  return data.rate;
}

async function convertCurrency(amount, from, to) {
  const rate = await getExchangeRate(from, to);

  return {
    amount: Number(amount) * rate,
    rate,
    from: String(from).toUpperCase(),
    to: String(to).toUpperCase()
  };
}

module.exports = {
  getExchangeRate,
  convertCurrency
};
