const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || process.env.SPORTS_PORT || 3003;
const CACHE_TTL_MS = 20000;
let cache = { data: null, fetchedAt: 0 };
let fetchPromise = null;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: res => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
}));

const http = axios.create({
  timeout: 18000,
  headers: {
    "User-Agent": "Mozilla/5.0 VipulSportsDashboard/1.0",
    "Accept": "application/json,text/plain,*/*"
  }
});

const FOOTBALL_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const TENNIS_URLS = [
  "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard",
  "https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard"
];
const CRICKET_API_URLS = [
  process.env.CRICKET_DASHBOARD_API_URL,
  "http://localhost:3002/api/cricket-dashboard-matches",
  "https://womens-t20-world-cup-dashboard.onrender.com/api/cricket-dashboard-matches",
  "https://vipul-s-cricket-dashboard.onrender.com/api/cricket-dashboard-matches",
  "https://vipuls-cricket-dashboard.onrender.com/api/cricket-dashboard-matches",
  "https://vipul-cricket-dashboard.onrender.com/api/cricket-dashboard-matches",
  "https://cricket-dashboard.onrender.com/api/cricket-dashboard-matches"
].filter(Boolean);
const INDIA_CRICKET_FALLBACK = [
  {
    id: "eng-ind-2026-t20-1-result",
    category: "Indian Men",
    matchNo: "1st T20I",
    teams: ["England", "India"],
    startISO: "2026-07-01T13:30:00.000Z",
    venue: "Riverside Ground, Chester-le-Street",
    state: "Finished",
    status: "No result - match abandoned due to rain",
    score: "IND 189/7 (20 ov) | ENG did not bat",
    scores: [{ team: "IND", score: "189/7", overs: "20" }]
  },
  { id: "espn-eng-ind-2026-t20-2", category: "Indian Men", matchNo: "2nd T20I", teams: ["England", "India"], startISO: "2026-07-04T13:30:00.000Z", venue: "Old Trafford, Manchester" },
  { id: "espn-eng-ind-2026-t20-3", category: "Indian Men", matchNo: "3rd T20I", teams: ["England", "India"], startISO: "2026-07-07T13:30:00.000Z", venue: "Trent Bridge, Nottingham" },
  { id: "espn-eng-ind-2026-t20-4", category: "Indian Men", matchNo: "4th T20I", teams: ["England", "India"], startISO: "2026-07-09T13:30:00.000Z", venue: "County Ground, Bristol" },
  { id: "espn-eng-ind-2026-t20-5", category: "Indian Men", matchNo: "5th T20I", teams: ["England", "India"], startISO: "2026-07-11T13:30:00.000Z", venue: "Rose Bowl, Southampton" },
  { id: "espn-eng-ind-2026-odi-1", category: "Indian Men", matchNo: "1st ODI", teams: ["England", "India"], startISO: "2026-07-14T13:30:00.000Z", venue: "Edgbaston, Birmingham" },
  { id: "espn-eng-ind-2026-odi-2", category: "Indian Men", matchNo: "2nd ODI", teams: ["England", "India"], startISO: "2026-07-16T13:30:00.000Z", venue: "Sophia Gardens, Cardiff" },
  { id: "espn-eng-ind-2026-odi-3", category: "Indian Men", matchNo: "3rd ODI", teams: ["England", "India"], startISO: "2026-07-19T13:30:00.000Z", venue: "Lord's, London" },
  { id: "espn-zim-ind-2026-t20-1", category: "Indian Men", matchNo: "1st T20I", teams: ["Zimbabwe", "India"], startISO: "2026-07-23T12:00:00.000Z", venue: "Harare Sports Club, Harare", timeTBA: true },
  { id: "espn-zim-ind-2026-t20-2", category: "Indian Men", matchNo: "2nd T20I", teams: ["Zimbabwe", "India"], startISO: "2026-07-25T12:00:00.000Z", venue: "Harare Sports Club, Harare", timeTBA: true },
  { id: "espn-zim-ind-2026-t20-3", category: "Indian Men", matchNo: "3rd T20I", teams: ["Zimbabwe", "India"], startISO: "2026-07-26T12:00:00.000Z", venue: "Harare Sports Club, Harare", timeTBA: true }
];
const WIMBLEDON_GRAPHQL = "https://www.wimbledon.com/graphql";
const WIMBLEDON_AUTH = "77d2d900-b41b-4a6a-8700-b98f80bef920";
const ENABLE_WIMBLEDON_ENRICHMENT = process.env.ENABLE_WIMBLEDON_ENRICHMENT !== "0";

