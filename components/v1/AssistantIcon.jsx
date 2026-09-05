const paths = {
  back: "M19 12H5m6-6-6 6 6 6",
  close: "m6 6 12 12M18 6 6 18",
  expand: "M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7",
  collapse: "M20 4l-7 7m0-6v6h6M4 20l7-7m-6 0h6v6",
  history: "M3 11a9 9 0 1 1 2 7M3 5v6h6m3-4v5l3 2",
  new: "M12 5H5v14h14v-7M16 3l5 5m-2-7 4 4-10 10H9v-4Z",
  prompt: "M5 12h14m-5-5 5 5-5 5",
  send: "M12 19V5m-6 6 6-6 6 6",
  stop: "M6 6h12v12H6Z",
};

export default function AssistantIcon({ name }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
