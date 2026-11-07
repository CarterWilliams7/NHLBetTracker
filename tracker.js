const REFRESH_SECONDS = 30;
const STORAGE_KEY = "fanduel_espn_live_slip_v3";

const DEFAULT_BETS = [
    { id: "leg-1", player: "Buffalo Sabres",    matchKey: "BUF",       teamKey: "BUF", pos: "TEAM",  prop: "MONEYLINE", type: "ML",  target: 1,   matchup: "CBJ @ BUF" },
    { id: "leg-2", player: "Rasmus Dahlin",     matchKey: "Dahlin",    teamKey: "BUF", pos: "D",     prop: "1+ POINTS", type: "PTS", target: 1,   matchup: "CBJ @ BUF" },
    { id: "leg-3", player: "Zach Benson",       matchKey: "Benson",    teamKey: "BUF", pos: "LW",    prop: "1+ POINTS", type: "PTS", target: 1,   matchup: "CBJ @ BUF" },
    { id: "leg-4", player: "Macklin Celebrini", matchKey: "Celebrini", teamKey: "SJ",  pos: "C",     prop: "1+ POINTS", type: "PTS", target: 1,   matchup: "SJ @ MIN"  },
    { id: "leg-5", player: "Kirill Kaprizov",   matchKey: "Kaprizov",  teamKey: "MIN", pos: "LW",    prop: "1+ GOALS",  type: "G",   target: 1,   matchup: "SJ @ MIN"  },
    { id: "leg-6", player: "Minnesota Wild",    matchKey: "MIN",       teamKey: "MIN", pos: "TEAM",  prop: "MONEYLINE", type: "ML",  target: 1,   matchup: "SJ @ MIN"  },
    { id: "leg-7", player: "Cutter Gauthier",   matchKey: "Gauthier",  teamKey: "ANA", pos: "LW",    prop: "1+ POINTS", type: "PTS", target: 1,   matchup: "ANA @ CGY" }
];

let bets = JSON.parse(localStorage.getItem(STORAGE_KEY)) || DEFAULT_BETS;
let todaysPlayers = [];
let todaysTeams = [];
let selectedPlayer = null;

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

async function loadTodaysSlateAndRosters() {
    const statusBar = document.getElementById("roster-status-bar");
    const teamDropdown = document.getElementById("team-select-dropdown");

    const dateStr = getTodayDateString();
    const sbRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateStr}`);
    const sb = await sbRes.json();
    const events = sb.events || [];

    todaysTeams = [];
    teamDropdown.innerHTML = "";

    for (const ev of events) {
        const comp = ev.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === "home");
        const away = comp.competitors.find(c => c.homeAway === "away");
        const matchupStr = `${away.team.abbreviation} @ ${home.team.abbreviation}`;

        for (const c of comp.competitors) {
            const teamObj = {
                id: c.team.id,
                abbr: c.team.abbreviation,
                displayName: c.team.displayName,
                matchup: matchupStr
            };
            todaysTeams.push(teamObj);

            const opt = document.createElement("option");
            opt.value = teamObj.abbr;
            opt.textContent = `${teamObj.displayName} (${teamObj.matchup})`;
            teamDropdown.appendChild(opt);
        }
    }

    if (todaysTeams.length === 0) {
        teamDropdown.innerHTML = `<option value="">No NHL games scheduled today</option>`;
    }

    const rosterPromises = todaysTeams.map(async (t) => {
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
    statusBar.textContent = `Ready: ${todaysTeams.length / 2} games & ${todaysPlayers.length} active players loaded for today's slate.`;
}

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