function ymd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function dateWindow(daysBack = 2, daysForward = 4) {
  const out = [];
  const now = new Date();
  for (let i = -daysBack; i <= daysForward; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(ymd(d));
  }
  return out;
}

function dateRange(start, end) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function stateFromEspn(status = {}) {
  const state = status?.type?.state;
  if (state === "in") return "Live";
  if (state === "post") return "Finished";
  if (state === "pre") return "Upcoming";
  return "Unknown";
}

function parseDate(value) {
  const d = new Date(value || 0);
  return Number.isFinite(d.getTime()) ? d : new Date(0);
}

function footballStats(comp, competitorId) {
  const row = (comp?.competitors || []).find(c => String(c.id) === String(competitorId));
  const stats = Object.fromEntries((row?.statistics || []).map(s => [s.name, s.displayValue]));
  return {
    possession: stats.possessionPct || "--",
    shots: stats.totalShots || "--",
    shotsOnTarget: stats.shotsOnTarget || "--",
    corners: stats.wonCorners || "--"
  };
}

function normalizeFootballEvent(event) {
  const comp = event?.competitions?.[0] || {};
  const teams = (comp.competitors || []).map(c => ({
    id: c.id,
    name: c.team?.displayName || c.team?.shortDisplayName || "Team",
    short: c.team?.abbreviation || c.team?.shortDisplayName || "TBD",
    score: c.score ?? "0",
    winner: Boolean(c.winner),
    logo: c.team?.logo || "",
    homeAway: c.homeAway,
    stats: footballStats(comp, c.id)
  }));
  const goals = (comp.details || [])
    .filter(d => d.scoringPlay)
    .map(d => {
      const team = teams.find(t => String(t.id) === String(d.team?.id));
      const scorer = d.athletesInvolved?.[0]?.displayName || "Goal";
      return `${d.clock?.displayValue || ""} ${team?.short || ""} - ${scorer}`.trim();
    });

  const status = comp.status || event.status || {};
  const state = stateFromEspn(status);
  const startISO = comp.startDate || comp.date || event.date;
  const stage = comp.altGameNote || event.season?.slug || "FIFA World Cup";
  const home = teams.find(t => t.homeAway === "home") || teams[0];
  const away = teams.find(t => t.homeAway === "away") || teams[1];
  const scoreText = teams.length >= 2 ? `${home.short} ${home.score} - ${away.score} ${away.short}` : "Score unavailable";
  const venueName = comp.venue?.fullName || comp.venue?.displayName || event.venue?.displayName || "";
  const venueAddress = comp.venue?.address || event.venue?.address || {};
  const venueLocation = [venueAddress.city, venueAddress.state, venueAddress.country].filter(Boolean).join(", ");

  return {
    id: `football-${event.id}`,
    sport: "Football",
    competition: "FIFA World Cup",
    name: event.name ? event.name.replace(/\s+at\s+/i, " vs ") : teams.map(t => t.name).join(" vs "),
    shortName: event.shortName ? event.shortName.replace(/\s+@\s+/i, " vs ") : teams.map(t => t.short).join(" vs "),
    state,
    status: status.type?.shortDetail || status.type?.detail || status.type?.description || state,
    clock: status.displayClock || "",
    period: status.period || "",
    startISO,
    venue: [venueName, venueLocation].filter(Boolean).join(" • "),
    stage,
    lineupLabel: "",
    teams,
    scoreText,
    detail: goals.length ? goals.join(" • ") : (event.competitions?.[0]?.headlines?.[0]?.shortLinkText || stage),
    url: event.links?.find(l => l.rel?.includes("summary"))?.href || "",
    sortTime: parseDate(startISO).getTime()
  };
}

function footballRoundCode(stage = "") {
  const text = String(stage).toLowerCase();
  if (text.includes("round of 32")) return "R32";
  if (text.includes("rd of 16") || text.includes("round of 16")) return "R16";
  if (text.includes("quarter")) return "Q";
  if (text.includes("semi")) return "S";
  if (text.includes("3rd") || text.includes("third")) return "3P";
  if (text.includes("final")) return "Final";
  if (text.includes("group")) return "G";
  return "M";
}

function footballRoundLabel(code = "") {
  if (code === "R32") return "Round of 32";
  if (code === "R16") return "Round of 16";
  if (code === "Q") return "Quarterfinal";
  if (code === "S") return "Semifinal";
  if (code === "3P") return "Third Place";
  if (code === "Final") return "Final";
  if (code === "G") return "Group Stage";
  return "Main Event";
}

function footballPhraseToCode(phrase = "") {
  const text = String(phrase).toLowerCase();
  if (text.includes("round of 32")) return "R32";
  if (text.includes("round of 16")) return "R16";
  if (text.includes("quarter")) return "Q";
  if (text.includes("semi")) return "S";
  if (text.includes("third")) return "3P";
  if (text.includes("final")) return "Final";
  return "";
}

