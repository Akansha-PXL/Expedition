// ==========================================
// THE EXPEDITION'S LOST WORDS - FRONTEND JS
// Connects Index.html, style.css, and backend/dsa.py
// ==========================================

const API_BASE_URL = "http://127.0.0.1:8000";

// DOM Elements matching Index.html
const searchForm = document.getElementById("searchForm");
const gridInput = document.getElementById("gridInput");
const dictionaryInput = document.getElementById("dictionaryInput");
const searchButton = document.getElementById("searchButton");
const exampleButton = document.getElementById("exampleButton");
const clearButton = document.getElementById("clearButton");

const gridDisplay = document.getElementById("gridDisplay");
const searchStatus = document.getElementById("searchStatus");
const resultsContainer = document.getElementById("resultsContainer");
const selectedWordEl = document.getElementById("selectedWord");
const pathDisplay = document.getElementById("pathDisplay");

// Application State
let currentGrid = [];
let currentResults = [];
let cellElementsMap = new Map(); // Key: "row,col" (1-indexed) -> DOM element

// ==========================================
// 1. PARSING & VALIDATION HELPERS
// ==========================================

/**
 * Parses textarea input into a 2D lowercase array.
 * Supports both continuous rows ("oaan") and space/comma-separated cells ("o a a n").
 */
function parseGridInput(rawText) {
    const lines = rawText
        .split(/\r?\n/)
        .map(line => line.trim().toLowerCase())
        .filter(line => line.length > 0);

    if (lines.length === 0) {
        throw new Error("Please enter at least one row of letters for the grid.");
    }

    if (lines.length > 10) {
        throw new Error("Grid cannot exceed 10 rows.");
    }

    const grid = lines.map((line, rowIdx) => {
        // Handle space/comma-separated letters OR contiguous characters
        const cells = /[\s,]/.test(line)
            ? line.split(/[\s,]+/).filter(Boolean)
            : line.split("");

        for (const ch of cells) {
            if (!/^[a-z]$/.test(ch)) {
                throw new Error(
                    `Invalid character "${ch}" in row ${rowIdx + 1}. Use single lowercase letters (a-z) only.`
                );
            }
        }
        return cells;
    });

    const expectedCols = grid[0].length;
    if (expectedCols === 0 || expectedCols > 10) {
        throw new Error("Grid must have between 1 and 10 columns.");
    }

    for (let r = 0; r < grid.length; r++) {
        if (grid[r].length !== expectedCols) {
            throw new Error(
                `Row ${r + 1} has ${grid[r].length} letters, expected ${expectedCols} (grid must be rectangular).`
            );
        }
    }

    return grid;
}

/**
 * Parses comma- or newline-separated words into a deduplicated lowercase list.
 */
function parseDictionaryInput(rawText) {
    const rawTokens = rawText
        .split(/[\s,]+/)
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0);

    if (rawTokens.length === 0) {
        throw new Error("Please enter at least one candidate word in the dictionary.");
    }

    const uniqueWords = [];
    const seen = new Set();

    for (const word of rawTokens) {
        if (!/^[a-z]+$/.test(word)) {
            throw new Error(`Invalid dictionary word "${word}". Only lowercase letters a-z are allowed.`);
        }
        if (word.length > 10) {
            throw new Error(`Word "${word}" exceeds the 10-character limit.`);
        }
        if (!seen.has(word)) {
            seen.add(word);
            uniqueWords.push(word);
        }
    }

    if (uniqueWords.length > 10000) {
        throw new Error("Dictionary cannot exceed 10,000 unique words.");
    }

    return uniqueWords;
}

// ==========================================
// 2. GRID RENDERING & PATH HIGHLIGHTING
// ==========================================

/**
 * Renders the dynamic rectangular grid inside #gridDisplay.
 * Overrides CSS default 4-column template dynamically for any N x M grid (up to 10x10).
 */
function renderGrid(grid) {
    currentGrid = grid;
    gridDisplay.innerHTML = "";
    cellElementsMap.clear();

    if (!grid || grid.length === 0) {
        gridDisplay.style.gridTemplateColumns = "repeat(4, 65px)";
        return;
    }

    const rows = grid.length;
    const cols = grid[0].length;
    const cellSize = cols > 6 ? "48px" : "65px";

    gridDisplay.style.gridTemplateColumns = `repeat(${cols}, ${cellSize})`;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement("div");
            cell.className = "grid-cell";
            cell.setAttribute("role", "gridcell");
            cell.setAttribute("aria-label", `Row ${r + 1}, Column ${c + 1}: ${grid[r][c].toUpperCase()}`);
            cell.title = `(${r + 1}, ${c + 1})`;
            cell.textContent = grid[r][c].toUpperCase();

            if (cols > 6) {
                cell.style.width = "48px";
                cell.style.height = "48px";
                cell.style.fontSize = "18px";
            }

            const key = `${r + 1},${c + 1}`;
            cellElementsMap.set(key, cell);
            gridDisplay.appendChild(cell);
        }
    }
}

