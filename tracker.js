const REFRESH_SECONDS = 30;
const STORAGE_KEY = "fanduel_espn_live_slip_v1";

// Default player legs from your screenshot (saved to localStorage so you can add/delete freely)
const DEFAULT_BETS = [
    { id: "leg-1", player: "Rasmus Dahlin",     matchKey: "Dahlin",    teamKey: "BUF", pos: "D",  prop: "1+ POINTS", type: "PTS", target: 1, matchup: "CBJ @ BUF" },
    { id: "leg-2", player: "Zach Benson",       matchKey: "Benson",    teamKey: "BUF", pos: "LW", prop: "1+ POINTS", type: "PTS", target: 1, matchup: "CBJ @ BUF" },
    { id: "leg-3", player: "Macklin Celebrini", matchKey: "Celebrini", teamKey: "SJ",  pos: "C",  prop: "1+ POINTS", type: "PTS", target: 1, matchup: "SJ @ MIN"  },
    { id: "leg-4", player: "Kirill Kaprizov",   matchKey: "Kaprizov",  teamKey: "MIN", pos: "LW", prop: "1+ GOALS",  type: "G",   target: 1, matchup: "SJ @ MIN"  },
    { id: "leg-5", player: "Cutter Gauthier",   matchKey: "Gauthier",  teamKey: "ANA", pos: "LW", prop: "1+ POINTS", type: "PTS", target: 1, matchup: "ANA @ CGY" }
];

let bets = JSON.parse(localStorage.getItem(STORAGE_KEY)) || DEFAULT_BETS;
let todaysPlayers = [];     // Cached roster of all players in tonight's slate
let selectedPlayer = null;  // Holds the player picked from the search dropdown

function saveBets() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
}

function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
}

// 1. Pre-fetch rosters for every team playing today so search is instant
async function loadTodaysRosters() {
    const statusBar = document.getElementById("roster-status-bar");
    try {
        const dateStr = getTodayDateString();
        const sbRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateStr}`);
        const sb = await sbRes.json();
        const events = sb.events || [];

        const teamRequests = [];
        for (const ev of events) {
            const comp = ev.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === "home");
            const away = comp.competitors.find(c => c.homeAway === "away");
            const matchupStr = `${away.team.abbreviation} @ ${home.team.abbreviation}`;

            for (const c of comp.competitors) {
                teamRequests.push({
                    id: c.team.id,
                    abbr: c.team.abbreviation,
                    matchup: matchupStr
                });
            }
        }

        const rosterPromises = teamRequests.map(async (t) => {
            const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${t.id}/roster`);
            const data = await res.json();
            const players = [];
            for (const group of (data.athletes || [])) {
                for (const ath of (group.items || [])) {
                    players.push({
                        fullName: ath.fullName || ath.displayName,
                        lastName: ath.lastName || ath.displayName.split(" ").pop(),
                        teamKey: t.abbr,
                        pos: ath.position?.abbreviation || "SKT",
                        matchup: t.matchup
                    });
                }
            }
            return players;
        });

        const nestedPlayers = await Promise.all(rosterPromises);
        todaysPlayers = nestedPlayers.flat();
        statusBar.textContent = `Ready: ${todaysPlayers.length} active players loaded across ${events.length} NHL games tonight.`;
    } catch (err) {
        statusBar.textContent = `Live ESPN Search Fallback active (${err.message})`;
    }
}

// 2. Fallback: Direct query to ESPN's Search API if player isn't in tonight's cached rosters
async function searchEspnApiDirectly(query) {
    const url = `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(query)}&limit=6&type=player&sport=hockey&league=nhl`;
    const res = await fetch(url);
    const data = await res.json();
    const items = data.items || [];
    return items.map(item => {
        const teamRel = (item.teamRelationships || [])[0];
        const abbr = teamRel?.core?.abbreviation || "NHL";
        return {
            fullName: item.displayName,
            lastName: item.displayName.split(" ").pop(),
            teamKey: abbr,
            pos: "SKT",
            matchup: `${abbr} Game`
        };
    });
}