function setupBuilderUI() {
    const searchInput = document.getElementById("player-search-input");
    const dropdown = document.getElementById("search-dropdown");
    const addPlayerBtn = document.getElementById("add-player-leg-btn");

    const teamSelect = document.getElementById("team-select-dropdown");
    const addTeamMlBtn = document.getElementById("add-team-ml-btn");

    const ouTypeSelect = document.getElementById("ou-type-select");
    const ouLineInput = document.getElementById("ou-line-input");
    const addOuBtn = document.getElementById("add-ou-leg-btn");
    const clearBtn = document.getElementById("clear-slip-btn");

    searchInput.addEventListener("input", async (e) => {
        const q = e.target.value.trim().toLowerCase();
        selectedPlayer = null;

        if (q.length < 2) {
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        let matches = todaysPlayers.filter(p => p.fullName.toLowerCase().includes(q)).slice(0, 8);
        if (matches.length === 0) {
            matches = await searchEspnApiDirectly(q);
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

    document.addEventListener("click", (e) => {
        if (!document.getElementById("search-input-wrapper").contains(e.target)) {
            dropdown.style.display = "none";
        }
    });

    // Button 1: Add Player Prop
    addPlayerBtn.addEventListener("click", () => {
        const rawName = searchInput.value.trim();
        if (!rawName) return;

        const target = parseFloat(document.getElementById("leg-target-input").value);
        const statType = document.getElementById("leg-stat-select").value;

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

        bets.push({
            id: `leg-${Date.now()}`,
            player: playerObj.fullName,
            matchKey: playerObj.lastName,
            teamKey: playerObj.teamKey,
            pos: playerObj.pos,
            prop: propLabels[statType] || `${target}+ ${statType}`,
            type: statType,
            target: target,
            matchup: playerObj.matchup
        });

        saveBets();
        searchInput.value = "";
        selectedPlayer = null;
        updateTracker();
    });

    // Button 2: Add Team Moneyline (Separate Button)
    addTeamMlBtn.addEventListener("click", () => {
        const selectedAbbr = teamSelect.value;
        const teamObj = todaysTeams.find(t => t.abbr === selectedAbbr) || {
            abbr: selectedAbbr,
            displayName: selectedAbbr,
            matchup: `${selectedAbbr} Game`
        };

        bets.push({
            id: `leg-${Date.now()}`,
            player: teamObj.displayName,
            matchKey: teamObj.abbr,
            teamKey: teamObj.abbr,
            pos: "TEAM",
            prop: "MONEYLINE",
            type: "ML",
            target: 1,
            matchup: teamObj.matchup
        });

        saveBets();
        updateTracker();
    });

    // Button 3: Add Game Over/Under (Separate Button, raw editable text, no error catching)
    addOuBtn.addEventListener("click", () => {
        const selectedAbbr = teamSelect.value;
        const teamObj = todaysTeams.find(t => t.abbr === selectedAbbr) || {
            abbr: selectedAbbr,
            displayName: selectedAbbr,
            matchup: `${selectedAbbr} Game`
        };

        const ouType = ouTypeSelect.value; // "OVER" or "UNDER"
        const rawText = ouLineInput.value; // Directly takes editable text without error handling
        const parsedTarget = parseFloat(rawText);

        bets.push({
            id: `leg-${Date.now()}`,
            player: teamObj.matchup,
            matchKey: teamObj.abbr,
            teamKey: teamObj.abbr,
            pos: "TOTAL",
            prop: `${ouType} ${rawText}`,
            type: ouType,
            target: parsedTarget,
            matchup: teamObj.matchup
        });

        saveBets();
        updateTracker();
    });

    clearBtn.addEventListener("click", () => {
        bets = [];
        saveBets();
        updateTracker();
    });
}

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
            const isHome = competitor.homeAway === "home";
            gameMap[abbr] = {
                eventId: eventId,
                state: state,
                scoreStr: scoreStr,
                teamScore: isHome ? homeScore : awayScore,
                oppScore: isHome ? awayScore : homeScore,
                totalGoals: homeScore + awayScore
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

    if (bet.type === "ML") {
        const ts = gameInfo.teamScore;
        const os = gameInfo.oppScore;

        if (gameInfo.state === "pre") {
            detailStr = "0 - 0";
            legStatus = "[UPCOMING]";
            statusClass = "status-upcoming";
        } else if (gameInfo.state === "post") {
            if (ts > os) {
                detailStr = `WIN (${ts}-${os})`;
                legStatus = "[HIT]";
                statusClass = "status-hit";
                isHit = true;
            } else {
                detailStr = `LOSS (${ts}-${os})`;
                legStatus = "[MISSED]";
                statusClass = "status-missed";
            }
        } else {
            if (ts > os) {
                detailStr = `LEAD (${ts}-${os})`;
                legStatus = "[LEADING]";
            } else if (ts < os) {
                detailStr = `TRAIL (${ts}-${os})`;
                legStatus = "[TRAILING]";
            } else {
                detailStr = `TIED (${ts}-${os})`;
                legStatus = "[TIED]";
            }
            statusClass = "status-live";
        }
        return { displayName, detailStr, legStatus, statusClass, gameClockStr, isHit };
    }

    if (bet.type === "OVER" || bet.type === "UNDER") {
        const total = gameInfo.totalGoals;
        const line = parseFloat(bet.target);
        detailStr = `${total} / ${line} GOALS`;

        if (gameInfo.state === "pre") {
            detailStr = `0 / ${line} GOALS`;
            legStatus = "[UPCOMING]";
            statusClass = "status-upcoming";
        } else if (bet.type === "OVER") {
            if (total > line) {
                legStatus = "[HIT]";
                statusClass = "status-hit";
                isHit = true;
            } else if (gameInfo.state === "post") {
                legStatus = (total === line) ? "[PUSH]" : "[MISSED]";
                statusClass = "status-missed";
            } else {
                legStatus = "[LIVE]";
                statusClass = "status-live";
            }
        } else if (bet.type === "UNDER") {
            if (total > line) {
                legStatus = "[MISSED]";
                statusClass = "status-missed";
            } else if (gameInfo.state === "post") {
                if (total < line) {
                    legStatus = "[HIT]";
                    statusClass = "status-hit";
                    isHit = true;
                } else {
                    legStatus = "[PUSH]";
                    statusClass = "status-missed";
                }
            } else {
                legStatus = "[ON PACE]";
                statusClass = "status-live";
            }
        }
        return { displayName, detailStr, legStatus, statusClass, gameClockStr, isHit };
    }

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
    const { gameMap, playerStatsMap } = await fetchLiveEspnData();
    const betsContainer = document.getElementById("bets-list-container");
    betsContainer.innerHTML = "";
    let hits = 0;

    for (const bet of bets) {
        const result = evaluateBetLeg(bet, gameMap, playerStatsMap);
        if (result.isHit) hits++;

        const isOu = (bet.type === "OVER" || bet.type === "UNDER");
        const editableAttr = isOu ? `contenteditable="true" data-edit-id="${bet.id}" title="Click to edit Over/Under text"` : "";

        const rowDiv = document.createElement("div");
        rowDiv.id = `bet-row-${bet.id}`;
        rowDiv.className = `grid-row bet-item-row ${result.statusClass}`;
        rowDiv.setAttribute("data-team", bet.teamKey);
        rowDiv.setAttribute("data-prop-type", bet.type);

        rowDiv.innerHTML = `
            <div id="${bet.id}-player" class="col-player bet-cell-player">${result.displayName}</div>
            <div id="${bet.id}-prop" class="col-prop bet-cell-prop" ${editableAttr}>${bet.prop}</div>
            <div id="${bet.id}-current" class="col-current bet-cell-current">${result.detailStr}</div>
            <div id="${bet.id}-status" class="col-status bet-cell-status">${result.legStatus}</div>
            <div id="${bet.id}-game" class="col-game bet-cell-game">${result.gameClockStr}</div>
            <div id="${bet.id}-action" class="col-action bet-cell-action">
                <button type="button" class="btn-remove-leg" data-id="${bet.id}">[X]</button>
            </div>
        `;

        betsContainer.appendChild(rowDiv);
    }

    // Save inline edits to Over/Under prop text directly without error catching
    document.querySelectorAll("[data-edit-id]").forEach(cell => {
        cell.addEventListener("blur", (e) => {
            const editId = e.target.getAttribute("data-edit-id");
            const newText = e.target.textContent.trim();
            const betToUpdate = bets.find(b => b.id === editId);
            betToUpdate.prop = newText;
            betToUpdate.target = parseFloat(newText.replace(/[^\d.-]/g, ""));
            saveBets();
            updateTracker();
        });
    });

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
}

setupBuilderUI();
loadTodaysSlateAndRosters();
updateTracker();
setInterval(updateTracker, REFRESH_SECONDS * 1000);