function isMainEventFootball(event) {
  const text = [
    event.name,
    event.shortName,
    event.season?.slug,
    event.competitions?.[0]?.altGameNote,
    event.competitions?.[0]?.notes?.map(n => n.text).join(" ")
  ].filter(Boolean).join(" ").toLowerCase();
  return !text.includes("qualifying") && !text.includes("qualification");
}

function withFootballLineupLabels(events) {
  const grouped = new Map();
  const tournamentOrder = [...events].sort((a, b) => a.sortTime - b.sortTime || String(a.name).localeCompare(String(b.name)));
  tournamentOrder.forEach((event, index) => {
    event.matchNumber = index + 1;
  });

  for (const event of events) {
    const code = footballRoundCode(event.stage);
    event.roundCode = code;
    const key = `${code}|${event.stage}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }

  for (const [key, list] of grouped.entries()) {
    const code = key.split("|")[0];
    list.sort((a, b) => a.sortTime - b.sortTime || String(a.name).localeCompare(String(b.name)));
    list.forEach((event, index) => {
      const roundName = footballRoundLabel(code);
      event.roundMatchNumber = index + 1;
      event.roundLabel = roundName;
      if (code === "Final") event.lineupLabel = `Match No ${event.matchNumber} • Final`;
      else if (code === "3P") event.lineupLabel = `Match No ${event.matchNumber} • Third Place Match`;
      else event.lineupLabel = `Match No ${event.matchNumber} • ${roundName} Match ${index + 1}`;
    });
  }

  const matchNoByRound = new Map();
  for (const event of events) {
    if (event.roundCode && event.roundMatchNumber) {
      matchNoByRound.set(`${event.roundCode}:${event.roundMatchNumber}`, event.matchNumber);
    }
  }

  for (const event of events) {
    event.lineupName = String(event.name || "").replace(
      /(Round of 32|Round of 16|Quarterfinal|Semifinal|Final)\s+(\d+)\s+(Winner|Loser)/gi,
      (full, phrase, roundMatchNo, resultType) => {
        const code = footballPhraseToCode(phrase);
        const matchNo = matchNoByRound.get(`${code}:${Number(roundMatchNo)}`);
        return matchNo ? `${resultType} of Match No ${matchNo}` : `${resultType} of ${phrase} Match No ${roundMatchNo}`;
      }
    );
  }

  return events;
}

function tennisName(c) {
  return c?.athlete?.displayName || c?.roster?.displayName || c?.athlete?.shortName || c?.roster?.shortDisplayName || "TBD";
}

function tennisShort(c) {
  return c?.athlete?.shortName || c?.roster?.shortDisplayName || tennisName(c);
}

function tennisCountry(c) {
  return c?.athlete?.flag?.alt || c?.roster?.flag?.alt || c?.athlete?.country?.abbreviation || c?.roster?.country?.abbreviation || "";
}

function tennisScore(c) {
  const sets = (c?.linescores || []).map(s => {
    const base = String(s.value ?? "");
    return s.tiebreak ? `${base}(${s.tiebreak})` : base;
  }).filter(Boolean);
  return sets.length ? sets.join(" ") : "--";
}

function tennisSets(c) {
  return (c?.linescores || []).map((s, index) => ({
    set: index + 1,
    value: s.value ?? "",
    display: s.tiebreak ? `${s.value ?? ""}(${s.tiebreak})` : String(s.value ?? "")
  })).filter(s => s.display !== "");
}

function tennisPersonKey(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/\[[^\]]+\]|\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tennisPairKeys(names = []) {
  const direct = names.map(tennisPersonKey).filter(Boolean).join("|");
  const reverse = names.map(tennisPersonKey).filter(Boolean).reverse().join("|");
  return [direct, reverse].filter(Boolean);
}

function isCertificateError(err) {
  return ["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"]
    .includes(err?.code);
}

function statPair(won, total) {
  if (won === null || won === undefined || won === "") return "";
  if (total === null || total === undefined || total === "") return String(won);
  return `${won}/${total}`;
}

function wimbledonTeamNames(team = []) {
  const first = team?.[0] || {};
  return [
    first.displayNameA,
    [first.firstNameA, first.lastNameA].filter(Boolean).join(" "),
    first.lastNameA
  ].filter(Boolean);
}

async function fetchWimbledonSlamtrackerStats(matchId) {
  if (!matchId) return new Map();
  const query = `
    query Slamtracker($matchId: String!, $year: String!) {
      slamtracker: slamtrackerPipeline(matchId: $matchId, year: $year) {
        matchId
        year
        match
      }
    }
  `;
  try {
    const res = await http.post(WIMBLEDON_GRAPHQL, {
      operationName: "Slamtracker",
      query,
      variables: { matchId: String(matchId), year: "2026" }
    }, {
      headers: {
        "content-type": "application/json",
        "x-api-key": WIMBLEDON_AUTH
      },
      timeout: 12000
    });
    const raw = res.data?.data?.slamtracker?.match;
    if (!raw) return new Map();
    const match = typeof raw === "string" ? JSON.parse(raw) : raw;
    const stats = match?.base_stats?.match || {};
    const teams = [
      { player: match?.team1, stats: stats.team_1 },
      { player: match?.team2, stats: stats.team_2 }
    ];
    const map = new Map();
    for (const row of teams) {
      const name = row.player?.displayNameA || [row.player?.firstNameA, row.player?.lastNameA].filter(Boolean).join(" ");
      if (!name) continue;
      const payload = {
        breakPointsWon: statPair(row.stats?.t_bp_w, row.stats?.t_bp),
        breakPoints: row.stats?.t_bp ?? "",
        breakPointConversionPct: row.stats?.bp_con_pct ?? ""
      };
      for (const key of tennisPairKeys([name])) map.set(key, payload);
      map.set(tennisPersonKey(name), payload);
      if (row.player?.lastNameA) map.set(tennisPersonKey(row.player.lastNameA), payload);
    }
    return map;
  } catch (err) {
    if (process.env.DEBUG_SPORTS) console.warn(`Wimbledon Slamtracker stats failed for ${matchId}:`, err.message);
    return new Map();
  }
}

async function fetchWimbledonCompletedMatchIds() {
  const daysQuery = `
    query CompletedMatchDays($year: Int!) {
      completedMatchDays(year: $year) {
        tournDay
        displayDay
        quals
      }
    }
  `;
  const matchesQuery = `
    query CompletedMatches($year: Int!, $day: Int!) {
      completedMatches(year: $year, tournDay: $day) {
        matches {
          matchId
          eventCode
          team1 { displayNameA firstNameA lastNameA }
          team2 { displayNameA firstNameA lastNameA }
        }
      }
    }
  `;
  try {
    const dayRes = await http.post(WIMBLEDON_GRAPHQL, {
      operationName: "CompletedMatchDays",
      query: daysQuery,
      variables: { year: 2026 }
    }, {
      headers: {
        "content-type": "application/json",
        "x-api-key": WIMBLEDON_AUTH
      },
      timeout: 12000
    });
    const days = (dayRes.data?.data?.completedMatchDays || [])
      .filter(day => !day.quals)
      .slice(0, 10);
    const results = await Promise.allSettled(days.map(day => http.post(WIMBLEDON_GRAPHQL, {
      operationName: "CompletedMatches",
      query: matchesQuery,
      variables: { year: 2026, day: Number(day.tournDay) }
    }, {
      headers: {
        "content-type": "application/json",
        "x-api-key": WIMBLEDON_AUTH
      },
      timeout: 12000
    })));
    const map = new Map();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const match of result.value.data?.data?.completedMatches?.matches || []) {
        if (!["MS", "LS"].includes(match.eventCode) || !match.matchId) continue;
        const names1 = wimbledonTeamNames(match.team1);
        const names2 = wimbledonTeamNames(match.team2);
        for (const key of tennisPairKeys([names1[0], names2[0]])) map.set(key, match.matchId);
        for (const left of names1) {
          for (const right of names2) {
            for (const key of tennisPairKeys([left, right])) map.set(key, match.matchId);
          }
        }
      }
    }
    return map;
  } catch (err) {
    if (process.env.DEBUG_SPORTS) console.warn("Wimbledon completed match id lookup failed:", err.message);
    return new Map();
  }
}

async function fetchWimbledonLiveScores() {
  const query = `
    query LiveScores {
      liveScores {
        matches {
          matchId
          eventName
          status
          statusCode
          score {
            gameScore
            tennisSets {
              set
              team1 { score scoreDisplay tiebreak tiebreakDisplay }
              team2 { score scoreDisplay tiebreak tiebreakDisplay }
            }
          }
          team1 { displayNameA seed won totalSetsWon }
          team2 { displayNameA seed won totalSetsWon }
        }
      }
    }
  `;
  try {
    const res = await http.post(WIMBLEDON_GRAPHQL, {
      operationName: "LiveScores",
      query,
      variables: {}
    }, {
      headers: {
        "content-type": "application/json",
        "x-api-key": WIMBLEDON_AUTH
      },
      timeout: 15000
    });
    const map = new Map();
    const matches = res.data?.data?.liveScores?.matches || [];
    const statsByMatch = new Map();
    await Promise.allSettled(matches.map(async match => {
      if (match.matchId) statsByMatch.set(match.matchId, await fetchWimbledonSlamtrackerStats(match.matchId));
    }));
    for (const match of matches) {
      const names = [
        match.team1?.[0]?.displayNameA,
        match.team2?.[0]?.displayNameA
      ];
      const gameScore = match.score?.gameScore || [];
      const statsMap = statsByMatch.get(match.matchId) || new Map();
      const payload = {
        wimbledonMatchId: match.matchId,
        wimbledonStatus: match.status,
        pointScore: gameScore?.some(v => v !== null && v !== undefined) ? gameScore.map(v => v ?? "").join(" - ") : "",
        players: names.map((name, index) => ({
          name,
          point: gameScore?.[index] ?? "",
          stats: statsMap.get(tennisPersonKey(name)) || {}
        }))
      };
      for (const key of tennisPairKeys(names)) map.set(key, payload);
    }
    return map;
  } catch (err) {
    if (isCertificateError(err)) {
      return new Map();
    } else {
      console.warn("Wimbledon live score enrichment failed:", err.message);
    }
    return new Map();
  }
}

function seededPlayerName(player) {
  return player.seed ? `[${player.seed}] ${player.name}` : player.name;
}

function seededPlayerShort(player) {
  return player.seed ? `[${player.seed}] ${player.short}` : player.short;
}

function statValueByNames(stats = [], names = []) {
  const wanted = names.map(name => String(name).toLowerCase());
  const row = stats.find(stat => {
    const keys = [stat.name, stat.displayName, stat.shortDisplayName, stat.abbreviation, stat.label]
      .filter(Boolean)
      .map(value => String(value).toLowerCase());
    return keys.some(key => wanted.includes(key));
  });
  return row?.displayValue ?? row?.value ?? "";
}

function tennisBreakStats(c) {
  const stats = c?.statistics || [];
  return {
    serviceBreaks: statValueByNames(stats, [
      "serviceBreaks",
      "service breaks",
      "breaks of serve",
      "return games won",
      "returnGamesWon"
    ]),
    breakPointsWon: statValueByNames(stats, [
      "breakPointsWon",
      "break points won",
      "break point conversions",
      "breakPointsConverted"
    ]),
    breakPoints: statValueByNames(stats, [
      "breakPoints",
      "break points",
      "break point opportunities"
    ])
  };
}

function tennisServingFlag(c) {
  return [c?.serving, c?.isServing, c?.hasServe, c?.server, c?.possession, c?.isPossession]
    .some(value => value === true || value === "true" || value === 1 || value === "1");
}

function normalizeTennisCompetition(comp, event, sourceLeague) {
  const players = (comp.competitors || []).map(c => ({
    id: c.id,
    name: tennisName(c),
    short: tennisShort(c),
    score: tennisScore(c),
    sets: tennisSets(c),
    winner: Boolean(c.winner),
    seed: c.curatedRank?.current || "",
    country: tennisCountry(c),
    serving: tennisServingFlag(c),
    stats: tennisBreakStats(c)
  }));
  const seededNames = players.map(seededPlayerName);
  const seededShortNames = players.map(seededPlayerShort);
  const status = comp.status || {};
  const state = stateFromEspn(status);
  const type = comp.type?.text || event?.grouping?.displayName || "Singles";
  const round = comp.round?.displayName || "";
  const note = comp.notes?.[0]?.text || "";

  return {
    id: `tennis-${sourceLeague}-${comp.id}`,
    sport: "Tennis",
    competition: "Wimbledon",
    name: seededNames.join(" vs "),
    shortName: seededShortNames.join(" vs "),
    state,
    status: status.type?.shortDetail || status.type?.detail || status.type?.description || state,
    clock: "",
    startISO: comp.startDate || comp.date || event.date,
    venue: [comp.venue?.court, comp.venue?.fullName].filter(Boolean).join(" • "),
    stage: [type, round].filter(Boolean).join(" • "),
    lineupLabel: tennisRoundCode(round, type),
    teams: players,
    scoreText: players.map(p => `${p.short} ${p.score}`).join(" | "),
    detail: note || [type, round].filter(Boolean).join(" • "),
    url: "",
    sortTime: parseDate(comp.startDate || comp.date || event.date).getTime()
  };
}

function isMainDrawTennis(comp, event = {}) {
  const text = [
    comp.round?.displayName,
    comp.type?.text,
    comp.notes?.map(n => n.text).join(" "),
    event.name,
    event.shortName,
    event.grouping?.displayName
  ].filter(Boolean).join(" ").toLowerCase();
  return !text.includes("qualifying") && !text.includes("qualification");
}

function tennisRoundCode(round = "", type = "") {
  const text = `${round} ${type}`.toLowerCase();
  if (text.includes("quarter")) return "QF";
  if (text.includes("semi")) return "SF";
  if (text.includes("final")) return "Final";
  const found = text.match(/round\s+(\d+)/i);
  if (found) return `R${found[1]}`;
  return "";
}

function tennisDrawCode(stage = "") {
  const text = String(stage).toLowerCase();
  if (text.includes("women") && text.includes("single")) return "Ladies' Singles";
  if (text.includes("men") && text.includes("single")) return "Gentlemen's Singles";
  if (text.includes("women") && text.includes("double")) return "Ladies' Doubles";
  if (text.includes("men") && text.includes("double")) return "Gentlemen's Doubles";
  if (text.includes("mixed")) return "Mixed Doubles";
  return "Tennis";
}

function tennisRoundLabel(code = "") {
  if (code === "QF") return "Quarterfinal";
  if (code === "SF") return "Semifinal";
  if (code === "Final") return "Final";
  const round = String(code).match(/^R(\d+)$/);
  return round ? `Round ${round[1]}` : "Match";
}

function withTennisLineupLabels(events) {
  const grouped = new Map();
  for (const event of events) {
    const base = tennisRoundCode(event.stage, event.stage) || "M";
    const draw = tennisDrawCode(event.stage);
    const key = `${draw}|${base}|${event.stage}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }

  for (const [key, list] of grouped.entries()) {
    const [draw, base] = key.split("|");
    list.sort((a, b) => a.sortTime - b.sortTime || String(a.name).localeCompare(String(b.name)));
    list.forEach((event, index) => {
      const roundLabel = tennisRoundLabel(base);
      event.drawName = draw;
      event.roundCode = base;
      event.roundLabel = roundLabel;
      event.roundMatchNumber = index + 1;
      if (base === "Final") event.lineupLabel = `${draw} • Final`;
      else event.lineupLabel = `${draw} • ${roundLabel} • Match No ${index + 1}`;
    });
  }

  return events;
}