// 3. Wire up the Search Input, Dropdown Divs, and Add Leg Button
function setupSearchUI() {
    const searchInput = document.getElementById("player-search-input");
    const dropdown = document.getElementById("search-dropdown");
    const addBtn = document.getElementById("add-leg-btn");
    const clearBtn = document.getElementById("clear-slip-btn");

    searchInput.addEventListener("input", async (e) => {
        const q = e.target.value.trim().toLowerCase();
        selectedPlayer = null;

        if (q.length < 2) {
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        // Filter tonight's active rosters first
        let matches = todaysPlayers.filter(p => p.fullName.toLowerCase().includes(q)).slice(0, 8);

        // If no local match, query ESPN's search API directly
        if (matches.length === 0) {
            try {
                matches = await searchEspnApiDirectly(q);
            } catch (_) {
                matches = [];
            }
        }

        dropdown.innerHTML = "";
        if (matches.length === 0) {
            dropdown.style.display = "none";
            return;
        }

        for (const p of matches) {
            const itemDiv = document.createElement("div");
            itemDiv.className = "search-result-item";
            itemDiv.textContent = `${p.fullName} (${p.teamKey} - ${p.pos}) [${p.matchup}]`;
            itemDiv.addEventListener("click", () => {
                selectedPlayer = p;
                searchInput.value = p.fullName;
                dropdown.style.display = "none";
            });
            dropdown.appendChild(itemDiv);
        }
        dropdown.style.display = "block";
    });

    // Hide dropdown when clicking outside
    document.addEventListener("click", (e) => {
        if (!document.getElementById("search-input-wrapper").contains(e.target)) {
            dropdown.style.display = "none";
        }
    });

    addBtn.addEventListener("click", () => {
        const rawName = searchInput.value.trim();
        if (!rawName) return;

        const target = parseInt(document.getElementById("leg-target-input").value, 10) || 1;
        const statType = document.getElementById("leg-stat-select").value; // SOG, G, A, PTS

        // If user clicked a dropdown option, use it; otherwise match best from tonight's players
        const playerObj = selectedPlayer || todaysPlayers.find(p => p.fullName.toLowerCase() === rawName.toLowerCase()) || {
            fullName: rawName,
            lastName: rawName.split(" ").pop(),
            teamKey: "ANY",
            pos: "SKT",
            matchup: "TBD"
        };

        const propLabels = {
            SOG: `${target}+ SHOTS ON GOAL`,
            G:   `${target}+ GOALS`,
            A:   `${target}+ ASSISTS`,
            PTS: `${target}+ POINTS`
        };

        const newBet = {
            id: `leg-${Date.now()}`,
            player: playerObj.fullName,
            matchKey: playerObj.lastName,
            teamKey: playerObj.teamKey,
            pos: playerObj.pos,
            prop: propLabels[statType] || `${target}+ ${statType}`,
            type: statType,
            target: target,
            matchup: playerObj.matchup
        };

        bets.push(newBet);
        saveBets();
        searchInput.value = "";
        selectedPlayer = null;
        updateTracker();
    });

    clearBtn.addEventListener("click", () => {
        bets = [];
        saveBets();
        updateTracker();
    });
}

// 4. Live Boxscore Polling (Supports SOG, G, A, and PTS)
async function fetchLiveEspnData() {
    const dateStr = getTodayDateString();
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateStr}`;
    const sbResponse = await fetch(scoreboardUrl);
    const scoreboard = await sbResponse.json();

    const gameMap = {};
    const playerStatsMap = {};
    const events = scoreboard.events || [];

    for (const event of events) {
        const eventId = event.id;
        const comp = event.competitions[0];
        const status = event.status.type.shortDetail;
        const state = event.status.type.state;

        const homeTeam = comp.competitors.find(c => c.homeAway === "home");
        const awayTeam = comp.competitors.find(c => c.homeAway === "away");

        const homeScore = parseInt(homeTeam.score || "0", 10);
        const awayScore = parseInt(awayTeam.score || "0", 10);
        const scoreStr = `${awayTeam.team.abbreviation} ${awayScore} @ ${homeTeam.team.abbreviation} ${homeScore} [${status}]`;

        for (const competitor of comp.competitors) {
            const abbr = competitor.team.abbreviation;
            gameMap[abbr] = {
                eventId: eventId,
                state: state,
                scoreStr: scoreStr
            };
        }

        if (state !== "pre") {
            const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${eventId}`;
            const sumResponse = await fetch(summaryUrl);
            const summary = await sumResponse.json();

            const boxPlayers = summary?.boxscore?.players || [];
            for (const teamBox of boxPlayers) {
                const teamAbbr = teamBox.team.abbreviation;
                for (const statGroup of (teamBox.statistics || [])) {
                    if (statGroup.name === "goalies") continue;

                    const labels = statGroup.labels || [];
                    for (const athleteEntry of (statGroup.athletes || [])) {
                        const dispName = athleteEntry.athlete.displayName;
                        const rawStats = athleteEntry.stats || [];
                        const statDict = {};

                        for (let i = 0; i < labels.length; i++) {
                            statDict[labels[i]] = parseInt(rawStats[i] || "0", 10) || 0;
                        }

                        const goals = statDict["G"] || 0;
                        const assists = statDict["A"] || 0;
                        const shots = statDict["S"] !== undefined ? statDict["S"] : (statDict["SOG"] || 0);

                        playerStatsMap[`${teamAbbr}|${dispName}`] = {
                            teamAbbr: teamAbbr,
                            goals: goals,
                            assists: assists,
                            points: goals + assists,
                            shots: shots
                        };
                    }
                }
            }
        }
    }

    return { gameMap, playerStatsMap };
}