/**
 * Clears active path highlights from all grid cells.
 */
function clearGridHighlights() {
    cellElementsMap.forEach(cell => {
        cell.classList.remove("highlight", "selected");
    });
}

/**
 * Highlights a recovered word's path on the grid and renders coordinate chips.
 */
function selectWordResult(resultObj, clickedCardEl) {
    clearGridHighlights();

    // Update active state on result buttons
    document.querySelectorAll(".result-item").forEach(el => el.classList.remove("active"));
    if (clickedCardEl) {
        clickedCardEl.classList.add("active");
    }

    // Highlight cells on the grid (1-indexed [row, col])
    const coords = resultObj.coordinates || [];
    coords.forEach(([row, col], idx) => {
        const cell = cellElementsMap.get(`${row},${col}`);
        if (cell) {
            cell.classList.add("highlight");
            if (idx === 0) {
                cell.classList.add("selected"); // Distinct accent for starting cell
            }
        }
    });

    // Update Path Display section
    selectedWordEl.textContent = `Path for "${resultObj.word.toUpperCase()}" (${coords.length} steps):`;
    pathDisplay.innerHTML = "";

    coords.forEach(([row, col], idx) => {
        const letter = currentGrid[row - 1]?.[col - 1]?.toUpperCase() || "";
        const badge = document.createElement("span");
        badge.className = "path-coordinate";
        badge.textContent = `(${row},${col}) ${letter}`;
        pathDisplay.appendChild(badge);

        if (idx < coords.length - 1) {
            const arrow = document.createElement("span");
            arrow.className = "path-arrow";
            arrow.textContent = "→";
            pathDisplay.appendChild(arrow);
        }
    });
}

// ==========================================
// 3. RESULTS & STATUS RENDERING
// ==========================================

function setStatus(message, isError = false) {
    searchStatus.textContent = message;
    searchStatus.style.borderColor = isError ? "rgba(255, 120, 120, 0.5)" : "rgba(70, 192, 157, 0.25)";
    searchStatus.style.color = isError ? "#ffb3b3" : "#9debd0";
}

function renderResults(results) {
    currentResults = results || [];
    resultsContainer.innerHTML = "";

    if (currentResults.length === 0) {
        const emptyMsg = document.createElement("p");
        emptyMsg.textContent = "No valid dictionary words could be traced in this grid.";
        resultsContainer.appendChild(emptyMsg);

        selectedWordEl.textContent = "No path available.";
        pathDisplay.innerHTML = "";
        return;
    }

    currentResults.forEach((item, index) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "result-item";
        card.textContent = item.word.toUpperCase();
        card.title = `Click to highlight path: ${item.readable_path}`;

        card.addEventListener("click", () => {
            selectWordResult(item, card);
        });

        resultsContainer.appendChild(card);

        // Automatically highlight the first recovered word
        if (index === 0) {
            selectWordResult(item, card);
        }
    });
}

// ==========================================
// 4. LOCAL FALLBACK SOLVER (IF BACKEND IS OFFLINE)
// ==========================================

function solveLocally(grid, dictionary) {
    const startTime = performance.now();
    const rows = grid.length;
    const cols = grid[0].length;

    // Build manual Trie
    const root = { children: {}, word: null, count: 0 };
    for (const w of dictionary) {
        let node = root;
        for (const ch of w) {
            if (!node.children[ch]) {
                node.children[ch] = { children: {}, word: null, count: 0 };
            }
            node = node.children[ch];
            node.count++;
        }
        node.word = w;
    }

    function deactivate(word) {
        let node = root;
        for (const ch of word) {
            node = node.children[ch];
            if (!node) return;
            node.count--;
        }
        node.word = null;
    }

    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const found = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let pruned = 0;

    function dfs(r, c, node, path) {
        visited[r][c] = true;
        path.push([r + 1, c + 1]);

        if (node.word !== null) {
            const matched = node.word;
            found.push({
                word: matched,
                coordinates: path.map(p => [...p]),
                readable_path: path.map(p => `(${p[0]},${p[1]})`).join("->"),
                length: matched.length
            });
            deactivate(matched);
        }

        for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
                const nextChar = grid[nr][nc];
                const nextNode = node.children[nextChar];
                if (nextNode && nextNode.count > 0) {
                    dfs(nr, nc, nextNode, path);
                } else {
                    pruned++;
                }
            }
        }

        visited[r][c] = false;
        path.pop();
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const startNode = root.children[grid[r][c]];
            if (startNode && startNode.count > 0) {
                dfs(r, c, startNode, []);
            } else {
                pruned++;
            }
        }
    }

    const elapsedMs = (performance.now() - startTime).toFixed(2);
    return {
        recovered_count: found.length,
        recovered_words: found,
        metrics: {
            execution_time_ms: elapsedMs,
            pruned_steps: pruned
        },
        source: "browser-fallback"
    };
}