async function fetchFootball() {
  const dates = dateRange("2026-06-11", "2026-07-19");
  const responses = await Promise.allSettled(dates.map(date => http.get(`${FOOTBALL_URL}?dates=${date}`)));
  const events = [];
  for (const result of responses) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value.data?.events || []) {
      if (!isMainEventFootball(event)) continue;
      events.push(normalizeFootballEvent(event));
    }
  }
  return withFootballLineupLabels(dedupe(events));
}

async function fetchTennis() {
  const [scoreResults, wimbledonScores, wimbledonCompletedIds] = await Promise.all([
    Promise.allSettled(TENNIS_URLS.map(url => http.get(url))),
    ENABLE_WIMBLEDON_ENRICHMENT ? fetchWimbledonLiveScores() : Promise.resolve(new Map()),
    ENABLE_WIMBLEDON_ENRICHMENT ? fetchWimbledonCompletedMatchIds() : Promise.resolve(new Map())
  ]);
  const rows = [];
  for (const result of scoreResults) {
    if (result.status !== "fulfilled") continue;
    const league = result.value.data?.leagues?.[0]?.slug || "tennis";
    for (const event of result.value.data?.events || []) {
      if (!/wimbledon/i.test(event.name || event.shortName || "")) continue;
      for (const grouping of event.groupings || []) {
        for (const comp of grouping.competitions || []) {
          if (!isMainDrawTennis(comp, { ...event, grouping: grouping.grouping })) continue;
          rows.push(normalizeTennisCompetition(comp, { ...event, grouping: grouping.grouping }, league));
        }
      }
    }
  }
  for (const row of rows) {
    const keys = tennisPairKeys((row.teams || []).map(t => t.short || t.name));
    const enrichment = keys.map(key => wimbledonScores.get(key)).find(Boolean);
    if (enrichment) {
      row.pointScore = enrichment.pointScore;
      row.wimbledonStatus = enrichment.wimbledonStatus;
      row.teams = (row.teams || []).map((team, index) => ({
        ...team,
        point: enrichment.players?.find(player => tennisPersonKey(player.name) === tennisPersonKey(team.short || team.name))?.point ?? "",
        stats: {
          ...(team.stats || {}),
          ...(enrichment.players?.find(player => tennisPersonKey(player.name) === tennisPersonKey(team.short || team.name))?.stats || {})
        }
      }));
    }
  }
  const recentFinished = rows
    .filter(row => row.state === "Finished")
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 16);
  const finishedStats = new Map();
  await Promise.allSettled(recentFinished.map(async row => {
    const keys = tennisPairKeys((row.teams || []).map(t => t.short || t.name));
    const matchId = keys.map(key => wimbledonCompletedIds.get(key)).find(Boolean);
    if (!matchId || finishedStats.has(matchId)) return;
    finishedStats.set(matchId, await fetchWimbledonSlamtrackerStats(matchId));
  }));
  for (const row of recentFinished) {
    const keys = tennisPairKeys((row.teams || []).map(t => t.short || t.name));
    const matchId = keys.map(key => wimbledonCompletedIds.get(key)).find(Boolean);
    const statsMap = finishedStats.get(matchId);
    if (!statsMap) continue;
    row.wimbledonMatchId = matchId;
    row.teams = (row.teams || []).map(team => ({
      ...team,
      stats: {
        ...(team.stats || {}),
        ...(statsMap.get(tennisPersonKey(team.short || team.name)) || {})
      }
    }));
  }
  return withTennisLineupLabels(dedupe(rows));
}