function evaluateBetLeg(bet, gameMap, playerStatsMap) {
    // Match player in boxscore by full name or last name
    const matchedKey = Object.keys(playerStatsMap).find(k =>
        k.toLowerCase().includes(bet.player.toLowerCase()) ||
        (bet.teamKey !== "ANY" && k.startsWith(`${bet.teamKey}|`) && k.toLowerCase().includes(bet.matchKey.toLowerCase()))
    );

    const pStats = matchedKey ? playerStatsMap[matchedKey] : { teamAbbr: bet.teamKey, goals: 0, assists: 0, points: 0, shots: 0 };
    const effectiveTeam = bet.teamKey !== "ANY" ? bet.teamKey : pStats.teamAbbr;

    let gameInfo = gameMap[effectiveTeam];
    if (!gameInfo && effectiveTeam === "SJ") gameInfo = gameMap["SJS"];

    const displayName = `${bet.player} (${bet.pos})`;
    let detailStr = "-";
    let legStatus = "[NO GAME]";
    let statusClass = "status-error";
    let gameClockStr = bet.matchup;
    let isHit = false;

    if (!gameInfo) {
        return { displayName, detailStr, legStatus, statusClass, gameClockStr, isHit };
    }

    gameClockStr = gameInfo.scoreStr;
    let currentVal = 0;

    if (bet.type === "SOG") {
        currentVal = pStats.shots;
        detailStr = `${pStats.shots} / ${bet.target} SOG`;
    } else if (bet.type === "G") {
        currentVal = pStats.goals;
        detailStr = `${pStats.goals} / ${bet.target} G (${pStats.shots} SOG)`;
    } else if (bet.type === "A") {
        currentVal = pStats.assists;
        detailStr = `${pStats.assists} / ${bet.target} A`;
    } else if (bet.type === "PTS") {
        currentVal = pStats.points;
        detailStr = `${pStats.points} PTS (${pStats.goals}G, ${pStats.assists}A)`;
    }

    if (currentVal >= bet.target) {
        legStatus = "[HIT]";
        statusClass = "status-hit";
        isHit = true;
    } else if (gameInfo.state === "pre") {
        legStatus = "[UPCOMING]";
        statusClass = "status-upcoming";
        detailStr = `0 / ${bet.target} ${bet.type}`;
    } else if (gameInfo.state === "post") {
        legStatus = "[MISSED]";
        statusClass = "status-missed";
    } else {
        legStatus = "[LIVE]";
        statusClass = "status-live";
    }

    return { displayName, detailStr, legStatus, statusClass, gameClockStr, isHit };
}

async function updateTracker() {
    const errorBox = document.getElementById("error-container");
    errorBox.innerHTML = "";

    try {
        const { gameMap, playerStatsMap } = await fetchLiveEspnData();
        const betsContainer = document.getElementById("bets-list-container");
        betsContainer.innerHTML = "";
        let hits = 0;

        for (const bet of bets) {
            const result = evaluateBetLeg(bet, gameMap, playerStatsMap);
            if (result.isHit) hits++;

            const rowDiv = document.createElement("div");
            rowDiv.id = `bet-row-${bet.id}`;
            rowDiv.className = `grid-row bet-item-row ${result.statusClass}`;
            rowDiv.setAttribute("data-team", bet.teamKey);
            rowDiv.setAttribute("data-prop-type", bet.type);

            rowDiv.innerHTML = `
                <div id="${bet.id}-player" class="col-player bet-cell-player">${result.displayName}</div>
                <div id="${bet.id}-prop" class="col-prop bet-cell-prop">${bet.prop}</div>
                <div id="${bet.id}-current" class="col-current bet-cell-current">${result.detailStr}</div>
                <div id="${bet.id}-status" class="col-status bet-cell-status">${result.legStatus}</div>
                <div id="${bet.id}-game" class="col-game bet-cell-game">${result.gameClockStr}</div>
                <div id="${bet.id}-action" class="col-action bet-cell-action">
                    <button type="button" class="btn-remove-leg" data-id="${bet.id}">[X]</button>
                </div>
            `;

            betsContainer.appendChild(rowDiv);
        }

        // Attach delete buttons for each row
        document.querySelectorAll(".btn-remove-leg").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const idToRemove = e.target.getAttribute("data-id");
                bets = bets.filter(b => b.id !== idToRemove);
                saveBets();
                
                updateTracker();
            });
        });

        document.getElementById("last-updated-time").textContent = new Date().toLocaleTimeString();
        document.getElementById("parlay-hits-count").textContent = hits;
        document.getElementById("parlay-total-count").textContent = bets.length;

    } catch (err) {
        errorBox.innerHTML = `<div id="error-message" class="error-row">[!] Error polling ESPN API: ${err.message}</div>`;
    }
}

// Initialize search UI, load tonight's rosters, and start 30s live polling
setupSearchUI();
loadTodaysRosters();
updateTracker();
setInterval(updateTracker, REFRESH_SECONDS * 1000);