// ==========================================
// 5. BACKEND API INTEGRATION (backend/dsa.py)
// ==========================================

async function runWordRecovery(grid, dictionary) {
    renderGrid(grid);
    clearGridHighlights();
    searchButton.disabled = true;
    searchButton.textContent = "Searching...";
    setStatus("Scanning communication panel via backend Trie + Backtracking engine...");

    try {
        const response = await fetch(`${API_BASE_URL}/api/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grid: grid,
                dictionary: dictionary,
                record_trace: true,
                max_trace_events: 1500
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || `Backend returned HTTP ${response.status}`);
        }

        const data = await response.json();
        renderResults(data.recovered_words);

        const timeMs = data.metrics?.execution_time_ms ?? 0;
        const pruned = data.metrics?.pruned_steps ?? 0;
        setStatus(
            `Recovered ${data.recovered_count} word(s) in ${timeMs} ms (${pruned} dead-end branches pruned via backend API).`
        );
    } catch (err) {
        // If backend server (uvicorn) is not running, fall back smoothly so UI still works
        if (err instanceof TypeError || err.message.includes("Failed to fetch")) {
            const fallbackData = solveLocally(grid, dictionary);
            renderResults(fallbackData.recovered_words);
            setStatus(
                `Recovered ${fallbackData.recovered_count} word(s) in ${fallbackData.metrics.execution_time_ms} ms.`
            );
        } else {
            setStatus(`Error: ${err.message}`, true);
            resultsContainer.innerHTML = "<p>Search halted due to input or server error.</p>";
        }
    } finally {
        searchButton.disabled = false;
        searchButton.textContent = "Search Words";
    }
}

// ==========================================
// 6. EVENT LISTENERS
// ==========================================

searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
        const grid = parseGridInput(gridInput.value);
        const dictionary = parseDictionaryInput(dictionaryInput.value);
        await runWordRecovery(grid, dictionary);
    } catch (validationErr) {
        setStatus(validationErr.message, true);
    }
});

// Live preview of grid as user types
gridInput.addEventListener("input", () => {
    try {
        const previewGrid = parseGridInput(gridInput.value);
        renderGrid(previewGrid);
    } catch {
        // Ignore partial typing errors until submission
    }
});

// Load the official illustrative 4x4 example (or fetch from backend test-cases if available)
exampleButton.addEventListener("click", async () => {
    const defaultGridLines = ["oaan", "etae", "ihkr", "iflv"];
    const defaultWords = ["oath", "pea", "eat", "rain"];

    gridInput.value = defaultGridLines.join("\n");
    dictionaryInput.value = defaultWords.join(", ");

    const parsedGrid = parseGridInput(gridInput.value);
    renderGrid(parsedGrid);
    clearGridHighlights();
    resultsContainer.innerHTML = "<p>Example loaded. Click 'Search Words' to run recovery.</p>";
    selectedWordEl.textContent = "Select a recovered word to view its path.";
    pathDisplay.innerHTML = "";
    setStatus("Illustrative 4x4 example loaded. Ready to search.");
});

// Reset everything cleanly
clearButton.addEventListener("click", () => {
    setTimeout(() => {
        currentGrid = [];
        currentResults = [];
        cellElementsMap.clear();
        gridDisplay.innerHTML = "";
        gridDisplay.style.gridTemplateColumns = "repeat(4, 65px)";
        resultsContainer.innerHTML = "<p>No words discovered yet.</p>";
        selectedWordEl.textContent = "Select a recovered word to view its path.";
        pathDisplay.innerHTML = "";
        setStatus("Waiting for expedition data...");
    }, 0);
});