function dedupe(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.sport}|${item.name}|${item.startISO}|${item.stage}`;
    const prev = map.get(key);
    if (!prev || stateRank(item.state) > stateRank(prev.state)) map.set(key, item);
  }
  return [...map.values()];
}

function stateRank(state) {
  return { Live: 3, Upcoming: 2, Finished: 1, Unknown: 0 }[state] || 0;
}

const CRICKET_SHORT = {
  England: "ENG",
  India: "IND",
  Ireland: "IRE",
  "New Zealand": "NZ",
  Australia: "AUS",
  Pakistan: "PAK",
  "South Africa": "SA",
  "Sri Lanka": "SL",
  "West Indies": "WI",
  Zimbabwe: "ZIM"
};

function cricketShort(team = "") {
  return CRICKET_SHORT[team] || String(team || "").replace(/\s+Women$/i, "W").slice(0, 4).toUpperCase();
}

function cricketScoreFor(match, team, state = "") {
  const short = cricketShort(team);
  const row = (match.scores || []).find(score => String(score.team || "").toUpperCase() === short);
  if (row) return [row.score, row.overs ? `(${row.overs} ov)` : ""].filter(Boolean).join(" ");
  return state === "Live" && (match.scores || []).length ? "Yet to bat" : "";
}

function cricketWinner(match, team) {
  const status = String(match.status || "");
  if (!/\bwon\b/i.test(status)) return false;
  return new RegExp(`\\b${String(team).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(status)
    || new RegExp(`\\b${cricketShort(team)}\\b`, "i").test(status);
}

