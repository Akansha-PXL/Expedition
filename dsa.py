```python
import time
from typing import Dict, List, Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Word Recovery Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TrieNode:
    def __init__(self, char: str = "", depth: int = 0):
        self.char: str = char
        self.depth: int = depth
        self.children: List[Optional["TrieNode"]] = [None] * 26
        self.terminal_word: Optional[str] = None
        self.active_count: int = 0


class ManualTrie:
    def __init__(self):
        self.root = TrieNode()
        self.total_words_loaded: int = 0
        self.pruned_words_count: int = 0

    @staticmethod
    def _idx(ch: str) -> int:
        return ord(ch) - ord("a")

    def insert(self, word: str) -> bool:
        curr = self.root
        for ch in word:
            i = self._idx(ch)
            if curr.children[i] is None:
                curr.children[i] = TrieNode(char=ch, depth=curr.depth + 1)
            curr = curr.children[i]

        if curr.terminal_word is not None:
            return False

        curr.terminal_word = word
        self.total_words_loaded += 1

        curr = self.root
        for ch in word:
            i = self._idx(ch)
            child = curr.children[i]
            if child is not None:
                child.active_count += 1
                curr = child
        return True

    def deactivate_word(self, word: str) -> None:
        curr = self.root
        path_nodes: List[TrieNode] = []
        for ch in word:
            i = self._idx(ch)
            child = curr.children[i]
            if child is None:
                return
            path_nodes.append(child)
            curr = child

        if curr.terminal_word is None:
            return

        curr.terminal_word = None
        self.pruned_words_count += 1

        for node in path_nodes:
            if node.active_count > 0:
                node.active_count -= 1


class WordRecoveryEngine:
    DIRS: List[Tuple[int, int, str]] = [
        (-1, 0, "UP"),
        (1, 0, "DOWN"),
        (0, -1, "LEFT"),
        (0, 1, "RIGHT"),
    ]

    def __init__(
        self,
        grid: List[List[str]],
        dictionary: List[str],
        record_trace: bool = True,
        max_trace_events: int = 1500,
    ):
        self.grid = grid
        self.rows = len(grid)
        self.cols = len(grid[0]) if self.rows > 0 else 0
        self.record_trace = record_trace
        self.max_trace_events = max_trace_events

        self.trie = ManualTrie()
        self.recovered_words: List[Dict] = []
        self.trace_events: List[Dict] = []
        self.trace_truncated: bool = False

        self.cells_entered: int = 0
        self.pruned_steps: int = 0
        self.blocked_visited_steps: int = 0
        self.backtrack_steps: int = 0

        for raw in dictionary:
            cleaned = raw.strip().lower()
            if cleaned:
                self.trie.insert(cleaned)

    def _emit(self, event: Dict) -> None:
        if not self.record_trace:
            return
        if len(self.trace_events) < self.max_trace_events:
            self.trace_events.append(event)
        else:
            self.trace_truncated = True

    def solve(self) -> Dict:
        start_time = time.perf_counter()
        visited = [[False for _ in range(self.cols)] for _ in range(self.rows)]
        current_path: List[Tuple[int, int]] = []

        for r in range(self.rows):
            for c in range(self.cols):
                ch = self.grid[r][c]
                idx = ord(ch) - ord("a")
                start_node = self.trie.root.children[idx]

                if start_node is not None and start_node.active_count > 0:
                    self._dfs(r, c, start_node, ch, visited, current_path, "START")
                else:
                    self.pruned_steps += 1
                    self._emit({
                        "type": "prune_start",
                        "row": r + 1,
                        "col": c + 1,
                        "letter": ch,
                        "active_prefix_words": 0,
                    })

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 3)

        return {
            "grid_dimensions": {"rows": self.rows, "cols": self.cols},
            "dictionary_size_unique": self.trie.total_words_loaded,
            "recovered_count": len(self.recovered_words),
            "recovered_words": self.recovered_words,
            "metrics": {
                "execution_time_ms": elapsed_ms,
                "cells_entered": self.cells_entered,
                "pruned_steps": self.pruned_steps,
                "blocked_visited_steps": self.blocked_visited_steps,
                "backtrack_steps": self.backtrack_steps,
                "deactivated_trie_words": self.trie.pruned_words_count,
            },
            "trace_truncated": self.trace_truncated,
            "trace_events": self.trace_events,
        }

    def _dfs(
        self,
        r: int,
        c: int,
        node: TrieNode,
        prefix: str,
        visited: List[List[bool]],
        path: List[Tuple[int, int]],
        move_dir: str,
    ) -> None:
        self.cells_entered += 1
        visited[r][c] = True
        path.append((r + 1, c + 1))

        self._emit({
            "type": "visit",
            "row": r + 1,
            "col": c + 1,
            "letter": self.grid[r][c],
            "direction": move_dir,
            "prefix": prefix,
            "active_prefix_words": node.active_count,
            "current_path": [[p[0], p[1]] for p in path],
        })

        if node.terminal_word is not None:
            matched = node.terminal_word
            coords_copy = [[p[0], p[1]] for p in path]
            readable = "->".join([f"({p[0]},{p[1]})" for p in path])

            self.recovered_words.append({
                "word": matched,
                "coordinates": coords_copy,
                "readable_path": readable,
                "length": len(matched),
            })

            self.trie.deactivate_word(matched)

            self._emit({
                "type": "match",
                "word": matched,
                "row": r + 1,
                "col": c + 1,
                "readable_path": readable,
                "coordinates": coords_copy,
                "remaining_prefix_words": node.active_count,
            })

        for dr, dc, dir_label in self.DIRS:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < self.rows and 0 <= nc < self.cols):
                continue

            if visited[nr][nc]:
                self.blocked_visited_steps += 1
                self._emit({
                    "type": "skip_visited",
                    "from": [r + 1, c + 1],
                    "to": [nr + 1, nc + 1],
                    "letter": self.grid[nr][nc],
                    "direction": dir_label,
                })
                continue

            next_char = self.grid[nr][nc]
            next_idx = ord(next_char) - ord("a")
            next_node = node.children[next_idx]

            if next_node is None or next_node.active_count == 0:
                self.pruned_steps += 1
                self._emit({
                    "type": "prune",
                    "from": [r + 1, c + 1],
                    "to": [nr + 1, nc + 1],
                    "letter": next_char,
                    "direction": dir_label,
                    "candidate_prefix": prefix + next_char,
                })
                continue

            self._dfs(nr, nc, next_node, prefix + next_char, visited, path, dir_label)

        visited[r][c] = False
        path.pop()
        self.backtrack_steps += 1

        self._emit({
            "type": "backtrack",
            "row": r + 1,
            "col": c + 1,
            "letter": self.grid[r][c],
            "current_path": [[p[0], p[1]] for p in path],
        })


def build_stress_test_case() -> Dict:
    stress_grid = [
        ["s", "t", "a", "r", "t", "p", "a", "n", "e", "l"],
        ["e", "a", "r", "t", "h", "r", "o", "u", "t", "e"],
        ["a", "l", "p", "h", "a", "s", "i", "g", "n", "a"],
        ["r", "e", "s", "c", "u", "e", "m", "a", "p", "s"],
        ["c", "o", "m", "m", "u", "n", "i", "c", "a", "t"],
        ["h", "e", "l", "p", "l", "i", "n", "k", "s", "e"],
        ["b", "e", "a", "c", "o", "n", "s", "i", "g", "n"],
        ["t", "r", "a", "c", "k", "e", "r", "s", "p", "a"],
        ["l", "o", "s", "t", "w", "o", "r", "d", "s", "t"],
        ["f", "i", "e", "l", "d", "n", "o", "t", "e", "s"],
    ]
    roots = [
        "start", "earth", "alpha", "rescue", "commun",
        "help", "beacon", "track", "lost", "field",
        "panel", "route", "signal", "notes", "words",
    ]
    suffixes = [
        "a", "e", "i", "o", "u", "s", "t", "r", "n", "l",
        "ed", "er", "ing", "ly", "al", "on", "en", "es", "ist", "ary",
    ]
    words: List[str] = []
    for root in roots:
        for s1 in suffixes:
            w1 = root + s1
            if len(w1) <= 10:
                words.append(w1)
            for s2 in ["s", "t", "r", "n", "d", "e", "a", "o", "i", "l"]:
                w2 = w1 + s2
                if len(w2) <= 10 and len(words) < 3000:
                    words.append(w2)
    for gw in ["start", "earth", "alpha", "rescue", "help", "beacon", "lost", "field"]:
        words.append(gw)

    return {
        "id": "stress-10x10-shared-prefixes",
        "title": "10x10 Stress Test with Shared Prefixes",
        "grid": stress_grid,
        "dictionary": words,
    }


TEST_CASES: Dict[str, Dict] = {
    "illustrative-4x4": {
        "id": "illustrative-4x4",
        "title": "Illustrative Example (4x4)",
        "grid": [
            ["o", "a", "a", "n"],
            ["e", "t", "a", "e"],
            ["i", "h", "k", "r"],
            ["i", "f", "l", "v"],
        ],
        "dictionary": ["oath", "pea", "eat", "rain"],
    },
    "repeated-shared-prefix": {
        "id": "repeated-shared-prefix",
        "title": "Repeated Letters & Shared Prefixes (4x4)",
        "grid": [
            ["p", "r", "e", "s"],
            ["s", "o", "r", "t"],
            ["m", "i", "s", "s"],
            ["e", "n", "d", "s"],
        ],
        "dictionary": [
            "pre", "pres", "press", "pressed", "pro", "prom",
            "sort", "miss", "send", "ends", "rest", "post",
        ],
    },
    "empty-result": {
        "id": "empty-result",
        "title": "Absent Words / Empty Result (3x3)",
        "grid": [
            ["x", "y", "z"],
            ["q", "w", "e"],
            ["z", "x", "c"],
        ],
        "dictionary": ["expedition", "signal", "radio", "camp"],
    },
    "stress-10x10-shared-prefixes": build_stress_test_case(),
}


class SearchRequest(BaseModel):
    grid: List[List[str]] = Field(...)
    dictionary: List[str] = Field(...)
    record_trace: bool = Field(default=True)
    max_trace_events: int = Field(default=1500, ge=1, le=10000)


def validate_inputs(grid: List[List[str]], dictionary: List[str]) -> None:
    if not grid or len(grid) > 10:
        raise HTTPException(status_code=400, detail="Grid rows must be between 1 and 10.")
    cols = len(grid[0])
    if cols == 0 or cols > 10:
        raise HTTPException(status_code=400, detail="Grid columns must be between 1 and 10.")

    for r_idx, row in enumerate(grid):
        if len(row) != cols:
            raise HTTPException(status_code=400, detail=f"Row {r_idx + 1} is not rectangular.")
        for c_idx, cell in enumerate(row):
            if not isinstance(cell, str) or len(cell) != 1 or not ("a" <= cell <= "z"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid cell at ({r_idx + 1},{c_idx + 1}): '{cell}'.",
                )

    if len(dictionary) > 10000:
        raise HTTPException(status_code=400, detail="Dictionary exceeds 10,000 words.")

    for word in dictionary:
        if not isinstance(word, str):
            raise HTTPException(status_code=400, detail="Dictionary entries must be strings.")
        cleaned = word.strip()
        if len(cleaned) > 10:
            raise HTTPException(status_code=400, detail=f"Word '{cleaned}' exceeds 10 characters.")
        if any(not ("a" <= ch <= "z") for ch in cleaned):
            raise HTTPException(status_code=400, detail=f"Word '{cleaned}' must be lowercase 'a'-'z'.")


@app.get("/api/test-cases")
def get_test_cases():
    return {
        "test_cases": [
            {
                "id": cid,
                "title": case["title"],
                "rows": len(case["grid"]),
                "cols": len(case["grid"][0]),
                "dictionary_count": len(case["dictionary"]),
            }
            for cid, case in TEST_CASES.items()
        ]
    }


@app.get("/api/test-cases/{case_id}")
def get_test_case(case_id: str):
    case = TEST_CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Test case not found.")
    return case


@app.post("/api/test-cases/{case_id}/run")
def run_test_case(case_id: str, record_trace: bool = True, max_trace_events: int = 1500):
    case = TEST_CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Test case not found.")
    validate_inputs(case["grid"], case["dictionary"])
    effective_trace = record_trace and (case_id != "stress-10x10-shared-prefixes" or max_trace_events <= 500)
    engine = WordRecoveryEngine(case["grid"], case["dictionary"], effective_trace, max_trace_events)
    res = engine.solve()
    res["test_case_id"] = case_id
    return res


@app.post("/api/search")
def search(payload: SearchRequest):
    validate_inputs(payload.grid, payload.dictionary)
    engine = WordRecoveryEngine(
        payload.grid,
        payload.dictionary,
        payload.record_trace,
        payload.max_trace_events,
    )
    return engine.solve()

