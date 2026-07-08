const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || process.env.WOMENS_PORT || 3002;
const CACHE_TTL_MS = 15000;
let matchCache = { data: null, fetchedAt: 0 };
let matchFetchPromise = null;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
}));

const WOMENS_WORLD_CUP_TEAMS = {
  ausw: "Australia Women", banw: "Bangladesh Women", engw: "England Women",
  indw: "India Women", irew: "Ireland Women", nzw: "New Zealand Women",
  nedw: "Netherlands Women", pakw: "Pakistan Women", scow: "Scotland Women",
  rsaw: "South Africa Women", slw: "Sri Lanka Women", wiw: "West Indies Women"
};

const MENS_TEAMS = {
  afg: "Afghanistan", aus: "Australia", ban: "Bangladesh", eng: "England",
  ind: "India", ire: "Ireland", nz: "New Zealand", pak: "Pakistan",
  rsa: "South Africa", sl: "Sri Lanka", wi: "West Indies", zim: "Zimbabwe"
};

const CRICKET_TEAMS = { ...WOMENS_WORLD_CUP_TEAMS, ...MENS_TEAMS };
const WOMENS_CATEGORY = "Women's T20 World Cup";
const INDIA_CATEGORY = "Indian Men";
const ENG_NZ_CATEGORY = "Test Championship";