function cricketScheduledState(match, now = Date.now()) {
  if (match.state) return match.state;
  const start = Date.parse(match.startISO || "");
  if (!Number.isFinite(start)) return "Upcoming";
  if (start > now) return "Upcoming";
  const text = `${match.matchNo || ""}`.toLowerCase();
  const hours = text.includes("odi") ? 9 : text.includes("test") ? 120 : 5;
  return now - start <= hours * 60 * 60 * 1000 ? "Live" : "Finished";
}

function cricketScheduleStatus(match, state) {
  if (match.status) return match.status;
  if (state === "Upcoming") {
    const start = new Date(match.startISO || "");
    const startLabel = match.timeTBA && Number.isFinite(start.getTime())
      ? start.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })
      : match.startISO;
    return match.venue ? `Starts ${startLabel} - ${match.venue}` : `Starts ${startLabel}`;
  }
  if (state === "Live") return "Match in progress - live score pending";
  return "Result pending update";
}

function inferIndiaMatchNo(match) {
  const date = String(match.startISO || "").slice(0, 10);
  return ({
    "2026-07-01": "1st T20I",
    "2026-07-04": "2nd T20I",
    "2026-07-07": "3rd T20I",
    "2026-07-09": "4th T20I",
    "2026-07-11": "5th T20I",
    "2026-07-14": "1st ODI",
    "2026-07-16": "2nd ODI",
    "2026-07-19": "3rd ODI",
    "2026-07-23": "1st T20I",
    "2026-07-25": "2nd T20I",
    "2026-07-26": "3rd T20I"
  })[date] || match.matchNo || "Indian Men";
}

