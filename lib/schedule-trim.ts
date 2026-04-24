// Schedule-run trim budgets. Two distinct caps with different intents:
//
// - RESPONSE_SNIPPET_MAX: how much of the raw HTTP body from the fire-time
//   Mastra call we persist on schedule_runs.response_snippet. Kept small to
//   bound storage per run but big enough to show the failing request body.
//
// - ERROR_DISPLAY_MAX: how much of an error string we return through the MCP
//   surface. Trimmed only on the summary path — full text stays on the row.

export const RESPONSE_SNIPPET_MAX = 2000;
export const ERROR_DISPLAY_MAX = 1024;
