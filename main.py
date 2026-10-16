import asyncio
import os
import random
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
OMDB_API_KEY = os.getenv("OMDB_API_KEY", "").strip()
OMDB_BASE = "https://www.omdbapi.com/"

app = FastAPI(title="CINÉ CLUB", version="2.0.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

# OMDb is a title/search API, not a full discover-by-genre catalog. We build a small
# reusable pool of recognizable titles, fetch details once, and filter by returned genres.
SEED_TITLES = [
    "The Shawshank Redemption", "The Godfather", "The Dark Knight", "Pulp Fiction",
    "Forrest Gump", "Inception", "The Matrix", "Interstellar", "Fight Club",
    "The Lord of the Rings: The Fellowship of the Ring", "The Lord of the Rings: The Two Towers",
    "The Lord of the Rings: The Return of the King", "Spirited Away", "Parasite",
    "Whiplash", "The Grand Budapest Hotel", "The Truman Show", "Back to the Future",
    "The Green Mile", "Good Will Hunting", "The Silence of the Lambs", "Se7en",
    "The Prestige", "Memento", "Arrival", "Blade Runner 2049", "Dune",
    "Mad Max: Fury Road", "Spider-Man: Into the Spider-Verse", "Toy Story",
    "Finding Nemo", "Up", "Inside Out", "Coco", "WALL-E", "Ratatouille",
    "The Lion King", "Shrek", "How to Train Your Dragon", "The Incredibles",
    "Knives Out", "The Grand Budapest Hotel", "La La Land", "The Notebook",
    "Pride & Prejudice", "Before Sunrise", "Titanic", "About Time", "Crazy Rich Asians",
    "The Conjuring", "Get Out", "A Quiet Place", "The Shining", "It", "Jaws",
    "The Sixth Sense", "Scream", "The Hangover", "Superbad", "Groundhog Day",
    "The Devil Wears Prada", "Legally Blonde", "Little Women", "The Social Network",
    "The Imitation Game", "Hidden Figures", "Oppenheimer", "The Martian", "Gravity",
    "Jurassic Park", "Pirates of the Caribbean: The Curse of the Black Pearl",
    "Mission: Impossible - Fallout", "John Wick", "Gladiator", "The Hunger Games",
    "Harry Potter and the Sorcerer's Stone", "Fantastic Mr. Fox", "The Menu", "Joker",
    "Black Panther", "Iron Man", "Guardians of the Galaxy", "Logan", "Deadpool",
]

_pool = []
_pool_loaded_at = 0.0
_pool_lock = asyncio.Lock()
POOL_TTL_SECONDS = 6 * 60 * 60


def normalize(raw: dict) -> Optional[dict]:
    imdb_id = raw.get("imdbID")
    if not imdb_id or raw.get("Response") == "False":
        return None
    poster = raw.get("Poster", "")
    if not poster or poster == "N/A":
        poster = ""
    genres = [x.strip() for x in (raw.get("Genre") or "").split(",") if x.strip()]
    year = raw.get("Year", "")
    released = raw.get("Released", "")
    # Keep the existing front-end's expected shape to preserve the design and interactions.
    return {
        "id": imdb_id,
        "imdbID": imdb_id,
        "title": raw.get("Title") or "Без названия",
        "original_title": raw.get("Title") or "Без названия",
        "overview": raw.get("Plot") if raw.get("Plot") not in (None, "N/A") else "Описание для этого фильма пока не добавлено.",
        "vote_average": 0 if raw.get("imdbRating") in (None, "N/A") else float(raw.get("imdbRating", 0)),
        "release_date": year if year != "N/A" else "",
        "released": released,
        "original_language": "IMDb",
        "genre_ids": genres,
        "genres": genres,
        "poster_path": poster,
        "imdb_rating": raw.get("imdbRating", "N/A"),
        "runtime": raw.get("Runtime", "N/A"),
        "director": raw.get("Director", "N/A"),
    }


async def omdb_get(client: httpx.AsyncClient, params: dict) -> dict:
    if not OMDB_API_KEY:
        raise HTTPException(status_code=503, detail="Не найден OMDB_API_KEY в файле .env. Открой START_HERE.txt и следуй инструкции.")
    query = {"apikey": OMDB_API_KEY, "r": "json", **params}
    try:
        response = await client.get(OMDB_BASE, params=query)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Не удалось связаться с OMDb: {exc}")
    if data.get("Error") == "Invalid API key!":
        raise HTTPException(status_code=502, detail="OMDb не принял ключ. Проверь ключ в файле .env и убедись, что он активирован по ссылке из письма.")
    if data.get("Error") == "Request limit reached!":
        raise HTTPException(status_code=429, detail="Достигнут дневной лимит OMDb. Бесплатный тариф ограничен 1 000 запросами в день.")
    return data


async def load_pool(force: bool = False):
    global _pool, _pool_loaded_at
    if _pool and not force and time.time() - _pool_loaded_at < POOL_TTL_SECONDS:
        return _pool
    async with _pool_lock:
        if _pool and not force and time.time() - _pool_loaded_at < POOL_TTL_SECONDS:
            return _pool
        if not OMDB_API_KEY:
            raise HTTPException(status_code=503, detail="Добавь OMDB_API_KEY в файл .env.")
        semaphore = asyncio.Semaphore(8)
        async with httpx.AsyncClient(timeout=18.0, follow_redirects=True) as client:
            async def fetch_title(title):
                async with semaphore:
                    try:
                        raw = await omdb_get(client, {"t": title, "plot": "short"})
                        return normalize(raw)
                    except HTTPException:
                        raise
                    except Exception:
                        return None
            results = await asyncio.gather(*(fetch_title(title) for title in SEED_TITLES))
        unique = {}
        for movie in results:
            if movie:
                unique[movie["id"]] = movie
        if not unique:
            raise HTTPException(status_code=502, detail="OMDb не вернул фильмы. Проверь API-ключ и интернет-соединение.")
        _pool = list(unique.values())
        _pool_loaded_at = time.time()
        return _pool


@app.get("/")
async def home():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/status")
async def status():
    return {"configured": bool(OMDB_API_KEY), "provider": "OMDb"}


@app.get("/api/genres")
async def genres():
    movies = await load_pool()
    names = sorted({genre for movie in movies for genre in movie["genres"]})
    return [{"id": name, "name": name} for name in names]


@app.get("/api/picks")
async def picks(genre_id: Optional[str] = None, exclude: str = ""):
    movies = await load_pool()
    excluded = {x.strip() for x in exclude.split(",") if x.strip()}
    candidates = [m for m in movies if m["id"] not in excluded and m.get("poster_path")]
    if genre_id:
        candidates = [m for m in candidates if genre_id in m["genres"]]
    random.shuffle(candidates)
    return {"results": candidates[:3]}


@app.get("/api/movies")
async def movies(genre_id: Optional[str] = None, page: int = Query(default=1, ge=1, le=500), sort: str = "popular"):
    pool = await load_pool()
    result = [m for m in pool if not genre_id or genre_id in m["genres"]]
    start = (page - 1) * 20
    return {"results": result[start:start + 20], "page": page, "total_pages": max(1, (len(result) + 19) // 20)}