const INDIA_FUTURE_FIXTURES = [
  { id: "espn-eng-ind-2026-t20-1", matchNo: "1st T20I", teams: ["England", "India"], startISO: "2026-07-01T13:30:00.000Z", venue: "Riverside Ground, Chester-le-Street", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" },
  { id: "espn-eng-ind-2026-t20-2", matchNo: "2nd T20I", teams: ["England", "India"], startISO: "2026-07-04T13:30:00.000Z", venue: "Old Trafford, Manchester", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" },
  { id: "espn-eng-ind-2026-t20-3", matchNo: "3rd T20I", teams: ["England", "India"], startISO: "2026-07-07T13:30:00.000Z", venue: "Trent Bridge, Nottingham", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" },
  { id: "espn-eng-ind-2026-t20-4", matchNo: "4th T20I", teams: ["England", "India"], startISO: "2026-07-09T13:30:00.000Z", venue: "County Ground, Bristol", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" },
  { id: "espn-eng-ind-2026-t20-5", matchNo: "5th T20I", teams: ["England", "India"], startISO: "2026-07-11T13:30:00.000Z", venue: "Rose Bowl, Southampton", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" },
  { id: "espn-eng-ind-2026-odi-1", matchNo: "1st ODI", teams: ["England", "India"], startISO: "2026-07-14T13:30:00.000Z", venue: "Edgbaston, Birmingham", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" },
  { id: "espn-eng-ind-2026-odi-2", matchNo: "2nd ODI", teams: ["England", "India"], startISO: "2026-07-16T13:30:00.000Z", venue: "Sophia Gardens, Cardiff", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" },
  { id: "espn-eng-ind-2026-odi-3", matchNo: "3rd ODI", teams: ["England", "India"], startISO: "2026-07-19T13:30:00.000Z", venue: "Lord's, London", url: "https://www.espncricinfo.com/series/india-in-england-2026-1496488/match-schedule-fixtures-and-results" }
];

const INDIA_RESULT_FIXTURES = [
  {
    id: "eng-ind-2026-t20-1-result",
    matchNo: "1st T20I",
    teams: ["England", "India"],
    startISO: "2026-07-01T13:30:00.000Z",
    venue: "Riverside Ground, Chester-le-Street",
    url: "https://www.cricbuzz.com/live-cricket-scores/129392/ind-vs-eng-1st-t20i-india-tour-of-england-2026",
    state: "Finished",
    status: "No result - match abandoned due to rain",
    score: "IND 189/7 (20 ov) | ENG did not bat",
    scores: [
      { team: "IND", score: "189/7", overs: "20" }
    ],
    playerOfMatch: ""
  }
];

const TEST_CHAMPIONSHIP_FIXTURES = [
  {
    id: "wtc-eng-nz-2026-3",
    matchNo: "3rd Test",
    teams: ["England", "New Zealand"],
    startISO: "2026-06-25T10:00:00.000Z",
    endISO: "2026-06-29T17:00:00.000Z",
    venue: "Trent Bridge, Nottingham"
  },
  {
    id: "wtc-wi-sl-2026-1",
    matchNo: "1st Test",
    teams: ["West Indies", "Sri Lanka"],
    startISO: "2026-06-25T14:00:00.000Z",
    endISO: "2026-06-29T21:00:00.000Z",
    venue: "Sir Vivian Richards Stadium, North Sound, Antigua"
  },
  {
    id: "wtc-wi-sl-2026-2",
    matchNo: "2nd Test",
    teams: ["West Indies", "Sri Lanka"],
    startISO: "2026-07-03T14:00:00.000Z",
    endISO: "2026-07-07T21:00:00.000Z",
    venue: "Sir Vivian Richards Stadium, North Sound, Antigua"
  }
];

const TEST_RESULT_FIXTURES = [
  {
    id: "wtc-eng-nz-2026-3-result",
    matchNo: "3rd Test",
    teams: ["England", "New Zealand"],
    startISO: "2026-06-25T10:00:00.000Z",
    venue: "Trent Bridge, Nottingham",
    state: "Finished",
    status: "New Zealand won by 160 runs",
    score: "NZ 438 & 288/9d | ENG 354 & 212",
    scores: [
      { team: "NZ", score: "438 & 288/9d", overs: "114.5 & 94" },
      { team: "ENG", score: "354 & 212", overs: "88.2 & 51.2" }
    ],
    playerOfMatch: "Daryl Mitchell",
    endISO: "2026-06-29T17:00:00.000Z"
  }
];

const WOMENS_FUTURE_FIXTURES = [
  { id: "wwc-2026-19", matchNo: "19th Match - Group B", teams: ["New Zealand Women", "Scotland Women"], startISO: "2026-06-23T09:30:00.000Z", venue: "County Ground, Bristol" },
  { id: "wwc-2026-20", matchNo: "20th Match - Group B", teams: ["Ireland Women", "Sri Lanka Women"], startISO: "2026-06-23T13:30:00.000Z", venue: "England" },
  {
    id: "wwc-2026-23",
    matchNo: "23rd Match - Group A",
    teams: ["India Women", "Bangladesh Women"],
    startISO: "2026-06-25T13:30:00.000Z",
    venue: "Emirates Old Trafford, Manchester",
    url: "https://www.cricbuzz.com/live-cricket-scores/121961/indw-vs-banw-23rd-match-group-a-icc-womens-t20-world-cup-2026"
  },
  {
    id: "wwc-2026-26",
    matchNo: "26th Match - Group A",
    teams: ["Pakistan Women", "Netherlands Women"],
    startISO: "2026-06-27T09:30:00.000Z",
    venue: "County Ground, Bristol",
    url: "https://www.cricbuzz.com/live-cricket-scores/121978/pakw-vs-nedw-26th-match-group-a-icc-womens-t20-world-cup-2026"
  },
  {
    id: "wwc-2026-27",
    matchNo: "27th Match - Group B",
    teams: ["West Indies Women", "Ireland Women"],
    startISO: "2026-06-27T13:30:00.000Z",
    venue: "County Ground, Bristol",
    url: "https://www.cricbuzz.com/live-cricket-scores/121983/wiw-vs-irew-27th-match-group-b-icc-womens-t20-world-cup-2026"
  },
  {
    id: "wwc-2026-28",
    matchNo: "28th Match - Group B",
    teams: ["England Women", "New Zealand Women"],
    startISO: "2026-06-27T17:30:00.000Z",
    venue: "Kennington Oval, London",
    url: "https://www.cricbuzz.com/live-cricket-scores/121994/engw-vs-nzw-28th-match-group-b-icc-womens-t20-world-cup-2026"
  },
  {
    id: "wwc-2026-29",
    matchNo: "29th Match - Group A",
    teams: ["South Africa Women", "Bangladesh Women"],
    startISO: "2026-06-28T09:30:00.000Z",
    venue: "Lord's, London",
    url: "https://www.cricbuzz.com/live-cricket-scores/122005/rsaw-vs-banw-29th-match-group-a-icc-womens-t20-world-cup-2026"
  },
  {
    id: "wwc-2026-30",
    matchNo: "30th Match - Group A",
    teams: ["Australia Women", "India Women"],
    startISO: "2026-06-28T13:30:00.000Z",
    venue: "Lord's, London",
    url: "https://www.cricbuzz.com/live-cricket-scores/122011/ausw-vs-indw-30th-match-group-a-icc-womens-t20-world-cup-2026"
  },
  {
    id: "wwc-2026-32",
    matchNo: "32nd Match - 2nd Semi-final",
    teams: ["England Women", "South Africa Women"],
    startISO: "2026-07-02T13:30:00.000Z",
    venue: "Kennington Oval, London"
  },
  {
    id: "wwc-2026-33",
    matchNo: "33rd Match - Final",
    teams: ["Australia Women", "England Women"],
    startISO: "2026-07-05T13:30:00.000Z",
    venue: "Lord's, London"
  }
];

function scheduledFixtureState(fixture, now = Date.now()) {
  const start = Date.parse(fixture.startISO || "");
  if (!Number.isFinite(start)) return "Upcoming";
  if (start > now) return "Upcoming";

  const text = `${fixture.matchNo || ""} ${fixture.url || ""}`.toLowerCase();
  const matchHours = text.includes("odi") ? 9 : text.includes("test") ? 120 : 5;
  return now - start <= matchHours * 60 * 60 * 1000 ? "Live" : "Finished";
}

function fixtureStartLabel(fixture) {
  const start = new Date(fixture.startISO || "");
  if (!Number.isFinite(start.getTime())) return "time TBA";
  return start.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }) + " IST";
}

function scheduledFixtureStatus(fixture, state) {
  if (state === "Upcoming") {
    return fixture.venue ? `Starts ${fixtureStartLabel(fixture)} - ${fixture.venue}` : `Starts ${fixtureStartLabel(fixture)}`;
  }
  if (state === "Live") return "Match in progress - live score pending";
  return "Result pending update";
}

function scheduledFixtureScore(state) {
  if (state === "Upcoming") return "Match not started";
  if (state === "Live") return "Live score pending";
  return "Result pending update";
}

function scheduleFixtureToMatch(fixture, category) {
  const state = scheduledFixtureState(fixture);
  return {
    ...fixture,
    name: `${fixture.teams[0]} vs ${fixture.teams[1]}`,
    category,
    state,
    status: scheduledFixtureStatus(fixture, state),
    source: state === "Upcoming" ? "Local schedule copy" : "Local schedule pending result",
    score: scheduledFixtureScore(state),
    scores: [],
    playerOfMatch: "",
    liveDetails: { venue: fixture.venue || "" },
    liveScorecard: null,
    rawText: ""
  };
}

function hasSameScheduledMatch(matches, fixture, category) {
  return matches.some(match => {
    if (match.category !== category) return false;
    const sameTeams = [...(match.teams || [])].sort().join("|") === [...fixture.teams].sort().join("|");
    const sameDate = match.startISO && fixture.startISO && match.startISO.slice(0, 10) === fixture.startISO.slice(0, 10);
    return sameTeams && sameDate;
  });
}

const WOMENS_RESULT_FIXTURES = [
  {
    id: "wwc-2026-24-result",
    matchNo: "24th Match - Group A",
    teams: ["South Africa Women", "Netherlands Women"],
    startISO: "2026-06-25T17:30:00.000Z",
    venue: "County Ground, Bristol",
    url: "https://www.cricbuzz.com/live-cricket-scores/121967/rsaw-vs-nedw-24th-match-group-a-icc-womens-t20-world-cup-2026",
    state: "Finished",
    status: "South Africa Women won by 88 runs",
    score: "RSAW 208/1 (20 ov) | NEDW 120/8 (20 ov)",
    scores: [
      { team: "RSAW", score: "208/1", overs: "20" },
      { team: "NEDW", score: "120/8", overs: "20" }
    ],
    playerOfMatch: "Tazmin Brits"
  },
  {
    id: "wwc-2026-25-result",
    matchNo: "25th Match - Group B",
    teams: ["Scotland Women", "Sri Lanka Women"],
    startISO: "2026-06-25T17:30:00.000Z",
    venue: "England",
    url: "https://www.cricbuzz.com/live-cricket-scores/121972/scow-vs-slw-25th-match-group-b-icc-womens-t20-world-cup-2026",
    state: "Finished",
    status: "Sri Lanka Women won by 3 wickets",
    score: "Score not available",
    scores: [],
    playerOfMatch: ""
  },
  {
    id: "wwc-2026-26-result",
    matchNo: "26th Match - Group A",
    teams: ["Pakistan Women", "Netherlands Women"],
    startISO: "2026-06-27T09:30:00.000Z",
    venue: "County Ground, Bristol",
    url: "https://www.cricbuzz.com/live-cricket-scores/121978/pakw-vs-nedw-26th-match-group-a-icc-womens-t20-world-cup-2026",
    state: "Finished",
    status: "Pakistan Women won by 37 runs",
    score: "Score not available",
    scores: [],
    playerOfMatch: ""
  },
  {
    id: "wwc-2026-27-result",
    matchNo: "27th Match - Group B",
    teams: ["West Indies Women", "Ireland Women"],
    startISO: "2026-06-27T13:30:00.000Z",
    venue: "County Ground, Bristol",
    url: "https://www.cricbuzz.com/live-cricket-scores/121983/wiw-vs-irew-27th-match-group-b-icc-womens-t20-world-cup-2026",
    state: "Finished",
    status: "Ireland Women won by 6 wickets",
    score: "Score not available",
    scores: [],
    playerOfMatch: ""
  },
  {
    id: "wwc-2026-28-result",
    matchNo: "28th Match - Group B",
    teams: ["New Zealand Women", "England Women"],
    startISO: "2026-06-27T17:30:00.000Z",
    venue: "Kennington Oval, London",
    url: "https://www.cricbuzz.com/live-cricket-scores/121994/engw-vs-nzw-28th-match-group-b-icc-womens-t20-world-cup-2026",
    state: "Finished",
    status: "England Women won by 9 wickets",
    score: "NZW 163/6 (20 ov) | ENGW 164/1 (17.2 ov)",
    scores: [
      { team: "NZW", score: "163/6", overs: "20" },
      { team: "ENGW", score: "164/1", overs: "17.2" }
    ],
    playerOfMatch: "Danni Wyatt-Hodge"
  },
  {
    id: "wwc-2026-31-result",
    matchNo: "31st Match - 1st Semi-final",
    teams: ["Australia Women", "West Indies Women"],
    startISO: "2026-06-30T13:30:00.000Z",
    venue: "Kennington Oval, London",
    state: "Finished",
    status: "Australia Women won by 8 wickets",
    score: "WIW 125/7 (20 ov) | AUSW 126/2 (17.4 ov)",
    scores: [
      { team: "WIW", score: "125/7", overs: "20" },
      { team: "AUSW", score: "126/2", overs: "17.4" }
    ],
    playerOfMatch: "Beth Mooney"
  },
  {
    id: "wwc-2026-32-result",
    matchNo: "32nd Match - 2nd Semi-final",
    teams: ["England Women", "South Africa Women"],
    startISO: "2026-07-02T13:30:00.000Z",
    venue: "Kennington Oval, London",
    state: "Finished",
    status: "England Women won by 40 runs",
    score: "ENGW 169/5 (20 ov) | RSAW 129/8 (20 ov)",
    scores: [
      { team: "ENGW", score: "169/5", overs: "20" },
      { team: "RSAW", score: "129/8", overs: "20" }
    ],
    playerOfMatch: "Nat Sciver-Brunt"
  }
];

const TEAM_SHORT = {
  "Australia Women": "AUSW", "Bangladesh Women": "BANW",
  "England Women": "ENGW", "India Women": "INDW", "Ireland Women": "IREW",
  "New Zealand Women": "NZW", "Netherlands Women": "NEDW",
  "Pakistan Women": "PAKW", "Scotland Women": "SCOW",
  "South Africa Women": "RSAW", "Sri Lanka Women": "SLW",
  "West Indies Women": "WIW"
  ,"Afghanistan": "AFG", "Australia": "AUS", "Bangladesh": "BAN",
  "England": "ENG", "India": "IND", "Ireland": "IRE", "New Zealand": "NZ",
  "Pakistan": "PAK", "South Africa": "RSA", "Sri Lanka": "SL",
  "West Indies": "WI", "Zimbabwe": "ZIM"
};

const ALL_SHORTS = Object.values(TEAM_SHORT);

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPlayersOfMatch(html) {
  const source = String(html || "").replace(/\\"/g, '"');
  const names = [];
  for (const section of source.matchAll(/"playersOfTheMatch"\s*:\s*\[(.*?)\]/gis)) {
    for (const player of section[1].matchAll(/"name"\s*:\s*"([^"]+)"/gi)) {
      names.push(clean(player[1]));
    }
  }
  if (!names.length) {
    const profile = source.match(/PLAYER OF THE MATCH[\s\S]{0,600}?title="View Profile Of ([^"]+)"/i);
    if (profile) names.push(clean(profile[1]));
  }
  return [...new Set(names.filter(Boolean))].join(" & ");
}

function oversToDecimal(oversText) {
  const text = clean(oversText).replace(/ov/i, "").replace(/[()]/g, "").trim();

  if (!text) return null;

  const parts = text.split(".");
  const overs = parseInt(parts[0] || "0", 10);
  const balls = parts.length > 1 ? parseInt(parts[1] || "0", 10) : 0;

  if (Number.isNaN(overs) || Number.isNaN(balls)) return null;

  return overs + balls / 6;
}

function normalizeOversText(oversText) {
  const text = clean(oversText);
  if (!text) return "";
  const [wholeText, ballsText = "0"] = text.split(".");
  let whole = parseInt(wholeText, 10);
  let balls = parseInt(ballsText, 10);
  if (Number.isNaN(whole) || Number.isNaN(balls)) return text;
  whole += Math.floor(balls / 6);
  balls %= 6;
  return balls ? `${whole}.${balls}` : String(whole);
}

function calculateRR(scoreText, oversText) {
  const runsMatch = clean(scoreText).match(/(\d+)/);
  const runs = runsMatch ? parseInt(runsMatch[1], 10) : null;
  const overs = oversToDecimal(oversText);

  if (runs === null || !overs || overs <= 0) return "";

  return (runs / overs).toFixed(2);
}

function inferCompletedResult(teams, scores) {
  const rows = (teams || []).map(team => {
    const short = getTeamShort(team);
    const score = (scores || []).find(row => clean(row.team).toUpperCase() === short);
    const runs = parseInt(String(score?.score || "").match(/\d+/)?.[0] || "NaN", 10);
    const wickets = parseInt(String(score?.score || "").match(/\/(\d+)/)?.[1] || "0", 10);
    return { team, score, runs, wickets, overs: oversToDecimal(score?.overs) };
  }).filter(row => Number.isFinite(row.runs));

  if (rows.length < 2) return "Match complete";
  if (rows[0].runs === rows[1].runs) return "Match tied";

  const winner = rows[0].runs > rows[1].runs ? rows[0] : rows[1];
  const loser = winner === rows[0] ? rows[1] : rows[0];
  const likelyChase = Number.isFinite(winner.overs) && winner.overs < 20 &&
    Number.isFinite(loser.overs) && loser.overs >= 20;

  return likelyChase
    ? `${winner.team} won by ${Math.max(10 - winner.wickets, 0)} wickets`
    : `${winner.team} won by ${winner.runs - loser.runs} ${winner.runs - loser.runs === 1 ? "run" : "runs"}`;
}

function extractOwnResult(text, teams) {
  const source = clean(text);
  const shorts = (teams || []).map(getTeamShort).filter(Boolean);
  const escapedShorts = shorts.map(short => short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (
    escapedShorts.length >= 2 &&
    (
      new RegExp(`\\b${escapedShorts[0]}\\s+vs\\s+${escapedShorts[1]}\\s+-\\s+(?:Draw|Match drawn)\\b`, "i").test(source) ||
      new RegExp(`\\b${escapedShorts[1]}\\s+vs\\s+${escapedShorts[0]}\\s+-\\s+(?:Draw|Match drawn)\\b`, "i").test(source)
    )
  ) {
    return "Match drawn";
  }
  for (const team of teams) {
    const escaped = team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(
      new RegExp(`${escaped}\\s+won\\s+by\\s+(\\d+)\\s+(runs?|wkts?|wickets?)`, "i")
    );
    if (match) {
      const margin = Number(match[1]);
      const unit = /wkt|wicket/i.test(match[2])
        ? margin === 1 ? "wicket" : "wickets"
        : margin === 1 ? "run" : "runs";
      return `${team} won by ${margin} ${unit}`;
    }
  }
  return "";
}

function deriveT20ChaseStatus(scores) {
  if (!Array.isArray(scores) || scores.length < 2) return "";
  const rows = scores.map(score => ({
    score,
    runs: parseInt(String(score.score).match(/\d+/)?.[0] || "NaN", 10),
    balls: (() => {
      const [overs, balls = "0"] = String(score.overs || "").split(".");
      return Number(overs) * 6 + Number(balls);
    })()
  }));
  const first = rows.find(row => row.balls === 120);
  const chase = rows.find(row => row !== first && row.balls < 120);
  if (!first || !chase || !Number.isFinite(first.runs) || !Number.isFinite(chase.runs)) return "";
  const needed = Math.max(first.runs + 1 - chase.runs, 0);
  const ballsLeft = Math.max(120 - chase.balls, 0);
  return needed > 0 ? `Need ${needed} off ${ballsLeft}b` : `${chase.score.team} won`;
}

function deriveTestLeadStatus(scores) {
  if (!Array.isArray(scores) || scores.length < 2) return "";
  const totals = scores.map(score => ({
    team: score.team,
    total: String(score.score || "").split("&")
      .map(part => parseInt(part.match(/\d+/)?.[0] || "0", 10))
      .reduce((sum, runs) => sum + runs, 0)
  }));
  totals.sort((a, b) => b.total - a.total);
  const lead = totals[0].total - totals[1].total;
  return lead > 0 ? `${totals[0].team} lead by ${lead}` : "Scores level";
}

function deriveTestContext(scores, teams) {
  if (!Array.isArray(scores) || scores.length < 2) return null;
  const rows = scores.map(score => {
    const parts = String(score.score || "").split("&").map(part => part.trim());
    return {
      score,
      parts,
      runs: parts.map(part => parseInt(part.match(/\d+/)?.[0] || "0", 10)),
      wickets: parts.map(part => parseInt(part.match(/\/(\d+)/)?.[1] || "10", 10))
    };
  });
  if (!rows.every(row => row.parts.length >= 2)) return null;
  const chasing = rows.find(row => row.wickets[1] < 10) || rows[1];
  const defending = rows.find(row => row !== chasing);
  const target = defending.runs.reduce((sum, value) => sum + value, 0) - chasing.runs[0] + 1;
  const needed = Math.max(target - chasing.runs[1], 0);
  const wicketsLeft = Math.max(10 - chasing.wickets[1], 0);
  const fullTeam = teams.find(team => getTeamShort(team) === chasing.score.team) || chasing.score.team;
  chasing.score.isCurrent = true;
  return {
    battingTeam: chasing.score.team,
    target,
    needed,
    wicketsLeft,
    status: `${fullTeam} need ${needed} runs to win`
  };
}

function extractJsonObjectAfter(source, marker, fromIndex = 0) {
  const markerIndex = source.indexOf(marker, Math.max(0, fromIndex));
  if (markerIndex < 0) return null;
  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) {
      try { return JSON.parse(source.slice(start, index + 1)); }
      catch { return null; }
    }
  }
  return null;
}

function extractEmbeddedMatchData(html, url) {
  const id = String(getMatchId(url));
  const source = String(html).replace(/\\"/g, '"');
  const idIndex = source.indexOf(`"matchId":${id}`);
  if (idIndex < 0) return null;
  const infoMarker = source.lastIndexOf('"matchInfo":', idIndex);
  const matchInfo = extractJsonObjectAfter(source, '"matchInfo":', infoMarker);
  const matchScore = extractJsonObjectAfter(source, '"matchScore":', idIndex);
  return matchInfo && matchScore ? { matchInfo, matchScore } : null;
}

function structuredTestScores(embedded) {
  const { matchInfo, matchScore } = embedded;
  return [
    [matchInfo.team1, matchScore.team1Score],
    [matchInfo.team2, matchScore.team2Score]
  ].map(([team, score]) => {
    const innings = [score?.inngs1, score?.inngs2].filter(Boolean);
    if (!innings.length) return null;
    const parts = innings.map(item => `${item.runs}${item.wickets < 10 ? `/${item.wickets || 0}` : ""}`);
    const latest = innings[innings.length - 1];
    const isCurrent = team.teamId === matchInfo.currBatTeamId;
    const normalizedOvers = normalizeOversText(latest.overs);
    return {
      team: team.teamSName,
      score: parts.join(" & "),
      overs: isCurrent ? normalizedOvers : "",
      rr: isCurrent ? calculateRR(String(latest.runs), normalizedOvers) : "",
      isCurrent,
      innings,
      raw: parts.join(" & ")
    };
  }).filter(Boolean);
}



function isValidScoreCandidate(runs, wickets, overs) {
  const r = parseInt(runs, 10);
  const w = parseInt(wickets, 10);
  const o = oversToDecimal(overs);

  if (Number.isNaN(r) || Number.isNaN(w)) return false;
  if (w < 0 || w > 10) return false;
  if (overs && (o === null || o < 0 || o > 300)) return false;

  return true;
}

function getMatchId(url) {
  const parts = String(url || "").split("/").filter(Boolean);
  return parts.find(part => /^\d+$/.test(part)) || url;
}

function getSlug(url) {
  const parts = String(url || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function parseTeams(slug) {
  const lower = String(slug || "").toLowerCase();
  const match = lower.match(/^([a-z]+)-vs-([a-z]+)/);

  if (!match) return [];

  const first = CRICKET_TEAMS[match[1]];
  const second = CRICKET_TEAMS[match[2]];

  return [first, second].filter(Boolean);
}

function getTeamShort(teamName) {
  return TEAM_SHORT[teamName] || clean(teamName).toUpperCase();
}

function getMatchCategory(slug, teams) {
  const lower = String(slug || "").toLowerCase();
  if (teams.length !== 2) return "";
  if (lower.includes("women") && lower.includes("world-cup")) return WOMENS_CATEGORY;
  if (teams.includes("India")) return INDIA_CATEGORY;
  if (/\btest\b/i.test(lower) && !lower.includes("women")) return ENG_NZ_CATEGORY;
  return "";
}

function getMatchName(teams, slug) {
  if (teams.length >= 2) return `${teams[0]} vs ${teams[1]}`;

  return slug
    .replace(/-\d+(st|nd|rd|th)-match.*/i, "")
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function fetchHtml(url, timeout = 8000) {
  const finalUrl = `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`;

  const response = await axios.get(finalUrl, {
    timeout,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.cricbuzz.com/",
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  });

  return response.data;
}

function extractStatus(titleText, detailText) {
  const title = clean(titleText);
  const detail = clean(detailText);

  const titleParts = title.split(" - ");
  const titleStatus = titleParts.length >= 2
    ? clean(titleParts.slice(1).join(" - "))
    : "";

  if (titleStatus && !/^(complete|completed)$/i.test(titleStatus)) {
    return titleStatus;
  }

  const usefulPatterns = [
    /[A-Z]{2,5}\s+opt to bat/i,
    /[A-Z]{2,5}\s+opt to bowl/i,
    /[A-Z]{2,5}\s+chose to bat/i,
    /[A-Z]{2,5}\s+chose to bowl/i,
    /[A-Z]{2,5}\s+elected to bat/i,
    /[A-Z]{2,5}\s+elected to bowl/i,
    /[A-Za-z ]+\s+need\s+\d+\s+runs?\s+in\s+\d+\s+balls?/i,
    /Need\s+\d+\s+off\s+\d+b/i,
    /[A-Za-z ]+\s+won\s+by\s+\d+\s+(?:runs?|wkts?|wickets?)/i,
    /[A-Z]{2,5}\s+won/i,
    /Match starts[^.]+/i,
    /Preview/i
  ];

  for (const pattern of usefulPatterns) {
    const titleMatch = title.match(pattern);
    if (titleMatch) return clean(titleMatch[0]);

    const detailMatch = detail.match(pattern);
    if (detailMatch) return clean(detailMatch[0]);
  }

  if (titleStatus) return titleStatus;

  if (/preview/i.test(title)) return "Preview";
  if (/won/i.test(title)) return title;
  if (/need/i.test(title)) return title;

  return clean(detail || title || "Situation not available").slice(0, 180);
}

function classifyState(status) {
  const text = clean(status).toLowerCase();

  if (
    text.includes("won") ||
    text.includes("draw") ||
    text === "complete" ||
    text.includes("completed") ||
    text.includes("no result") ||
    text.includes("abandoned")
  ) {
    return "Finished";
  }

  if (
    text.includes("preview") ||
    text.includes("match starts") ||
    text.includes("starts soon") ||
    text.includes("yet to begin")
  ) {
    return "Upcoming";
  }

  if (
    text.includes("need") ||
    text.includes("innings break") ||
    text.includes("opt to") ||
    text.includes("chose to") ||
    text.includes("elected to") ||
    text.includes("drinks") ||
    text.includes("strategic timeout") ||
    text.includes("stump") ||
    text.includes("lead by") ||
    text.includes("trail by") ||
    text.includes("lunch") ||
    text.includes("tea")
  ) {
    return "Live";
  }

  return "Unknown";
}

function extractStartISO(text) {
  const source = clean(text);
  const dated = source.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}[^\d]{0,20}(\d{1,2}:\d{2})\s*GMT/i);
  if (!dated) return "";

  const datePart = source.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i)?.[0];
  const parsed = datePart ? Date.parse(`${datePart} ${dated[1]} GMT`) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function extractStructuredText($) {
  const selectors = [
    ".cb-text-live",
    ".cb-text-complete",
    ".cb-text-preview",
    ".cb-min-inf",
    ".cb-min-bat-rw",
    ".cb-font-20",
    ".cb-font-16",
    ".cb-col",
    ".cb-scrd-itms",
    ".cbz-ui-status",
    ".cbz-ui-home-team",
    ".cbz-ui-away-team",
    ".cb-scrd-hdr-rw"
  ];

  const parts = [];

  for (const selector of selectors) {
    $(selector).each((index, element) => {
      const text = clean($(element).text());

      if (text && text.length <= 900 && !parts.includes(text)) {
        parts.push(text);
      }
    });
  }

  return clean(parts.join(" "));
}

function chooseBestScores(scores) {
  const byTeam = new Map();

  for (const score of scores || []) {
    if (!score.team || !score.score) continue;

    const key = clean(score.team).toUpperCase();
    const existing = byTeam.get(key);

    if (!existing) {
      byTeam.set(key, score);
      continue;
    }

    const currentHasOvers = Boolean(score.overs);
    const existingHasOvers = Boolean(existing.overs);
    const currentHasRR = Boolean(score.rr);
    const existingHasRR = Boolean(existing.rr);

    if (!existingHasOvers && currentHasOvers) {
      byTeam.set(key, score);
      continue;
    }

    if (!existingHasRR && currentHasRR) {
      byTeam.set(key, score);
      continue;
    }

    const currentRuns = parseInt(String(score.score).match(/\d+/)?.[0] || "0", 10);
    const existingRuns = parseInt(String(existing.score).match(/\d+/)?.[0] || "0", 10);

    if (currentRuns >= existingRuns && (currentHasOvers || currentHasRR)) {
      byTeam.set(key, score);
    }
  }

  return Array.from(byTeam.values());
}

function extractCrr(text) {
  const match = clean(text).match(/\bCRR[:\s]*([\d.]+)/i);
  return match ? match[1] : "";
}

function extractScoresFromText(text, teams) {
  const source = clean(text);
  const scores = [];
  const crr = extractCrr(source);

  const knownShorts = teams.map(team => TEAM_SHORT[team]).filter(Boolean);
  const shorts = Array.from(new Set([...knownShorts, ...ALL_SHORTS]));

  for (const short of shorts) {
    const patterns = [
      new RegExp(`\\b${short}\\s+(\\d{1,3})\\s*[-/]\\s*(\\d{1,2})\\s*\\((\\d{1,3}(?:\\.\\d)?)(?:\\/20)?\\)`, "gi"),
      new RegExp(`\\b${short}\\s+(\\d{1,3})\\s*\\/\\s*(\\d{1,2})\\s*\\((\\d{1,3}(?:\\.\\d)?)(?:\\/20)?\\s*ov\\)`, "gi"),
      new RegExp(`\\b${short}\\s+(\\d{1,3})\\s*\\/\\s*(\\d{1,2})`, "gi"),
      new RegExp(`\\b${short}\\s+(\\d{1,3})\\s*-\\s*(\\d{1,2})`, "gi")
    ];

    for (const regex of patterns) {
      let match;

      while ((match = regex.exec(source)) !== null) {
        const runs = match[1];
        const wickets = match[2];
        const overs = match[3] || "";
if (!isValidScoreCandidate(runs, wickets, overs)) continue;

const score = `${runs}/${wickets}`;

scores.push({
          team: short,
          score,
          overs,
          rr: overs ? calculateRR(score, overs) : crr,
          raw: clean(match[0])
        });
      }
    }
  }

  return chooseBestScores(scores);
}

function extractCompositeScores(text, teams) {
  const source = clean(text);
  const scores = [];

  for (const team of teams) {
    const short = getTeamShort(team);
    const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(
      new RegExp(`\\b${escaped}\\s+(\\d{1,3}(?:\\/\\d{1,2})?)(?:\\s*&\\s*(\\d{1,3}(?:\\/\\d{1,2})?))?`, "i")
    );
    if (!match) continue;

    scores.push({
      team: short,
      score: match[2] ? `${match[1]} & ${match[2]}` : match[1],
      overs: "",
      rr: "",
      raw: clean(match[0])
    });
  }

  return scores;
}

function scorecardUrlFromLiveUrl(url) {
  return String(url || "").replace("/live-cricket-scores/", "/live-cricket-scorecard/");
}

function normalizeScoreText(runs, wickets) {
  if (wickets === undefined || wickets === null || wickets === "") {
    return String(runs);
  }

  return `${runs}/${wickets}`;
}

function extractFullScorecardScores(text, teams) {
  const source = clean(text);
  const scores = [];

  for (const fullTeam of teams) {
    const shortTeam = getTeamShort(fullTeam);
    const escapedFull = fullTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedShort = shortTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
      new RegExp(`${escapedFull}\\s+(?:Innings)?\\s*(\\d{1,3})\\s*[-/]\\s*(\\d{1,2})\\s*\\((\\d{1,3}(?:\\.\\d)?)(?:\\/20)?\\s*Ov\\)`, "i"),
      new RegExp(`${escapedShort}\\s+(\\d{1,3})\\s*[-/]\\s*(\\d{1,2})\\s*\\((\\d{1,3}(?:\\.\\d)?)(?:\\/20)?\\s*Ov\\)`, "i"),
      new RegExp(`${escapedFull}[^\\d]{0,60}(\\d{1,3})\\s*[-/]\\s*(\\d{1,2})[^\\d]{0,20}(\\d{1,3}(?:\\.\\d)?)\\s*Ov`, "i"),
      new RegExp(`${escapedShort}[^\\d]{0,60}(\\d{1,3})\\s*[-/]\\s*(\\d{1,2})[^\\d]{0,20}(\\d{1,3}(?:\\.\\d)?)\\s*Ov`, "i")
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);

      if (match) {
        const runs = match[1];
        const wickets = match[2];
        const overs = match[3];
        const score = normalizeScoreText(runs, wickets);

        scores.push({
          team: shortTeam,
          score,
          overs,
          rr: calculateRR(score, overs),
          raw: clean(match[0])
        });

        break;
      }
    }
  }

  return chooseBestScores(scores);
}

async function fetchFinishedScorecardScores(url, teams) {
  const urlsToTry = [
    scorecardUrlFromLiveUrl(url),
    url
  ];

  for (const tryUrl of urlsToTry) {
    try {
      const html = await fetchHtml(tryUrl);
      const $ = cheerio.load(html);

      const structuredText = extractStructuredText($);
      const bodyText = clean($("body").text());
      const combined = clean(`${structuredText} ${bodyText}`);

      let scores = extractFullScorecardScores(combined, teams);

      if (scores.length < teams.length) {
        const fallbackScores = extractScoresFromText(combined, teams);
        scores = chooseBestScores([...scores, ...fallbackScores]);
      }

      if (scores.length) {
        return scores;
      }
    } catch {
      // Try next URL.
    }
  }

  return [];
}

function extractCurrentBatters(text) {
  const source = clean(text);
  const battingSegment = source.match(/Follow\s+[^|]*?\([^)]*\)\s+\(([^|]*?\d+\(\d+\)[^|]*?)\)\s*\|/i)?.[1]
    || source.slice(0, 260);
  const batters = [];
  const pattern = /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s+(\d+)\((\d+)\)/g;
  let match;

  while ((match = pattern.exec(battingSegment)) !== null) {
    batters.push({
      name: clean(match[1]),
      runs: Number(match[2]),
      balls: Number(match[3])
    });
  }

  return batters.slice(0, 2);
}

function parseLiveDetails(text, scores, teams = []) {
  const source = clean(text);

  const details = {
    toss: "",
    chase: "",
    rr: "",
    requiredRR: "",
    lastFive: "",
    battingTeam: "",
    target: "",
    simpleSituation: "",
    currentBatters: []
  };


  const teamPattern = ALL_SHORTS
    .map(short => short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const tossMatch = source.match(
    new RegExp(`\\b(?:${teamPattern})\\s+(?:opt|opts|chose|choose|elected|elects)\\s+to\\s+(?:bat|bowl)\\b`, "i")
  );

  const matchShorts = teams.map(getTeamShort);
  if (tossMatch && matchShorts.some(short => tossMatch[0].toUpperCase().startsWith(short))) {
    details.toss = clean(tossMatch[0]);
  }

  const crrMatch = source.match(/\bCRR[:\s]*([\d.]+)/i);
  if (crrMatch) details.rr = crrMatch[1];

  const reqMatch = source.match(/\bRequired RR[:\s]*([\d.]+)/i);
  if (reqMatch) details.requiredRR = reqMatch[1];

  const lastFiveMatch = source.match(/Last 5 overs?[:\s]+(\d+\s+runs?,?\s*\d*\s*wkts?)/i);
  if (lastFiveMatch) details.lastFive = clean(lastFiveMatch[1]);

  details.currentBatters = extractCurrentBatters(source);

  const chaseMatch = source.match(/([A-Za-z ]+)\s+need\s+(\d+)\s+runs?\s+in\s+(\d+)\s+balls?/i);
  const chaseTeamText = clean(chaseMatch?.[1]).toLowerCase();
  const chaseBelongsToMatch = teams.some(team => {
    const full = clean(team).toLowerCase();
    const short = getTeamShort(team).toLowerCase();
    return chaseTeamText.includes(full) || chaseTeamText.includes(short);
  });
  if (chaseMatch && chaseBelongsToMatch) {
    details.chase = `${clean(chaseMatch[1])} need ${chaseMatch[2]} runs in ${chaseMatch[3]} balls`;
    details.simpleSituation = details.chase;
  }

  if (scores.length) {
    const latestScore = scores[scores.length - 1];
    details.rr = latestScore.rr || calculateRR(latestScore.score, latestScore.overs);
  }

  if (!details.requiredRR && scores.length <= 1) {
    details.requiredRR = "First innings";
  }

  if (!details.simpleSituation && details.toss) {
    details.simpleSituation = details.toss;
  }

  if (!details.simpleSituation) {
    details.simpleSituation = source.slice(0, 180);
  }

  return details;
}

async function fetchMatchDetail(url, teams, stateHint) {
  try {
    let html = await fetchHtml(url, 18000);
    const $ = cheerio.load(html);
    const schemaStart = String(html).match(/"startDate"\s*:\s*"([^"]+)"/i)?.[1] || "";

    const structuredText = extractStructuredText($);
    const bodyText = clean($("body").text());
    const metaDescription = clean($("meta[name='description']").attr("content"));
    const combinedText = clean(`${metaDescription} ${structuredText} ${bodyText}`);
    let embedded = extractEmbeddedMatchData(html, url);
    if (!embedded && /(?:^|[-/])test(?:[-/]|$)/i.test(url)) {
      try {
        const scorecardHtml = await fetchHtml(scorecardUrlFromLiveUrl(url), 18000);
        embedded = extractEmbeddedMatchData(scorecardHtml, url);
      } catch {
        // Keep the text fallback when Cricbuzz withholds its structured scorecard.
      }
    }
    const structuredTest = embedded?.matchInfo?.matchFormat === "TEST";

    const regularScores = extractScoresFromText(combinedText, teams);
    const compositeScores = /(?:^|[-/])test(?:[-/]|$)/i.test(url)
      ? extractCompositeScores(combinedText, teams)
      : [];
    for (const composite of compositeScores) {
      const current = regularScores.find(score => score.team === composite.team && score.overs);
      if (!current) continue;
      composite.overs = current.overs;
      const currentInnings = String(composite.score).split("&").pop().trim();
      composite.rr = calculateRR(currentInnings, current.overs);
    }
    let scores = chooseBestScores([
      ...compositeScores,
      ...regularScores
    ]);
    if (structuredTest) scores = structuredTestScores(embedded);

    if (stateHint === "Finished" || combinedText.toLowerCase().includes("won")) {
      const finishedScores = await fetchFinishedScorecardScores(url, teams);

      if (finishedScores.length) {
        scores = chooseBestScores([...scores, ...finishedScores]);
      }
    }

    const liveDetails = parseLiveDetails(combinedText, scores, teams);
    if (structuredTest) {
      const current = scores.find(score => score.isCurrent);
      const wickets = parseInt(current?.score?.split("&").pop().match(/\/(\d+)/)?.[1] || "0", 10);
      liveDetails.rr = bodyText.match(/\bCRR:?\s*([\d.]+)/i)?.[1] || current?.rr || "";
      liveDetails.battingTeam = current?.team || "";
      liveDetails.wicketsLeft = Math.max(10 - wickets, 0);
      liveDetails.oversLeftToday = bodyText.match(/Ovs Left:\s*([\d.]+)/i)?.[1] || "";
      liveDetails.daySession = clean(embedded.matchInfo.status).split(" - ")[0] || "";
      liveDetails.venue = [embedded.matchInfo.venueInfo?.ground, embedded.matchInfo.venueInfo?.city].filter(Boolean).join(", ");
    }
    const result = extractOwnResult(combinedText, teams);
    const playerOfMatch = extractPlayersOfMatch(html);

    return {
      detailText: structuredText,
      rawText: combinedText.slice(0, 2500),
      scores,
      liveDetails,
      result,
      playerOfMatch,
      structuredStatus: structuredTest ? clean(embedded.matchInfo.status) : "",
      endISO: structuredTest && Number.isFinite(Number(embedded.matchInfo.endDate))
        ? new Date(Number(embedded.matchInfo.endDate)).toISOString()
        : "",
      startISO: structuredTest && Number.isFinite(Number(embedded.matchInfo.startDate))
        ? new Date(Number(embedded.matchInfo.startDate)).toISOString()
        : schemaStart && Number.isFinite(Date.parse(schemaStart))
          ? new Date(schemaStart).toISOString()
          : ""
    };
  } catch {
    return {
      detailText: "",
      rawText: "",
      scores: [],
      liveDetails: {},
      result: "",
      playerOfMatch: "",
      structuredStatus: "",
      startISO: ""
    };
  }
}

async function scrapeWomensT20WorldCupBase() {
  const map = new Map();
  const listUrls = [
    "https://www.cricbuzz.com/cricket-match/live-scores",
    "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches",
    "https://www.cricbuzz.com/cricket-match/live-scores/upcoming-matches"
  ];

  for (const listUrl of listUrls) {
    let $, html;
    try {
      html = await fetchHtml(listUrl);
      $ = cheerio.load(html);
    } catch {
      continue;
    }

    $("a[href*='/live-cricket-scores/']").each((index, element) => {
      const link = $(element);
      const href = link.attr("href") || "";
      if (!href) return;

      const fullUrl = href.startsWith("http") ? href : `https://www.cricbuzz.com${href}`;
      const slug = getSlug(fullUrl);
      const teams = parseTeams(slug);
      const category = getMatchCategory(slug, teams);
      if (!category) return;

      const id = getMatchId(fullUrl);
      const titleText = clean(link.attr("title") || link.text());
      const titleState = classifyState(extractStatus(titleText, ""));
      const stateHint = titleState !== "Unknown"
        ? titleState
        : listUrl.includes("recent-matches")
          ? "Finished"
          : listUrl.includes("upcoming-matches")
            ? "Upcoming"
            : "";
      const embedded = extractEmbeddedMatchData(html, fullUrl);
      if (!map.has(id)) {
        map.set(id, { id, url: fullUrl, slug, teams, titleText, stateHint, category, embedded });
      } else if (stateHint && !map.get(id).stateHint) {
        map.get(id).stateHint = stateHint;
      }
    });
  }

  return Array.from(map.values());
}

async function scrapeWomensT20WorldCup() {
  const baseMatches = await scrapeWomensT20WorldCupBase();
  const categories = [WOMENS_CATEGORY, INDIA_CATEGORY, ENG_NZ_CATEGORY];
  const isEnglandNewZealandItem = item => {
    const teams = (item.teams || []).map(team => String(team || "").toLowerCase().replace(/\s+women$/, "").trim());
    return teams.includes("england") && teams.includes("new zealand");
  };
  const candidates = categories.flatMap(category => {
    const categoryMatches = baseMatches.filter(item => item.category === category);
    if (category === WOMENS_CATEGORY) {
      const numberOf = item => Number(String(item.slug).match(/(?:^|-)(\d{1,3})(?:st|nd|rd|th)-match/i)?.[1] || 0);
      const indiaWomenMatches = categoryMatches.filter(item => item.teams.includes("India Women"));
      const liveSort = (a, b) => (isEnglandNewZealandItem(a) ? 0 : 1) - (isEnglandNewZealandItem(b) ? 0 : 1) || numberOf(a) - numberOf(b);
      return [
        ...categoryMatches.filter(item => item.stateHint === "Live").sort(liveSort).slice(0, 3),
        ...categoryMatches.filter(item => !item.stateHint).sort((a, b) => numberOf(a) - numberOf(b)).slice(0, 3),
        ...categoryMatches.filter(item => item.stateHint === "Finished").sort((a, b) => numberOf(b) - numberOf(a)).slice(0, 2),
        ...categoryMatches.filter(item => item.stateHint === "Upcoming").sort((a, b) => numberOf(a) - numberOf(b)).slice(0, 3),
        ...indiaWomenMatches.filter(item => item.stateHint === "Finished").sort((a, b) => numberOf(b) - numberOf(a)).slice(0, 2),
        ...indiaWomenMatches.filter(item => item.stateHint === "Upcoming").sort((a, b) => numberOf(a) - numberOf(b)).slice(0, 1),
        ...indiaWomenMatches.filter(item => !item.stateHint).sort((a, b) => numberOf(a) - numberOf(b)).slice(0, 1)
      ];
    }
    const liveSort = (a, b) => (isEnglandNewZealandItem(a) ? 0 : 1) - (isEnglandNewZealandItem(b) ? 0 : 1);
    return [
      ...categoryMatches.filter(item => item.stateHint === "Live").sort(liveSort).slice(0, 3),
      ...categoryMatches.filter(item => !item.stateHint).slice(0, 3),
      ...categoryMatches.filter(item => item.stateHint === "Finished").slice(0, 2),
      ...categoryMatches.filter(item => item.stateHint === "Upcoming").slice(0, 2)
    ];
  }).filter((item, index, list) =>
    list.findIndex(other => String(other.id) === String(item.id)) === index
  );

  const matches = await Promise.all(candidates.map(async item => {
    const preliminaryStatus = extractStatus(item.titleText, "");
    const preliminaryState = classifyState(preliminaryStatus) === "Unknown"
      ? item.stateHint || "Unknown"
      : classifyState(preliminaryStatus);

    const detail = await fetchMatchDetail(item.url, item.teams, preliminaryState);

    const embeddedTest = item.category === ENG_NZ_CATEGORY && item.embedded?.matchInfo?.matchFormat === "TEST";
    if (embeddedTest) {
      const structuredScores = structuredTestScores(item.embedded);
      if (structuredScores.length) detail.scores = structuredScores;
      const current = structuredScores.find(score => score.isCurrent);
      const wickets = parseInt(current?.score?.split("&").pop().match(/\/(\d+)/)?.[1] || "0", 10);
      detail.liveDetails = {
        ...detail.liveDetails,
        rr: detail.liveDetails?.rr || current?.rr || "",
        battingTeam: current?.team || "",
        wicketsLeft: Math.max(10 - wickets, 0),
        daySession: clean(item.embedded.matchInfo.status).split(" - ")[0] || "",
        venue: [item.embedded.matchInfo.venueInfo?.ground, item.embedded.matchInfo.venueInfo?.city].filter(Boolean).join(", ")
      };
    }

    let status = detail.result || (embeddedTest ? clean(item.embedded.matchInfo.status) : detail.structuredStatus) || extractStatus(item.titleText, detail.detailText);
    let state = classifyState(status);
    if (state === "Unknown" && item.stateHint) state = item.stateHint;
    const embeddedStart = embeddedTest && Number.isFinite(Number(item.embedded.matchInfo.startDate))
      ? new Date(Number(item.embedded.matchInfo.startDate)).toISOString()
      : "";
    const startISO = detail.startISO || embeddedStart || extractStartISO(`${item.titleText} ${detail.detailText} ${detail.rawText}`);
    const futureStart = startISO && Date.parse(startISO) > Date.now() + 15 * 60 * 1000;
    if (futureStart && state === "Finished") {
      state = "Upcoming";
      status = /preview/i.test(`${item.titleText} ${detail.detailText}`) ? "Preview" : `Starts ${startISO.slice(0, 10)}`;
      detail.scores = [];
    }

    let finalScores = detail.scores;

    if (state === "Finished" && finalScores.length < item.teams.length) {
      const scorecardScores = await fetchFinishedScorecardScores(item.url, item.teams);
      finalScores = chooseBestScores([...finalScores, ...scorecardScores]);
    }

    if (state === "Finished" && !/(?:won|tied|draw|no result|abandoned)/i.test(status)) {
      status = inferCompletedResult(item.teams, finalScores);
    }

    if (state === "Live" && item.category === WOMENS_CATEGORY) {
      status = deriveT20ChaseStatus(finalScores) || status;
    }
    if (state === "Live" && item.category === ENG_NZ_CATEGORY && !embeddedTest && !detail.structuredStatus) {
      const testContext = deriveTestContext(finalScores, item.teams);
      if (testContext) {
        const atStumps = /stump/i.test(status);
        status = testContext.status;
        detail.liveDetails = {
          ...detail.liveDetails,
          battingTeam: testContext.battingTeam,
          target: testContext.target,
          wicketsLeft: testContext.wicketsLeft,
          daySession: atStumps ? "Stumps" : detail.liveDetails?.daySession || "Test Match"
        };
      } else {
        status = deriveTestLeadStatus(finalScores) || status;
      }
    }

    const matchScore =
      finalScores.length > 0
        ? finalScores
            .map(score => `${score.team} ${score.score}${score.overs ? ` (${score.overs} ov)` : ""}`)
            .join(" | ")
        : "Score not available";

    return {
      id: item.id,
      name: getMatchName(item.teams, item.slug),
      teams: item.teams,
      category: item.category,
      state,
      status,
      startISO,
      endISO: detail.endISO || "",
      url: item.url,
      source: "Cricbuzz",
      score: matchScore,
      scores: finalScores,
      playerOfMatch: detail.playerOfMatch || "",
      liveDetails: detail.liveDetails,
      liveScorecard: null,
      rawText: detail.rawText
    };
  }));

  const scheduledIndiaMatches = INDIA_FUTURE_FIXTURES
    .filter(fixture => !hasSameScheduledMatch(matches, fixture, INDIA_CATEGORY))
    .map(fixture => scheduleFixtureToMatch(fixture, INDIA_CATEGORY));

  const resultIndiaMatches = INDIA_RESULT_FIXTURES
    .map(fixture => ({
      ...fixture,
      name: `${fixture.teams[0]} vs ${fixture.teams[1]}`,
      category: INDIA_CATEGORY,
      source: "Local result copy",
      liveDetails: { venue: fixture.venue || "" },
      liveScorecard: null,
      rawText: fixture.status
    }));

  const scheduledTestMatches = TEST_CHAMPIONSHIP_FIXTURES
    .filter(fixture => Date.parse(fixture.startISO) > Date.now())
    .filter(fixture => !matches.some(match => {
      if (match.category !== ENG_NZ_CATEGORY) return false;
      const sameTeams = [...(match.teams || [])].sort().join("|") === [...fixture.teams].sort().join("|");
      const sameDate = match.startISO && match.startISO.slice(0, 10) === fixture.startISO.slice(0, 10);
      return sameTeams && sameDate;
    }))
    .map(fixture => ({
      ...fixture,
      name: `${fixture.teams[0]} vs ${fixture.teams[1]}`,
      category: ENG_NZ_CATEGORY,
      state: "Upcoming",
      status: `Starts ${fixture.startISO.slice(0, 10)} - ${fixture.venue}`,
      source: "Local schedule copy",
      score: "Match not started",
      scores: [],
      liveDetails: { venue: fixture.venue },
      liveScorecard: null,
      rawText: ""
    }));

  const resultTestMatches = TEST_RESULT_FIXTURES
    .map(fixture => ({
      ...fixture,
      name: `${fixture.teams[0]} vs ${fixture.teams[1]}`,
      category: ENG_NZ_CATEGORY,
      source: "Local verified result",
      liveDetails: { venue: fixture.venue },
      liveScorecard: null,
      rawText: fixture.status
    }));

  const scheduledWomensMatches = WOMENS_FUTURE_FIXTURES
    .filter(fixture => !hasSameScheduledMatch(matches, fixture, WOMENS_CATEGORY))
    .map(fixture => scheduleFixtureToMatch(fixture, WOMENS_CATEGORY));

  const resultWomensMatches = WOMENS_RESULT_FIXTURES
    .filter(fixture => !matches.some(match => {
      if (match.category !== WOMENS_CATEGORY) return false;
      const sameTeams = [...(match.teams || [])].sort().join("|") === [...fixture.teams].sort().join("|");
      const sameDate = match.startISO && match.startISO.slice(0, 10) === fixture.startISO.slice(0, 10);
      return sameTeams && sameDate;
    }))
    .map(fixture => ({
      ...fixture,
      name: `${fixture.teams[0]} vs ${fixture.teams[1]}`,
      category: WOMENS_CATEGORY,
      source: "Local result copy",
      liveDetails: { venue: fixture.venue },
      liveScorecard: null,
      rawText: fixture.status
    }));

  return dedupeDashboardMatches([...matches, ...scheduledIndiaMatches, ...resultIndiaMatches, ...scheduledTestMatches, ...resultTestMatches, ...scheduledWomensMatches, ...resultWomensMatches]).sort((a, b) => {
    const rank = { Live: 1, Upcoming: 2, Finished: 3, Unknown: 4 };
    return (rank[a.state] || 9) - (rank[b.state] || 9);
  });
}

function matchOrdinalFromText(match) {
  const text = `${match?.matchNo || ""} ${match?.url || ""} ${match?.rawText || ""} ${match?.name || ""}`;
  const found = String(text).match(/(\d+)(?:st|nd|rd|th)[-\s]*match/i)
    || String(text).match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+(?:t20i|odi|test|match)\b/i);
  const number = Number(found?.[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function fixtureFormatKey(match) {
  const text = `${match?.matchNo || ""} ${match?.url || ""} ${match?.name || ""}`.toLowerCase();
  if (/\bodi\b/.test(text)) return "odi";
  if (/\bt20i\b/.test(text)) return "t20i";
  if (/\btest\b/.test(text)) return "test";
  return "match";
}

function dedupeDashboardMatches(list) {
  const byKey = new Map();
  const stateRank = { Live: 4, Finished: 3, Upcoming: 2, Unknown: 1 };
  const scoreMatch = match => {
    const hasStart = Date.parse(match?.startISO || "") ? 1 : 0;
    const hasScore = Array.isArray(match?.scores) && match.scores.length ? 1 : 0;
    const source = String(match?.source || "");
    const isVerified = /local verified result/i.test(source) ? 1 : 0;
    const isPending = /local schedule pending result/i.test(source) ? 1 : 0;
    const isLocal = /local/i.test(source) ? 1 : 0;
    return (stateRank[match?.state] || 0) * 1000 + isVerified * 200 + hasStart * 100 + hasScore * 20 + isLocal - isPending * 50;
  };

  for (const match of list) {
    const teams = [...(match?.teams || [])].map(String).sort().join("|");
    if (!teams) continue;
    const ordinal = matchOrdinalFromText(match);
    const date = String(match?.startISO || "").slice(0, 10);
    const forceDateKey = /local (?:schedule pending result|result copy|verified result)/i.test(String(match?.source || ""))
      || match?.category === INDIA_CATEGORY
      || match?.category === ENG_NZ_CATEGORY;
    const stage = !forceDateKey && ordinal ? `${ordinal}-${fixtureFormatKey(match)}` : date || String(match?.id || match?.name || "");
    const key = `${match?.category || ""}|${teams}|${stage}`;
    const previous = byKey.get(key);
    if (!previous || scoreMatch(match) > scoreMatch(previous)) byKey.set(key, match);
  }

  return [...byKey.values()];
}

async function getCachedMatches() {
  const now = Date.now();
  if (matchCache.data && now - matchCache.fetchedAt < CACHE_TTL_MS) {
    return { data: matchCache.data, cached: true };
  }

  if (!matchFetchPromise) {
    matchFetchPromise = scrapeWomensT20WorldCup()
      .then(data => {
        matchCache = { data, fetchedAt: Date.now() };
        return data;
      })
      .finally(() => {
        matchFetchPromise = null;
      });
  }

  if (matchCache.data) {
    matchFetchPromise.catch(() => {});
    return { data: matchCache.data, cached: true, stale: true };
  }

  return { data: await matchFetchPromise, cached: false };
}

async function sendCricketDashboardMatches(res) {
  try {
    const { data, cached, stale } = await getCachedMatches();

    res.json({
      status: "success",
      fetchedAt: new Date().toISOString(),
      cached,
      stale: Boolean(stale),
      data,
      meta: {
        total: data.length,
        womensT20WorldCup: data.length,
        live: data.filter(match => match.state === "Live").length,
        upcoming: data.filter(match => match.state === "Upcoming").length,
        finished: data.filter(match => match.state === "Finished").length,
        unknown: data.filter(match => match.state === "Unknown").length
      }
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message || "Failed to fetch cricket dashboard matches"
    });
  }
}

app.get("/api/cricket-dashboard-matches", async (req, res) => {
  await sendCricketDashboardMatches(res);
});

app.get("/api/womens-t20-world-cup", async (req, res) => {
  await sendCricketDashboardMatches(res);
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Vipul AI Dashboard",
    port: PORT,
    routes: ["/api/cricket-dashboard-matches", "/api/health"]
  });
});

app.get("/", (req, res) => {
  res.redirect("/cricket-dashboard.html");
});

app.get("/womens-world-cup.html", (req, res) => {
  res.redirect("/cricket-dashboard.html");
});



app.get("/api/test-cricapi", async (req, res) => {
  try {
    const response = await axios.get("https://api.cricapi.com/v1/currentMatches", {
      params: {
        apikey: process.env.CRICAPI_KEY,
        offset: 0
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: error.response?.data || null
    });
  }
});




app.get("/api/test-entitysport", async (req, res) => {
  try {
    const response = await axios.get("https://restapi.entitysport.com/v2/matches/", {
      params: {
        token: process.env.ENTITYSPORT_TOKEN
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: error.response?.data || null
    });
  }
});



app.listen(PORT, () => {
  console.log(`Vipul AI Dashboard running at http://localhost:${PORT}`);
});