function normalizeCricketMatch(match, sourceMeta = {}) {
  const state = cricketScheduledState(match);
  const matchNo = match.matchNo || inferIndiaMatchNo(match);
  const inningsStatus = match.liveDetails?.requiredRR || (state === "Live" && (match.scores || []).length === 1 ? "First innings" : "");
  const teams = (match.teams || []).slice(0, 2).map(team => ({
    name: team,
    short: cricketShort(team),
    score: cricketScoreFor(match, team, state),
    winner: cricketWinner(match, team)
  }));
  return {
    id: `cricket-${match.id || `${match.matchNo}-${match.startISO}`}`,
    sport: "Cricket",
    competition: "Indian Men",
    name: match.name || teams.map(t => t.name).join(" vs "),
    shortName: teams.map(t => t.short).join(" vs "),
    state,
    status: cricketScheduleStatus(match, state),
    clock: "",
    startISO: match.startISO || "",
    venue: match.venue || match.liveDetails?.venue || "",
    stage: matchNo,
    lineupLabel: matchNo,
    teams,
    scoreText: match.score || (state === "Upcoming" ? "Match not started" : state === "Live" ? "Live score pending" : "Result pending update"),
    detail: match.playerOfMatch ? `POTM: ${match.playerOfMatch}` : (match.status || ""),
    inningsStatus,
    url: match.url || "",
    dataSource: sourceMeta.source || "Cricket Dashboard",
    sourceFetchedAt: sourceMeta.fetchedAt || "",
    sourceCached: Boolean(sourceMeta.cached),
    sourceStale: Boolean(sourceMeta.stale),
    sourceFallback: Boolean(sourceMeta.fallback),
    sortTime: parseDate(match.endISO || match.startISO).getTime()
  };
}

