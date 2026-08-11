export const trip = {
  slug: "sample-trip-2030-01-15",
  title: "Sample day trip",
  date: "2030-01-15",
  timezone: "Asia/Tokyo",
  location: "Sample City",
};

export const sources = [
  {
    number: 1,
    title: "Sample place — official site",
    host: "example.com",
    url: "https://example.com/place",
  },
];

export const activities = [
  {
    start: "09:00",
    end: "11:30",
    type: "Visit",
    icon: "📍",
    title: "Sample place",
    detail: "A generic seed activity for local development.",
    refs: [1],
  },
  {
    start: "12:00",
    end: "13:00",
    type: "Lunch",
    icon: "🍜",
    title: "Lunch",
    detail: "A generic meal break.",
    refs: [],
  },
];