async function fetchIndianMenCricket() {
  for (const url of CRICKET_API_URLS) {
    try {
      const response = await http.get(url, { timeout: 12000 });
      const sourceMeta = {
        source: url.includes("localhost") ? "Local Cricket Dashboard" : "Cricket Dashboard Render",
        fetchedAt: response.data?.fetchedAt || new Date().toISOString(),
        cached: Boolean(response.data?.cached),
        stale: Boolean(response.data?.stale),
        fallback: false
      };
      const rows = (response.data?.data || [])
        .filter(match => match.category === "Indian Men")
        .map(match => normalizeCricketMatch(match, sourceMeta));
      if (rows.length) return dedupe(rows);
    } catch (err) {
      if (process.env.DEBUG_SPORTS) console.warn(`Indian Men cricket fetch failed from ${url}:`, err.message);
    }
  }
  return dedupe(INDIA_CRICKET_FALLBACK.map(match => normalizeCricketMatch(
    { ...match, source: "Fallback Indian Men schedule" },
    { source: "Fallback schedule", fetchedAt: new Date().toISOString(), cached: false, stale: false, fallback: true }
  )));
}

function sortDashboard(items) {
  return [...items].sort((a, b) => {
    const live = (b.state === "Live") - (a.state === "Live");
    if (live) return live;
    const upcomingA = a.state === "Upcoming";
    const upcomingB = b.state === "Upcoming";
    if (upcomingA && upcomingB) return a.sortTime - b.sortTime;
    if (upcomingA !== upcomingB) return upcomingA ? -1 : 1;
    return b.sortTime - a.sortTime;
  });
}

async function fetchAll() {
  const [football, tennis, cricket] = await Promise.all([fetchFootball(), fetchTennis(), fetchIndianMenCricket()]);
  const data = sortDashboard([...football, ...tennis, ...cricket]);
  return {
    data,
    meta: {
      total: data.length,
      football: football.length,
      tennis: tennis.length,
      cricket: cricket.length,
      live: data.filter(x => x.state === "Live").length,
      upcoming: data.filter(x => x.state === "Upcoming").length,
      finished: data.filter(x => x.state === "Finished").length
    }
  };
}

async function getCached() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }
  if (!fetchPromise) {
    fetchPromise = fetchAll()
      .then(data => {
        cache = { data, fetchedAt: Date.now() };
        return data;
      })
      .finally(() => { fetchPromise = null; });
  }
  try {
    return { ...(await fetchPromise), cached: false };
  } catch (err) {
    if (cache.data) return { ...cache.data, cached: true, stale: true, error: err.message };
    throw err;
  }
}

app.get("/api/sports", async (req, res) => {
  try {
    const payload = await getCached();
    res.json({ status: "success", fetchedAt: new Date(cache.fetchedAt || Date.now()).toISOString(), ...payload });
  } catch (err) {
    res.status(502).json({ status: "error", error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "Vipul Sports Dashboard", port: String(PORT), routes: ["/api/sports", "/api/health"] });
});

app.get("/", (req, res) => {
  res.redirect("/other-sports-dashboard.html");
});

app.get("/sports-dashboard.html", (req, res) => {
  res.redirect("/other-sports-dashboard.html");
});

app.listen(PORT, () => {
  console.log(`Other sports dashboard running on http://localhost:${PORT}/other-sports-dashboard.html`);
});
